import { getStory, listStarterStories } from "@cyoa/stories";
import { applyChoiceAndEnterNode, resolveTerminal, type Story } from "@cyoa/engine";
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

import type { AccountRecord } from "./account";
import { dailyAllowance } from "./billing/entitlements";
import { assertAccountSessionAccess } from "./lib/authz";
import { AppError } from "./lib/errors";
import { makeDayKey } from "./lib/ids";
import {
  authoredSeedStoryId,
  buildCreateSavePlan,
  buildDefaultEntitlement,
  buildGuestAccountSession,
  buildInitialSceneRecord,
  buildLibraryItems,
  buildTurnPersistencePlan,
  parseAuthoredSeedStoryId,
} from "./liveCore";
import type { DailyTurnCounter } from "./ratelimit";
import { consumeTurn } from "./ratelimit";
import { assertCanAccessSave, applySaveState, projectCurrentScene, type SaveRecord } from "./saves";
import { submitTurn } from "./turn";

const accountId = v.id("accounts");
const saveId = v.id("saves");
const mode = v.union(v.literal("story"), v.literal("hardcore"));
const guestTokenHash = v.optional(v.string());
const provider = v.union(v.literal("anthropic"), v.literal("vertex"), v.literal("deepseek"), v.literal("deterministic"));

export const createGuestAccount = mutationGeneric({
  args: {
    ageSelection: v.union(v.literal("13-17"), v.literal("18+"), v.literal("under_13")),
    guestTokenHash: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existingDoc = await ctx.db
      .query("accounts")
      .withIndex("by_guestTokenHash", (q) => q.eq("guestTokenHash", args.guestTokenHash))
      .first();
    const existing = existingDoc ? accountFromDoc(existingDoc) : null;
    const session = buildGuestAccountSession({
      existing,
      ageSelection: args.ageSelection,
      guestTokenHash: args.guestTokenHash,
      now,
    });

    if (existingDoc) {
      await ctx.db.patch(existingDoc._id, { lastActiveAt: now });
      return { account: { ...session.projection, accountId: existingDoc._id }, created: false };
    }

    const accountIdValue = await ctx.db.insert("accounts", cleanDoc(session.account));
    await ctx.db.insert("entitlements", cleanDoc(buildDefaultEntitlement(accountIdValue, now)));
    return { account: { ...session.projection, accountId: accountIdValue }, created: true };
  },
});

export const listStarterLibrary = queryGeneric({
  args: {},
  handler: async () => listStarterStories(),
});

export const listLibrary = queryGeneric({
  args: { accountId, guestTokenHash },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(account), args.guestTokenHash);
    const saves = await ctx.db
      .query("saves")
      .withIndex("by_accountId", (q) => q.eq("accountId", args.accountId))
      .collect();
    const storyTitles = new Map(listStarterStories().map((story) => [story.id, story.title]));
    const authoredSeeds = await ctx.db
      .query("authored_seeds")
      .withIndex("by_ownerAccountId", (q) => q.eq("ownerAccountId", args.accountId))
      .collect();
    for (const seed of authoredSeeds) {
      if (seed.status === "published") storyTitles.set(authoredSeedStoryId(String(seed._id)), seed.title);
    }
    return buildLibraryItems({ saves: saves.map(saveFromDoc), storyTitles });
  },
});

export const createSave = mutationGeneric({
  args: {
    accountId,
    guestTokenHash,
    storyId: v.string(),
    mode,
    rngSeed: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(account), args.guestTokenHash);

    const now = Date.now();
    const story = await loadStory(ctx, args.storyId, args.accountId);
    const save = buildCreateSavePlan({
      accountId: args.accountId,
      story,
      mode: args.mode,
      now,
      rngSeed: args.rngSeed ?? crypto.randomUUID(),
    });
    const newSaveId = await ctx.db.insert("saves", cleanDoc(save));
    const sceneId = await ctx.db.insert(
      "scenes",
      cleanDoc(buildInitialSceneRecord({ save: { ...save, _id: newSaveId }, saveId: newSaveId, story, now })),
    );
    await ctx.db.patch(newSaveId, { currentSceneId: sceneId });

    return {
      saveId: newSaveId,
      sceneId,
      scene: projectCurrentScene({ ...save, _id: newSaveId, currentSceneId: sceneId }, story),
    };
  },
});

export const getCurrentScene = queryGeneric({
  args: { accountId, saveId, guestTokenHash },
  handler: async (ctx, args) => {
    const saveDoc = await ctx.db.get(args.saveId);
    if (!saveDoc) throw new AppError("save_not_found");
    const save = saveFromDoc(saveDoc);
    assertCanAccessSave(args.accountId, save);
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(account), args.guestTokenHash);
    return projectCurrentScene(save, await loadStory(ctx, save.storyId, args.accountId));
  },
});

export const submitChoice = mutationGeneric({
  args: {
    accountId,
    guestTokenHash,
    saveId,
    choiceId: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const saveDoc = await ctx.db.get(args.saveId);
    if (!saveDoc) throw new AppError("save_not_found");
    const save = saveFromDoc(saveDoc);
    assertCanAccessSave(args.accountId, save);
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(account), args.guestTokenHash);

    const now = Date.now();
    const dayKey = makeDayKey(new Date(now));
    const dailyCounterDoc = await ctx.db
      .query("daily_turn_counter")
      .withIndex("by_account_day", (q) => q.eq("accountId", args.accountId))
      .filter((q) => q.eq(q.field("dayKey"), dayKey))
      .first();
    const entitlement =
      (await ctx.db
        .query("entitlements")
        .withIndex("by_accountId", (q) => q.eq("accountId", args.accountId))
        .first()) ?? buildDefaultEntitlement(args.accountId, now);

    const result = await submitTurn({
      save,
      story: await loadStory(ctx, save.storyId, args.accountId),
      choiceId: args.choiceId,
      requestId: args.requestId,
      accountId: args.accountId,
      now,
      dailyCounter: dailyCounterDoc ? dailyCounterFromDoc(dailyCounterDoc) : null,
      dailyAllowance: dailyAllowance(entitlement),
      dayKey,
      resetAt: nextUtcMidnight(now),
    });
    const plan = buildTurnPersistencePlan({ result, saveId: args.saveId, now });

    await ctx.db.patch(args.saveId, cleanDoc(plan.savePatch));
    if (dailyCounterDoc) {
      await ctx.db.patch(dailyCounterDoc._id, cleanDoc(plan.dailyCounter));
    } else {
      await ctx.db.insert("daily_turn_counter", cleanDoc(plan.dailyCounter));
    }
    await ctx.db.insert("turn_history", cleanDoc(plan.history));
    const sceneId = await ctx.db.insert("scenes", cleanDoc(plan.scene));
    await ctx.db.patch(args.saveId, { currentSceneId: sceneId });

    return { saveId: args.saveId, sceneId, scene: result.scene, prose: result.prose };
  },
});

export const beginStreamingChoice = mutationGeneric({
  args: {
    accountId,
    guestTokenHash,
    saveId,
    choiceId: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const saveDoc = await ctx.db.get(args.saveId);
    if (!saveDoc) throw new AppError("save_not_found");
    const save = saveFromDoc(saveDoc);
    assertCanAccessSave(args.accountId, save);
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(account), args.guestTokenHash);
    if (save.activeTurnRequestId && save.activeTurnRequestId !== args.requestId) throw new AppError("turn_in_progress");

    const now = Date.now();
    const story = await loadStory(ctx, save.storyId, args.accountId);
    const dayKey = makeDayKey(new Date(now));
    const dailyCounterDoc = await ctx.db
      .query("daily_turn_counter")
      .withIndex("by_account_day", (q) => q.eq("accountId", args.accountId))
      .filter((q) => q.eq(q.field("dayKey"), dayKey))
      .first();
    const entitlement =
      (await ctx.db
        .query("entitlements")
        .withIndex("by_accountId", (q) => q.eq("accountId", args.accountId))
        .first()) ?? buildDefaultEntitlement(args.accountId, now);
    const dailyCounter = consumeTurn({
      counter: dailyCounterDoc ? dailyCounterFromDoc(dailyCounterDoc) : null,
      accountId: args.accountId,
      dayKey,
      now,
      resetAt: nextUtcMidnight(now),
      allowance: dailyAllowance(entitlement),
    });

    const applied = applyChoiceAndEnterNode(save.state, story, args.choiceId, {
      now,
      rngSeed: args.requestId,
    });
    const nextSave = applySaveState(save, applied.state, now);
    const sceneProjection = projectCurrentScene(nextSave, story);
    const terminal = resolveTerminal(applied.state, story);
    const scene = {
      saveId: args.saveId,
      nodeId: nextSave.currentNodeId,
      turnNumber: nextSave.turnNumber,
      stateFingerprint: stateFingerprint(nextSave),
      prose: terminal ? sceneProjection.prose : "",
      streamStatus: terminal ? "complete" : "pending",
      choiceViews: sceneProjection.choices,
      engineEvents: applied.events,
      safety: { risk: "normal", reasons: [] },
      provider: "deterministic",
      createdAt: now,
      completedAt: terminal ? now : undefined,
    };

    await ctx.db.patch(args.saveId, cleanDoc({
      state: nextSave.state,
      status: nextSave.status,
      engineVersion: nextSave.engineVersion,
      currentNodeId: nextSave.currentNodeId,
      turnNumber: nextSave.turnNumber,
      updatedAt: now,
      activeTurnRequestId: terminal ? undefined : args.requestId,
    }));
    if (dailyCounterDoc) {
      await ctx.db.patch(dailyCounterDoc._id, cleanDoc(dailyCounter));
    } else {
      await ctx.db.insert("daily_turn_counter", cleanDoc(dailyCounter));
    }
    await ctx.db.insert("turn_history", cleanDoc({
      saveId: args.saveId,
      accountId: args.accountId,
      requestId: args.requestId,
      turnNumber: nextSave.turnNumber,
      fromNodeId: save.currentNodeId,
      choiceId: args.choiceId,
      engineDiffs: applied.diffs,
      engineEvents: applied.events,
      provider: "deterministic",
      latency: { engineMs: 0, llmMs: 0 },
      createdAt: now,
    }));
    const sceneId = await ctx.db.insert("scenes", cleanDoc(scene));
    await ctx.db.patch(args.saveId, { currentSceneId: sceneId });

    return {
      saveId: args.saveId,
      sceneId,
      scene: { ...sceneProjection, prose: scene.prose, streamStatus: scene.streamStatus },
      stream: !terminal,
    };
  },
});

export const authorizeSceneStream = queryGeneric({
  args: {
    accountId,
    saveId,
    guestTokenHash,
  },
  handler: async (ctx, args) => {
    const saveDoc = await ctx.db.get(args.saveId);
    if (!saveDoc) throw new AppError("save_not_found");
    const save = saveFromDoc(saveDoc);
    assertCanAccessSave(args.accountId, save);
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(account), args.guestTokenHash);
    return { ok: true };
  },
});

export const getAuthorizedSceneStreamRequest = queryGeneric({
  args: { accountId, saveId, guestTokenHash },
  handler: async (ctx, args) => {
    const saveDoc = await ctx.db.get(args.saveId);
    if (!saveDoc) throw new AppError("save_not_found");
    const save = saveFromDoc(saveDoc);
    assertCanAccessSave(args.accountId, save);
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(account), args.guestTokenHash);
    if (!save.activeTurnRequestId) throw new AppError("scene_stream_not_pending");
    if (!save.currentSceneId) throw new AppError("scene_not_found");
    const sceneDoc = await ctx.db.get(save.currentSceneId as any);
    if (!sceneDoc) throw new AppError("scene_not_found");
    const streamStatus = (sceneDoc as { streamStatus?: string }).streamStatus;
    if (streamStatus !== "pending" && streamStatus !== "streaming") throw new AppError("scene_stream_not_pending");
    const story = await loadStory(ctx, save.storyId, args.accountId);
    const node = story.nodes[save.currentNodeId];
    if (!node) throw new AppError("node_not_found");
    if (resolveTerminal(save.state, story)) throw new AppError("scene_stream_not_required");
    return {
      saveId: args.saveId,
      storyId: story.id,
      nodeId: node.id,
      seed: node.seed ?? "",
      memory: [],
      choices: node.choices.map((choice) => ({ choiceId: choice.id, label: choice.label })),
      sceneLength: node.sceneLength ?? story.defaultSceneLength ?? "standard",
      contentContext: {
        surface: "generation",
        entitlementTier: "free",
        matureContentEnabled: false,
      },
      risk: "normal",
      entitlementTier: "free",
      retryCount: 0,
    };
  },
});

export const completeSceneStream = mutationGeneric({
  args: {
    accountId,
    saveId,
    guestTokenHash,
    prose: v.string(),
    provider,
  },
  handler: async (ctx, args) => {
    const saveDoc = await ctx.db.get(args.saveId);
    if (!saveDoc) throw new AppError("save_not_found");
    const save = saveFromDoc(saveDoc);
    assertCanAccessSave(args.accountId, save);
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(account), args.guestTokenHash);
    if (!save.currentSceneId) throw new AppError("scene_not_found");
    const now = Date.now();
    await ctx.db.patch(save.currentSceneId as any, {
      prose: args.prose,
      streamStatus: "complete",
      provider: args.provider,
      completedAt: now,
    });
    await ctx.db.patch(args.saveId, { activeTurnRequestId: undefined, updatedAt: now });
    const history = await ctx.db
      .query("turn_history")
      .withIndex("by_save_turn", (q) => q.eq("saveId", args.saveId))
      .filter((q) => q.eq(q.field("turnNumber"), save.turnNumber))
      .first();
    if (history) {
      await ctx.db.patch(history._id, {
        provider: args.provider,
        tokenUsage: estimateTokenUsage("", args.prose),
        latency: { ...(history.latency as Record<string, unknown>), llmMs: Math.max(0, now - history.createdAt) },
      });
    }
    return { ok: true };
  },
});

export const failSceneStream = mutationGeneric({
  args: {
    accountId,
    saveId,
    guestTokenHash,
  },
  handler: async (ctx, args) => {
    const saveDoc = await ctx.db.get(args.saveId);
    if (!saveDoc) throw new AppError("save_not_found");
    const save = saveFromDoc(saveDoc);
    assertCanAccessSave(args.accountId, save);
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(account), args.guestTokenHash);
    const now = Date.now();
    if (save.currentSceneId) {
      await ctx.db.patch(save.currentSceneId as any, {
        streamStatus: "failed",
        completedAt: now,
      });
    }
    await ctx.db.patch(args.saveId, { activeTurnRequestId: undefined, updatedAt: now });
    return { ok: true };
  },
});

function accountFromDoc(doc: Record<string, unknown>): AccountRecord {
  return { ...doc, _id: String(doc._id) } as AccountRecord;
}

function saveFromDoc(doc: Record<string, unknown>): SaveRecord {
  return { ...doc, _id: String(doc._id) } as SaveRecord;
}

async function loadStory(
  ctx: { db: { get: (id: any) => Promise<any> } },
  storyId: string,
  accountIdValue: string,
): Promise<Story> {
  const seedIdValue = parseAuthoredSeedStoryId(storyId);
  if (!seedIdValue) return getStory(storyId);

  const seed = await ctx.db.get(seedIdValue);
  if (!seed) throw new AppError("creator_seed_not_found");
  if (seed.ownerAccountId !== accountIdValue || seed.status !== "published") {
    throw new AppError("creator_seed_forbidden");
  }
  return { ...(seed.story as Story), id: storyId };
}

function dailyCounterFromDoc(doc: Record<string, unknown>): DailyTurnCounter {
  return doc as DailyTurnCounter;
}

function cleanDoc<T extends Record<string, unknown>>(doc: T): T {
  return Object.fromEntries(Object.entries(doc).filter(([, value]) => value !== undefined)) as T;
}

function nextUtcMidnight(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function stateFingerprint(save: SaveRecord): string {
  return [save.storyId, save.storyVersion, save.engineVersion, save.currentNodeId, save.turnNumber].join(":");
}

function estimateTokenUsage(input: string, output: string): { input: number; output: number } {
  return {
    input: Math.ceil(input.length / 4),
    output: Math.ceil(output.length / 4),
  };
}
