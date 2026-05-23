import { getStory, getStoryMode, listStarterStories } from "@cyoa/stories";
import {
  advanceLlmTurnCursor,
  applyChoiceAndEnterNode,
  llmSceneOutputSchema,
  recordLlmProposalTerminal,
  resolveTerminal,
  type LlmSceneProposal,
  type PlayerState,
  type Story,
} from "@cyoa/engine";
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

import type { ContentPolicyContext, ContentPolicySummary } from "@cyoa/shared";

import type { AccountRecord } from "./account";
import { dailyAllowance } from "./billing/entitlements";
import {
  evaluateTextPolicy,
  matureContextForAccount,
  redactedPolicyLog,
} from "./contentPolicy";
import { assertAccountSessionAccess } from "./lib/authz";
import { AppError } from "./lib/errors";
import { makeDayKey } from "./lib/ids";
import { buildMemoryWindow, type MemoryBeat } from "./memory";
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
import { queueSceneMediaForSave } from "./media/sceneMedia";
import {
  assertCanAccessSave,
  applySaveState,
  projectCurrentScene,
  projectLlmDrivenScene,
  readPersistedProposal,
  type SaveRecord,
} from "./saves";
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
    // Optional narrator voice id (e.g. "voice.ash"). When omitted the save
    // defaults to voice.ash — the same default the client picker uses on
    // first launch (see apps/app/hooks/useNarratorVoice.ts).
    voiceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(account), args.guestTokenHash);

    const now = Date.now();
    const story = await loadStory(ctx, args.storyId, args.accountId);
    const storyMode = resolveStoryMode(args.storyId);
    const voiceId = args.voiceId ?? "voice.ash";
    let save = buildCreateSavePlan({
      accountId: args.accountId,
      story,
      mode: args.mode,
      now,
      rngSeed: args.rngSeed ?? crypto.randomUUID(),
    });
    // Stamp the voice id onto the save before insertion so the very first
    // scene's narration job (queued from completeSceneStream later) picks
    // it up via save.voiceId.
    save = { ...save, voiceId };
    // For llm-driven stories, advance the cursor immediately to the synthetic
    // opening node so the first scene needs an LLM call (which the client
    // kicks off via the SSE stream after this mutation returns).
    let openingRequestId: string | undefined;
    if (storyMode === "llm-driven") {
      const advanced = advanceLlmTurnCursor({
        state: save.state,
        story,
        priorProposal: null,
        choiceId: null,
        ctx: { now, rngSeed: save.state.storyId },
      });
      openingRequestId = `opening:${crypto.randomUUID()}`;
      save = {
        ...applySaveState(save, advanced.state, now),
        activeTurnRequestId: openingRequestId,
      };
    }
    const newSaveId = await ctx.db.insert("saves", cleanDoc(save));
    const initialSceneRecord = buildInitialSceneRecord({
      save: { ...save, _id: newSaveId },
      saveId: newSaveId,
      story,
      now,
      storyMode,
    });
    const sceneId = await ctx.db.insert("scenes", cleanDoc(initialSceneRecord));
    await ctx.db.patch(newSaveId, { currentSceneId: sceneId });

    // Queue Pro media for the opening scene — AUTHORED MODE ONLY.
    //
    // For LLM-driven stories, completeSceneStream fires moments after this
    // mutation returns (SSE stream → completion mutation) and queues image
    // + video + narration with the REAL streamed prose. If we ALSO queue
    // here with the static seed/title prompt, every asset is queued twice:
    //
    //   1. createSave queue   → runs immediately. For Veo this burns one
    //                            of the 2 RPM quota slots and usually 429s.
    //                            Asset row left at status="failed".
    //   2. completeSceneStream → re-queues video; the "skip if non-failed
    //                            exists" guard misses because the only
    //                            existing row IS failed → 2nd 429 burns
    //                            the OTHER quota slot.
    //
    // Result: 2x the API spend per llm-driven scene and zero Veo videos
    // ever lands. Skip the createSave queue entirely for llm-driven; the
    // stream's completion mutation has the better prose anyway.
    const openingNode = story.nodes[story.startNodeId] ?? story.nodes[save.currentNodeId];
    const openingProse = openingNode?.seed ?? openingNode?.title ?? story.title ?? "";
    const openingPrompt = (openingProse || "scene").slice(0, 480);
    try {
      if (storyMode !== "llm-driven") {
        await queueSceneMediaForSave(ctx, {
          accountId: args.accountId,
          saveId: newSaveId,
          sceneId,
          nodeId: save.currentNodeId,
          prompt: openingPrompt,
          prose: openingProse,
          voiceId,
          alt: `Opening illustration for ${save.currentNodeId}`,
        });
      }
    } catch {
      // non-fatal — Pro media is a tier, the save itself is the contract
    }

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
    const story = await loadStory(ctx, save.storyId, args.accountId);
    const storyMode = resolveStoryMode(save.storyId);
    if (storyMode === "llm-driven") {
      return projectLlmSceneFromRecord(ctx, save);
    }
    return projectCurrentScene(save, story);
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

    const story = await loadStory(ctx, save.storyId, args.accountId);
    const storyMode = resolveStoryMode(save.storyId);

    const contentContext = matureContextForAccount({
      account: accountFromDoc(account),
      entitlement,
      surface: "generation",
    });

    if (storyMode === "llm-driven") {
      return await runLlmDrivenSubmitChoice(ctx, {
        save,
        story,
        choiceId: args.choiceId,
        requestId: args.requestId,
        accountId: args.accountId,
        saveIdValue: args.saveId,
        now,
        dailyCounterDoc,
        dailyAllowanceCount: dailyAllowance(entitlement),
        dayKey,
        contentContext,
        entitlementTier: contentContext.entitlementTier,
      });
    }

    const memory = await loadMemoryWindow(ctx, args.saveId, story.nodes[save.currentNodeId]?.seed ?? "");
    const result = await submitTurn({
      save,
      story,
      choiceId: args.choiceId,
      requestId: args.requestId,
      accountId: args.accountId,
      now,
      dailyCounter: dailyCounterDoc ? dailyCounterFromDoc(dailyCounterDoc) : null,
      dailyAllowance: dailyAllowance(entitlement),
      dayKey,
      resetAt: nextUtcMidnight(now),
      contentContext,
      memory,
      entitlementTier: contentContext.entitlementTier,
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

    // Queue Pro media for the just-resolved scene. submitChoice is the
    // non-streaming path (deterministic engine returns prose inline), so
    // this is the only place media gets queued for those reads. The
    // helper swallows queue failures; we also wrap in try/catch so a
    // raised error here cannot break the choice resolution.
    const choiceProse = (result.prose && result.prose.length > 0)
      ? result.prose
      : (result.scene.prose ?? plan.scene.nodeId ?? "scene");
    const choicePrompt = choiceProse.slice(0, 480);
    try {
      await queueSceneMediaForSave(ctx, {
        accountId: args.accountId,
        saveId: args.saveId,
        sceneId,
        nodeId: result.save.currentNodeId,
        prompt: choicePrompt,
        prose: choiceProse,
        ...(result.save.voiceId ? { voiceId: result.save.voiceId } : {}),
        alt: `Scene illustration for ${result.save.currentNodeId}`,
      });
    } catch {
      // non-fatal — Pro media is a tier, text is the contract
    }

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
    /**
     * Free-form ("Option D") path: when the reader typed their own action
     * instead of picking an LLM-proposed choice, the client sends the
     * trimmed text here. The server runs `evaluateTextPolicy` against it,
     * persists it as `turn_history.choiceLabel` so the next memory beat
     * reads naturally, and advances the cursor without looking up the
     * choiceId in the prior proposal.
     *
     * Length and safety are validated server-side regardless of any
     * client-side check. Free-form is only valid for llm-driven stories;
     * any other mode throws `freeform_not_supported_for_story`.
     */
    userText: v.optional(v.string()),
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

    const storyMode = resolveStoryMode(save.storyId);
    // Free-form ("Option D") only flows through llm-driven mode — the
    // deterministic engine path needs a known edge id to apply scripted
    // effects, and a typed string has none. Reject early so the client can
    // surface a clear "this tale only follows scripted paths" message.
    if (args.userText !== undefined && storyMode !== "llm-driven") {
      throw new AppError("freeform_not_supported_for_story");
    }
    if (args.userText !== undefined) {
      const trimmed = args.userText.trim();
      if (trimmed.length === 0) throw new AppError("freeform_text_empty");
      if (trimmed.length > 200) throw new AppError("freeform_text_too_long");
      // Surface "publishing" matches the creator-seed flow's treatment of
      // user-typed content: a blocked classification becomes a hard block
      // (the reader retypes) rather than a "safe_end" exit that would close
      // the tale on what's really just a UI-level retry case.
      const { context: freeformContext } = await resolveContentContext(
        ctx,
        args.accountId,
        "publishing",
      );
      const policy = evaluateTextPolicy({ text: trimmed, context: freeformContext });
      if (policy.action === "block" || policy.action === "rewrite") {
        throw new AppError("freeform_text_blocked");
      }
    }
    if (storyMode === "llm-driven") {
      return await runLlmDrivenBeginStreaming(ctx, {
        save,
        story,
        choiceId: args.choiceId,
        requestId: args.requestId,
        accountId: args.accountId,
        saveIdValue: args.saveId,
        now,
        dailyCounter,
        dailyCounterDoc,
        // exactOptionalPropertyTypes: spread instead of passing
        // `userText: undefined` when the reader didn't type anything.
        ...(args.userText !== undefined ? { userText: args.userText.trim() } : {}),
      });
    }

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

    // Terminal scenes never enter the SSE stream path, so completeSceneStream
    // won't queue media for them. Queue it here instead. Non-terminal scenes
    // continue to be handled by completeSceneStream after prose lands.
    if (terminal) {
      const terminalProse = scene.prose && scene.prose.length > 0
        ? scene.prose
        : (nextSave.currentNodeId ?? "scene");
      const terminalPrompt = terminalProse.slice(0, 480);
      try {
        await queueSceneMediaForSave(ctx, {
          accountId: args.accountId,
          saveId: args.saveId,
          sceneId,
          nodeId: nextSave.currentNodeId,
          prompt: terminalPrompt,
          prose: terminalProse,
          ...(nextSave.voiceId ? { voiceId: nextSave.voiceId } : {}),
          alt: `Ending illustration for ${nextSave.currentNodeId}`,
        });
      } catch {
        // non-fatal — terminal scene text is the contract, media is a tier
      }
    }

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
    // Accept "failed" too so a busted prior stream is retry-eligible. The
    // active turn request id is still required, so this only re-enters a
    // truly in-flight turn — not a completed/blocked one.
    if (streamStatus !== "pending" && streamStatus !== "streaming" && streamStatus !== "failed") {
      throw new AppError("scene_stream_not_pending");
    }
    const story = await loadStory(ctx, save.storyId, args.accountId);
    const storyMode = resolveStoryMode(save.storyId);
    const { context: contentContext, entitlementTier } = await resolveContentContext(
      ctx,
      args.accountId,
      "generation",
    );

    if (storyMode === "llm-driven") {
      const startNode = story.nodes[story.startNodeId];
      const summary = listStarterStories().find((item) => item.id === story.id);
      const memory = await loadMemoryWindow(ctx, args.saveId, startNode?.seed ?? "");
      return {
        saveId: args.saveId,
        storyId: story.id,
        storyTitle: story.title,
        ...(summary?.tone ? { storyTone: summary.tone } : {}),
        ...(startNode?.seed ? { premise: startNode.seed } : {}),
        nodeId: save.currentNodeId,
        seed: startNode?.seed ?? "",
        memory,
        choices: [],
        sceneLength: story.defaultSceneLength ?? "standard",
        contentContext,
        risk: "normal",
        entitlementTier,
        retryCount: 0,
        mode: "llm-driven",
        playerState: snapshotPlayerState(save.state),
      };
    }

    const node = story.nodes[save.currentNodeId];
    if (!node) throw new AppError("node_not_found");
    if (resolveTerminal(save.state, story)) throw new AppError("scene_stream_not_required");
    const memory = await loadMemoryWindow(ctx, args.saveId, node.seed ?? "");
    return {
      saveId: args.saveId,
      storyId: story.id,
      nodeId: node.id,
      seed: node.seed ?? "",
      memory,
      choices: node.choices.map((choice) => ({ choiceId: choice.id, label: choice.label })),
      sceneLength: node.sceneLength ?? story.defaultSceneLength ?? "standard",
      contentContext,
      risk: "normal",
      entitlementTier,
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
    proposal: v.optional(v.any()),
    terminal: v.optional(v.any()),
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
    const story = await loadStory(ctx, save.storyId, args.accountId);
    const storyMode = resolveStoryMode(save.storyId);

    // Idempotency guard: useTurn's mount-effect re-runs when guest.session
    // updates (it does a remote refresh post-mount), firing two SSE streams
    // against the same saveId in parallel. Both end up calling this mutation,
    // and without this guard each one queues a fresh Imagen + Veo job —
    // doubling spend and burning through Veo's tight 2-RPM preview quota.
    //
    // Two-phase guard:
    //   (a) Already terminal (complete/blocked) → no-op.
    //   (b) Another concurrent caller has claimed this scene (streaming) →
    //       no-op. We mark `streamStatus: "streaming"` at the top of this
    //       function so the FIRST caller wins atomically (Convex mutations
    //       are transactional per document), and the SECOND sees the lock.
    {
      const existingScene = await ctx.db.get(save.currentSceneId as any);
      const existingStatus = (existingScene as { streamStatus?: string } | null)?.streamStatus;
      if (
        existingStatus === "complete" ||
        existingStatus === "blocked" ||
        existingStatus === "streaming"
      ) {
        return { ok: true, deduped: true } as const;
      }
      // Claim the lock for this caller. Subsequent concurrent calls will
      // see "streaming" and bail above. The completion code below then
      // patches status to "complete" / "blocked" / "failed" as appropriate.
      await ctx.db.patch(save.currentSceneId as any, { streamStatus: "streaming" });
    }

    // Safety gates run before persistence. Spec §10: prose and LLM-proposed
    // choice labels must both pass the content policy classifier before they
    // are written to the scene record. Block → persist blocked, clear active
    // turn, skip media. safe_end / safe_redirect → persist + force a safe
    // terminal so the reader hits the safe-ending panel.
    const policyContext = matureContextForAccount({
      account: accountFromDoc(account),
      entitlement:
        (await ctx.db
          .query("entitlements")
          .withIndex("by_accountId", (q: any) => q.eq("accountId", args.accountId))
          .first()) ?? null,
      surface: "generation",
    });
    const proposedChoiceLabels: string[] = (() => {
      if (!args.proposal || typeof args.proposal !== "object") return [];
      const parsed = llmSceneOutputSchema.safeParse(args.proposal);
      if (!parsed.success) return [];
      return parsed.data.choices.map((c) => c.label);
    })();
    const proseChoicePolicy = classifyScenePayload({
      prose: args.prose,
      choiceLabels: proposedChoiceLabels,
      context: policyContext,
    });
    if (proseChoicePolicy.action === "block" || proseChoicePolicy.action === "rewrite") {
      await ctx.db.patch(save.currentSceneId as any, {
        prose: "",
        streamStatus: "blocked" as const,
        provider: args.provider,
        completedAt: now,
        choiceViews: [],
        safety: {
          risk: "blocked",
          reasons: proseChoicePolicy.safetyCategories,
          summary: redactedPolicyLog(proseChoicePolicy),
        },
      });
      await ctx.db.patch(args.saveId, { activeTurnRequestId: undefined, updatedAt: now });
      return { ok: true, blocked: true };
    }
    const policyForcedSafe =
      proseChoicePolicy.action === "safe_end" ||
      proseChoicePolicy.action === "safe_redirect";

    // LLM-driven scenes carry a structured proposal — validate it via the
    // engine's Zod schema, apply terminal handling, then persist proposal +
    // choice views to the scene record.
    if (storyMode === "llm-driven") {
      // Missing proposal is fatal for llm-driven streams. Previously we
      // persisted streamStatus:"complete" with empty choiceViews and cleared
      // activeTurnRequestId, which bricked the save: the next turn would
      // throw `llm_prior_proposal_missing` and the reader would sit on an
      // empty page with no recovery. Fail-loud so the client can retry: keep
      // activeTurnRequestId set, mark the scene failed, leave save state
      // untouched. Pro media skips the queue in this branch.
      if (args.proposal === undefined) {
        await ctx.db.patch(save.currentSceneId as any, {
          prose: args.prose,
          streamStatus: "failed",
          provider: args.provider,
          completedAt: now,
        });
        await ctx.db.patch(args.saveId, { updatedAt: now });
        throw new AppError("llm_scene_invalid_shape");
      }
      const parsedProposal = llmSceneOutputSchema.safeParse(args.proposal);
      if (!parsedProposal.success) {
        // Bad payload — mark the scene failed so the client can retry. Keep
        // activeTurnRequestId set so the retry pathway can resume rather
        // than treating the turn as silently complete.
        await ctx.db.patch(save.currentSceneId as any, {
          streamStatus: "failed",
          provider: args.provider,
          completedAt: now,
        });
        await ctx.db.patch(args.saveId, { updatedAt: now });
        throw new AppError("llm_scene_invalid_shape");
      }
      const proposal: LlmSceneProposal | null = parsedProposal.data;
      const recorded = proposal
        ? recordLlmProposalTerminal({
            state: save.state,
            story,
            proposal,
            ctx: { now, rngSeed: args.saveId },
          })
        : null;
      const nextState: PlayerState = recorded?.state ?? save.state;
      const terminal = policyForcedSafe
        ? { kind: "safe" as const, endingId: "ending-safe" }
        : (recorded?.terminal ?? null);
      const projection = projectLlmDrivenScene({
        save: { ...save, state: nextState },
        proposal,
        prose: args.prose,
        streamStatus: terminal ? "complete" : "complete",
        terminal: terminal
          ? { endingId: terminal.endingId, kind: terminal.kind }
          : null,
      });

      const sceneStatus = terminal
        ? terminal.kind === "death"
          ? "dead"
          : terminal.kind === "safe"
            ? "ended_safely"
            : "ended"
        : save.status;

      await ctx.db.patch(save.currentSceneId as any, {
        prose: args.prose,
        streamStatus: "complete",
        provider: args.provider,
        completedAt: now,
        choiceViews: projection.choices,
        ...(proposal ? { proposal } : {}),
        ...(terminal ? { terminal } : {}),
        engineEvents: recorded?.events ?? [],
        ...(policyForcedSafe
          ? {
              safety: {
                risk: "normal",
                reasons: proseChoicePolicy.safetyCategories,
                summary: redactedPolicyLog(proseChoicePolicy),
              },
            }
          : {}),
      });
      await ctx.db.patch(args.saveId, {
        state: nextState,
        status: sceneStatus,
        engineVersion: nextState.schemaVersion,
        activeTurnRequestId: undefined,
        updatedAt: now,
      });
      // Pro media for llm-driven scenes happens below (same code path as
      // authored streams). Fall through.
    } else {
      await ctx.db.patch(save.currentSceneId as any, {
        prose: args.prose,
        streamStatus: "complete",
        provider: args.provider,
        completedAt: now,
        ...(policyForcedSafe
          ? {
              terminal: { kind: "safe" as const, endingId: "ending-safe" },
              safety: {
                risk: "normal",
                reasons: proseChoicePolicy.safetyCategories,
                summary: redactedPolicyLog(proseChoicePolicy),
              },
            }
          : {}),
      });
      await ctx.db.patch(args.saveId, {
        activeTurnRequestId: undefined,
        updatedAt: now,
        ...(policyForcedSafe ? { status: "ended_safely" as const } : {}),
      });
    }

    // Pro media: queue an Imagen job for this scene. The mutation gates on
    // Pro entitlement (or CYOA_DEV_FORCE_PRO_MEDIA=1) and schedules the
    // async action that fills the asset URL. Text streaming never blocks
    // on media; this is fire-and-forget — failures land in the asset's
    // status and the MediaPlate gracefully holds at Skeleton. We skip the
    // media queue when the safety classifier forced a safe exit on this
    // scene — there is no scene to illustrate.
    if (!policyForcedSafe) {
      try {
        await ctx.runMutation(
          ("media/sceneMedia:queueSceneImage" as unknown) as any,
          {
            accountId: args.accountId,
            saveId: args.saveId,
            sceneId: save.currentSceneId,
            nodeId: save.currentNodeId,
            prompt: args.prose.slice(0, 480),
            alt: `Scene illustration for ${save.currentNodeId}`,
          },
        );
      } catch {
        // Pro media is non-fatal — text is the contract, images are a tier.
      }
      // Pro media: queue a Veo 3.1 lite video alongside the still. MediaPlate
      // advances Skeleton → Image ready → Video buffering → Video playing
      // as each asset resolves. Failures here keep the read at Image-ready,
      // which is the intended reduced-motion fallback.
      try {
        await ctx.runMutation(
          ("media/sceneMedia:queueSceneVideo" as unknown) as any,
          {
            accountId: args.accountId,
            saveId: args.saveId,
            sceneId: save.currentSceneId,
            nodeId: save.currentNodeId,
            prompt: args.prose.slice(0, 480),
            alt: `Scene cinematic for ${save.currentNodeId}`,
          },
        );
      } catch {
        // Video is best-effort. Image asset and text stream are unaffected.
      }
      // Pro narration: Google Cloud TTS reads the prose aloud. Parallel
      // concern to image/video — failures keep MediaPlate visuals unchanged
      // and simply leave the scene silent. Default voice is voice.ash when
      // the save predates voice selection.
      try {
        await ctx.runMutation(
          ("media/sceneMedia:queueSceneNarration" as unknown) as any,
          {
            accountId: args.accountId,
            saveId: args.saveId,
            sceneId: save.currentSceneId,
            nodeId: save.currentNodeId,
            prose: args.prose,
            voiceId: save.voiceId ?? "voice.ash",
            alt: `Scene narration for ${save.currentNodeId}`,
          },
        );
      } catch {
        // Narration is best-effort. Visual stack and text stream are unaffected.
      }
    }
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

/**
 * Resolve the canonical content-policy context for an account. Mature
 * opt-in is *only* honoured for 18+, mature-enabled, unlimited/pro readers;
 * `matureContextForAccount` enforces those rules so the LLM prompt and the
 * provider router both see the same gating decision.
 */
async function resolveContentContext(
  ctx: { db: any },
  accountIdValue: string,
  surface: ContentPolicyContext["surface"],
): Promise<{
  context: ContentPolicyContext;
  account: AccountRecord;
  entitlementTier: "free" | "unlimited" | "pro";
}> {
  const accountDoc = await ctx.db.get(accountIdValue as any);
  if (!accountDoc) throw new AppError("account_not_found");
  const account = accountFromDoc(accountDoc);
  const entitlement =
    (await ctx.db
      .query("entitlements")
      .withIndex("by_accountId", (q: any) => q.eq("accountId", accountIdValue))
      .first()) ?? null;
  const context = matureContextForAccount({ account, entitlement, surface });
  return { context, account, entitlementTier: context.entitlementTier };
}

/**
 * Fetch the last N turn-history rows for a save and project them into a
 * compact memory window for the LLM prompt. Each turn's choice + visible
 * effects collapse to a single beat; older turns sit at the front of the
 * window so the narrator reads them oldest → newest.
 */
async function loadMemoryWindow(
  ctx: { db: any },
  saveIdValue: string,
  currentSeed: string,
  maxBeats = 6,
): Promise<string[]> {
  const rows: any[] = await ctx.db
    .query("turn_history")
    .withIndex("by_save_turn", (q: any) => q.eq("saveId", saveIdValue))
    .order("desc")
    .take(maxBeats);
  const beats: MemoryBeat[] = rows
    .map((row) => memoryBeatFromHistory(row))
    .filter((beat): beat is MemoryBeat => beat !== null);
  return buildMemoryWindow({ currentSeed, beats, maxBeats });
}

function memoryBeatFromHistory(row: Record<string, unknown>): MemoryBeat | null {
  const turnNumber = typeof row.turnNumber === "number" ? row.turnNumber : null;
  const choiceId = typeof row.choiceId === "string" ? row.choiceId : null;
  const fromNodeId = typeof row.fromNodeId === "string" ? row.fromNodeId : null;
  if (turnNumber === null || choiceId === null) return null;
  const events = Array.isArray(row.engineEvents) ? row.engineEvents : [];
  const targetEvent = events.find(
    (e) => e && typeof e === "object" && (e as { kind?: string }).kind === "node_entered",
  ) as { nodeId?: string } | undefined;
  const target = targetEvent?.nodeId ?? "unknown";
  // Prefer the human-readable choiceLabel when present (free-form turns
  // carry the reader's typed text; LLM-proposed turns now carry the
  // proposal's label). Fall back to the raw choiceId for rows written
  // before the choiceLabel field existed.
  const label = typeof row.choiceLabel === "string" && row.choiceLabel.length > 0
    ? row.choiceLabel
    : choiceId;
  const text = `Turn ${turnNumber}: from ${fromNodeId ?? "?"} chose "${label}" → entered ${target}.`;
  return {
    id: String(row._id ?? `${turnNumber}:${choiceId}`),
    text,
    tags: [],
    turnNumber,
  };
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

/**
 * Resolve the contract mode for a save's story id. Authored seed stories
 * (creator drafts) always run authored — they ship a full node graph.
 */
function resolveStoryMode(storyId: string): "authored" | "llm-driven" {
  if (parseAuthoredSeedStoryId(storyId)) return "authored";
  return getStoryMode(storyId);
}

/**
 * Build a minimal player-state snapshot for the LLM prompt. Hidden stats are
 * exposed by id so the narrator can lean on them — they remain invisible to
 * the reader because the HUD only renders `visibleStats`.
 */
function snapshotPlayerState(state: PlayerState): {
  vitality: number;
  currency: number;
  visibleStats: Array<{ statId: string; label: string; value: number }>;
  hiddenStats: Array<{ statId: string; value: number }>;
  inventory: Array<{ id: string; label: string }>;
  flags: Record<string, boolean | number | string>;
} {
  return {
    vitality: state.vitality,
    currency: state.currency,
    visibleStats: Object.values(state.attributes)
      .filter((stat) => stat.visibility === "visible")
      .map((stat) => ({ statId: stat.id, label: stat.label, value: stat.value })),
    hiddenStats: Object.values(state.attributes)
      .filter((stat) => stat.visibility === "hidden")
      .map((stat) => ({ statId: stat.id, value: stat.value })),
    inventory: state.inventory.map((item) => ({ id: item.id, label: item.label })),
    flags: state.flags as Record<string, boolean | number | string>,
  };
}

/**
 * Read the most recent persisted LLM proposal from the save's current scene.
 * This is the proposal whose `choices` the player is choosing from on the
 * current turn — `submitChoice` validates `args.choiceId` against it before
 * applying effects.
 */
async function readPriorProposalFromCurrentScene(
  ctx: { db: { get: (id: any) => Promise<any> } },
  save: SaveRecord,
): Promise<LlmSceneProposal | null> {
  if (!save.currentSceneId) return null;
  const sceneDoc = await ctx.db.get(save.currentSceneId as any);
  if (!sceneDoc) return null;
  return readPersistedProposal((sceneDoc as { proposal?: unknown }).proposal);
}

/**
 * Build the canonical scene projection for the current LLM-driven scene by
 * reading the persisted scene record. Falls back to a "pending shell" if no
 * record has been written yet (early in createSave, before any stream).
 */
async function projectLlmSceneFromRecord(
  ctx: { db: { get: (id: any) => Promise<any> } },
  save: SaveRecord,
) {
  if (!save.currentSceneId) {
    return projectLlmDrivenScene({ save, proposal: null, prose: "", streamStatus: "pending" });
  }
  const sceneDoc = await ctx.db.get(save.currentSceneId as any);
  if (!sceneDoc) {
    return projectLlmDrivenScene({ save, proposal: null, prose: "", streamStatus: "pending" });
  }
  const proposal = readPersistedProposal((sceneDoc as { proposal?: unknown }).proposal);
  const terminalRaw = (sceneDoc as { terminal?: unknown }).terminal;
  const terminal = terminalRaw && typeof terminalRaw === "object" && terminalRaw !== null
    ? (terminalRaw as { kind: "death" | "success" | "safe"; endingId: string })
    : null;
  return projectLlmDrivenScene({
    save,
    proposal,
    prose: (sceneDoc as { prose?: string }).prose ?? "",
    streamStatus: ((sceneDoc as { streamStatus?: string }).streamStatus ?? "complete") as
      | "pending"
      | "streaming"
      | "complete"
      | "failed"
      | "blocked",
    terminal: terminal
      ? { endingId: terminal.endingId, kind: terminal.kind }
      : null,
  });
}

type RunLlmDrivenBeginStreamingInput = {
  save: SaveRecord;
  story: Story;
  choiceId: string;
  requestId: string;
  accountId: string;
  saveIdValue: string;
  now: number;
  dailyCounter: DailyTurnCounter;
  dailyCounterDoc: Record<string, unknown> | null;
  /**
   * Reader-typed text for the free-form ("Option D") path. When present the
   * prior-proposal lookup is bypassed (the reader picked NONE of the
   * proposed choices), the cursor advances in `freeform` mode (no engine
   * effects to apply), and the trimmed text is persisted to
   * `turn_history.choiceLabel` so the next memory beat reads naturally.
   */
  userText?: string;
};

async function runLlmDrivenBeginStreaming(
  ctx: { db: any },
  input: RunLlmDrivenBeginStreamingInput,
) {
  const isFreeform = typeof input.userText === "string";
  const prior = await readPriorProposalFromCurrentScene(ctx, input.save);
  // Validate the choice exists in the prior proposal. The opening scene has
  // no prior proposal — but the opening flow happens via createSave's stream
  // setup, not via beginStreamingChoice, so a missing prior here is a bug.
  //
  // Free-form turns intentionally bypass this lookup: the reader typed their
  // own action instead of selecting one of the proposed choices, so there's
  // nothing to find. The prior is still read (we need it for nothing here,
  // but keeping the read keeps the failure surface — missing-scene bugs —
  // consistent across both paths).
  if (!prior) throw new AppError("llm_prior_proposal_missing");
  if (!isFreeform) {
    const choice = prior.choices.find((candidate) => candidate.id === input.choiceId);
    if (!choice) throw new AppError("llm_choice_not_found");
  }

  const advanced = advanceLlmTurnCursor({
    state: input.save.state,
    story: input.story,
    priorProposal: isFreeform ? null : prior,
    choiceId: input.choiceId,
    ctx: { now: input.now, rngSeed: input.requestId },
    freeform: isFreeform,
  });

  const nextSave: SaveRecord = applySaveState(input.save, advanced.state, input.now);
  const sceneRecord = {
    saveId: input.saveIdValue,
    nodeId: nextSave.currentNodeId,
    turnNumber: nextSave.turnNumber,
    stateFingerprint: stateFingerprint(nextSave),
    prose: "",
    streamStatus: "pending" as const,
    choiceViews: [],
    engineEvents: advanced.events,
    safety: { risk: "normal", reasons: [] },
    provider: "deterministic" as const,
    createdAt: input.now,
  };

  await ctx.db.patch(input.saveIdValue, cleanDoc({
    state: nextSave.state,
    status: nextSave.status,
    engineVersion: nextSave.engineVersion,
    currentNodeId: nextSave.currentNodeId,
    turnNumber: nextSave.turnNumber,
    updatedAt: input.now,
    activeTurnRequestId: input.requestId,
  }));
  if (input.dailyCounterDoc) {
    await ctx.db.patch((input.dailyCounterDoc as { _id: any })._id, cleanDoc(input.dailyCounter));
  } else {
    await ctx.db.insert("daily_turn_counter", cleanDoc(input.dailyCounter));
  }
  await ctx.db.insert("turn_history", cleanDoc({
    saveId: input.saveIdValue,
    accountId: input.accountId,
    requestId: input.requestId,
    turnNumber: nextSave.turnNumber,
    fromNodeId: input.save.currentNodeId,
    choiceId: input.choiceId,
    // Persist the typed text for free-form turns; for LLM-proposed turns we
    // fall back to the prior proposal's label so memoryBeatFromHistory can
    // surface a human-readable beat for both paths.
    choiceLabel: isFreeform
      ? input.userText
      : prior?.choices.find((candidate) => candidate.id === input.choiceId)?.label,
    engineDiffs: advanced.diffs,
    engineEvents: advanced.events,
    provider: "deterministic",
    latency: { engineMs: 0, llmMs: 0 },
    createdAt: input.now,
  }));
  const sceneId = await ctx.db.insert("scenes", cleanDoc(sceneRecord));
  await ctx.db.patch(input.saveIdValue, { currentSceneId: sceneId });

  return {
    saveId: input.saveIdValue,
    sceneId,
    scene: projectLlmDrivenScene({
      save: { ...nextSave, _id: input.saveIdValue, currentSceneId: sceneId },
      proposal: null,
      prose: "",
      streamStatus: "pending",
    }),
    stream: true,
  };
}

type RunLlmDrivenSubmitChoiceInput = {
  save: SaveRecord;
  story: Story;
  choiceId: string;
  requestId: string;
  accountId: string;
  saveIdValue: string;
  now: number;
  dailyCounterDoc: Record<string, unknown> | null;
  dailyAllowanceCount: number | "unlimited";
  dayKey: string;
  contentContext: ContentPolicyContext;
  entitlementTier: "free" | "unlimited" | "pro";
};

async function runLlmDrivenSubmitChoice(
  ctx: { db: any; runMutation?: (ref: any, args: any) => Promise<any> },
  input: RunLlmDrivenSubmitChoiceInput,
) {
  // The non-streaming fallback path. submitTurn does a full LLM call inline
  // and applies the result deterministically. We reproduce the same idea for
  // llm-driven: advance the cursor, ask the router for a full structured
  // scene, validate it, record terminal, persist scene + history.
  const prior = await readPriorProposalFromCurrentScene(ctx, input.save);
  if (!prior) throw new AppError("llm_prior_proposal_missing");
  const choice = prior.choices.find((candidate) => candidate.id === input.choiceId);
  if (!choice) throw new AppError("llm_choice_not_found");

  const dailyCounter = consumeTurn({
    counter: input.dailyCounterDoc ? dailyCounterFromDoc(input.dailyCounterDoc) : null,
    accountId: input.accountId,
    dayKey: input.dayKey,
    now: input.now,
    resetAt: nextUtcMidnight(input.now),
    allowance: input.dailyAllowanceCount,
  });

  const advanced = advanceLlmTurnCursor({
    state: input.save.state,
    story: input.story,
    priorProposal: prior,
    choiceId: input.choiceId,
    ctx: { now: input.now, rngSeed: input.requestId },
  });

  // Inline LLM generation. Lazy import to keep test paths happy.
  const { LlmRouter } = await import("./llm/router");
  const router = new LlmRouter();
  const startNode = input.story.nodes[input.story.startNodeId];
  const summary = listStarterStories().find((item) => item.id === input.story.id);
  const memory = await loadMemoryWindow(ctx, input.saveIdValue, startNode?.seed ?? "");
  const generated = await router.generateScene({
    saveId: input.saveIdValue,
    storyId: input.story.id,
    storyTitle: input.story.title,
    ...(summary?.tone ? { storyTone: summary.tone } : {}),
    ...(startNode?.seed ? { premise: startNode.seed } : {}),
    nodeId: advanced.nodeId,
    seed: startNode?.seed ?? "",
    memory,
    choices: [],
    sceneLength: input.story.defaultSceneLength ?? "standard",
    contentContext: input.contentContext,
    risk: "normal",
    entitlementTier: input.entitlementTier,
    retryCount: 0,
    mode: "llm-driven",
    playerState: snapshotPlayerState(advanced.state),
  });

  const proposal: LlmSceneProposal | null = generated.parsed.proposal ?? null;
  if (!proposal) throw new AppError("llm_scene_invalid_shape");

  // Safety gates run before persistence. Classify the prose first, then the
  // proposed choice labels — either path can trigger a block or a forced safe
  // exit. Allow / safe paths fall through to normal persistence below; a
  // block short-circuits the write, clears the active turn, and skips media.
  const policy = classifyScenePayload({
    prose: generated.parsed.prose,
    choiceLabels: proposal.choices.map((c) => c.label),
    context: input.contentContext,
  });

  if (policy.action === "block" || policy.action === "rewrite") {
    const blockedSceneId = await ctx.db.insert("scenes", cleanDoc({
      saveId: input.saveIdValue,
      nodeId: advanced.nodeId,
      turnNumber: input.save.turnNumber + 1,
      stateFingerprint: stateFingerprint(applySaveState(input.save, advanced.state, input.now)),
      prose: "",
      streamStatus: "blocked" as const,
      choiceViews: [],
      engineEvents: advanced.events,
      safety: { risk: "blocked", reasons: policy.safetyCategories, summary: redactedPolicyLog(policy) },
      provider: normalizeProviderName(generated.generation.provider),
      createdAt: input.now,
      completedAt: input.now,
    }));
    await ctx.db.patch(input.saveIdValue, cleanDoc({
      activeTurnRequestId: undefined,
      currentSceneId: blockedSceneId,
      updatedAt: input.now,
    }));
    return {
      saveId: input.saveIdValue,
      sceneId: blockedSceneId,
      scene: projectLlmDrivenScene({
        save: { ...input.save, _id: input.saveIdValue, currentSceneId: blockedSceneId },
        proposal: null,
        prose: "",
        streamStatus: "blocked",
      }),
      prose: "",
    };
  }

  const recorded = recordLlmProposalTerminal({
    state: advanced.state,
    story: input.story,
    proposal,
    ctx: { now: input.now, rngSeed: input.requestId },
  });
  const nextSave = applySaveState(input.save, recorded.state, input.now);
  // safe_end / safe_redirect: persist the scene but mark the save terminal
  // with kind=safe so the reader hits the safe ending panel.
  const policyForcedSafe = policy.action === "safe_end" || policy.action === "safe_redirect";
  const terminal = policyForcedSafe
    ? { kind: "safe" as const, endingId: "ending-safe" }
    : recorded.terminal;
  const sceneStatus = terminal
    ? terminal.kind === "death"
      ? "dead"
      : terminal.kind === "safe"
        ? "ended_safely"
        : "ended"
    : nextSave.status;
  const projection = projectLlmDrivenScene({
    save: { ...nextSave, _id: input.saveIdValue },
    proposal,
    prose: generated.parsed.prose,
    streamStatus: "complete",
    terminal: terminal ? { endingId: terminal.endingId, kind: terminal.kind } : null,
  });

  await ctx.db.patch(input.saveIdValue, cleanDoc({
    state: nextSave.state,
    status: sceneStatus,
    engineVersion: nextSave.engineVersion,
    currentNodeId: nextSave.currentNodeId,
    turnNumber: nextSave.turnNumber,
    updatedAt: input.now,
    activeTurnRequestId: undefined,
  }));
  if (input.dailyCounterDoc) {
    await ctx.db.patch((input.dailyCounterDoc as { _id: any })._id, cleanDoc(dailyCounter));
  } else {
    await ctx.db.insert("daily_turn_counter", cleanDoc(dailyCounter));
  }
  await ctx.db.insert("turn_history", cleanDoc({
    saveId: input.saveIdValue,
    accountId: input.accountId,
    requestId: input.requestId,
    turnNumber: nextSave.turnNumber,
    fromNodeId: input.save.currentNodeId,
    choiceId: input.choiceId,
    engineDiffs: [...advanced.diffs, ...recorded.diffs],
    engineEvents: [...advanced.events, ...recorded.events],
    provider: generated.generation.provider,
    tokenUsage: generated.generation.tokenUsage,
    latency: { engineMs: 0, llmMs: Math.max(0, Date.now() - input.now) },
    createdAt: input.now,
  }));
  const sceneId = await ctx.db.insert("scenes", cleanDoc({
    saveId: input.saveIdValue,
    nodeId: nextSave.currentNodeId,
    turnNumber: nextSave.turnNumber,
    stateFingerprint: stateFingerprint(nextSave),
    prose: generated.parsed.prose,
    streamStatus: "complete",
    choiceViews: projection.choices,
    engineEvents: [...advanced.events, ...recorded.events],
    safety: policyForcedSafe
      ? { risk: "normal", reasons: policy.safetyCategories, summary: redactedPolicyLog(policy) }
      : { risk: "normal", reasons: [] },
    provider: normalizeProviderName(generated.generation.provider),
    proposal,
    terminal: terminal ?? undefined,
    createdAt: input.now,
    completedAt: input.now,
  }));
  await ctx.db.patch(input.saveIdValue, { currentSceneId: sceneId });

  // Queue Pro media for the just-resolved scene. The llm-driven submit
  // path is non-streaming (prose is generated inline by the LLM router),
  // so this is the analog of submitChoice's queueSceneMediaForSave call:
  // without it, Pro media never gets queued for non-streaming llm-driven
  // reads. Same prompt-fallback policy as the deterministic path —
  // prefer the generated prose, fall back to the node id. Skip media when
  // the safety gate forced a safe exit on this scene.
  const llmProse = (generated.parsed.prose && generated.parsed.prose.length > 0)
    ? generated.parsed.prose
    : (nextSave.currentNodeId ?? "scene");
  const llmPrompt = llmProse.slice(0, 480);
  if (ctx.runMutation && !policyForcedSafe) {
    try {
      await queueSceneMediaForSave(ctx as { runMutation: (ref: any, args: any) => Promise<any> }, {
        accountId: input.accountId,
        saveId: input.saveIdValue,
        sceneId,
        nodeId: nextSave.currentNodeId,
        prompt: llmPrompt,
        prose: llmProse,
        ...(nextSave.voiceId ? { voiceId: nextSave.voiceId } : {}),
        alt: `Scene illustration for ${nextSave.currentNodeId}`,
      });
    } catch {
      // non-fatal — Pro media is a tier, text is the contract
    }
  }

  return {
    saveId: input.saveIdValue,
    sceneId,
    scene: projection,
    prose: generated.parsed.prose,
  };
}

function normalizeProviderName(name: string): "anthropic" | "vertex" | "deepseek" | "deterministic" {
  if (name === "anthropic" || name === "vertex" || name === "deepseek") return name;
  return "deterministic";
}

/**
 * Run the policy classifier across scene prose + LLM-proposed choice labels.
 * The most severe action wins: block > safe_end > safe_redirect > rewrite > allow.
 * Returns a single summary the persistence layer can act on uniformly.
 */
function classifyScenePayload(input: {
  prose: string;
  choiceLabels: string[];
  context: ContentPolicyContext;
}): ContentPolicySummary {
  const proseSummary = evaluateTextPolicy({ text: input.prose, context: input.context });
  const labelsJoined = input.choiceLabels.join("\n");
  const labelSummary = labelsJoined.trim().length > 0
    ? evaluateTextPolicy({ text: labelsJoined, context: input.context })
    : null;
  const safety = Array.from(
    new Set([
      ...proseSummary.safetyCategories,
      ...(labelSummary?.safetyCategories ?? []),
    ]),
  );
  const mature = Array.from(
    new Set([
      ...proseSummary.matureCategories,
      ...(labelSummary?.matureCategories ?? []),
    ]),
  );
  const severity: Record<ContentPolicySummary["action"], number> = {
    allow: 0,
    rewrite: 1,
    safe_redirect: 2,
    safe_end: 3,
    block: 4,
  };
  const actions = [proseSummary.action, ...(labelSummary ? [labelSummary.action] : [])];
  const action = actions.reduce((worst, current) =>
    severity[current] > severity[worst] ? current : worst,
  );
  return {
    action,
    safetyCategories: safety,
    matureCategories: mature,
    redacted: action !== "allow",
  };
}
