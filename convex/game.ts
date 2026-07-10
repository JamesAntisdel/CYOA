import { getStory, getStoryMode, listStarterStories } from "@cyoa/stories";
import { accountFromDoc, cleanDoc } from "./lib/docs";
import {
  advanceLlmTurnCursor,
  applyChoiceAndEnterNode,
  llmSceneOutputSchema,
  recordLlmProposalTerminal,
  resolveTerminal,
  type LlmSceneProposal,
  type NpcRole,
  type NpcState,
  type PlayerState,
  type Story,
  type UnlockedEnding,
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
import {
  buildSafetyAnalyticsEvent,
  buildTurnCompletedEvent,
  safetyEventNameForAction,
  type TurnCompletedAnalyticsInput,
} from "./analyticsEvents";
import { endingRecordFromUnlock } from "./endings";
import { loadAndAuthorizeAccount } from "./lib/authz";
import { AppError } from "./lib/errors";
import { makeDayKey } from "./lib/ids";
import { buildNpcSheets } from "./llm/prompts/scene";
import { guardPromptText } from "./llm/promptGuards";
import type { NpcSheetSnapshot } from "./llm/types";
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
import { schedulePortraitsForNewNpcs } from "./media/npcMedia";
import { resolveMediaStrategy } from "./media/mediaStrategy";
import { detectChapterCinematicTrigger } from "./media/cinematicTriggers";
import {
  assertCanAccessSave,
  applySaveState,
  migrateSaveIfNeeded,
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
    const account = await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);
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
    // Seed-flow inputs from creator's "Seed an adventure" UI. When the
    // reader authored a custom premise (and optionally a title + tone),
    // these are validated, persisted on the save, and used by the LLM
    // scene pipeline so the opening reads from the reader's words —
    // not the starter story's hardcoded seed.
    seedPremise: v.optional(v.string()),
    seedTitle: v.optional(v.string()),
    seedTone: v.optional(v.string()),
    // Optional reader-authored NPC cast from Seed-an-Adventure's "Optional
    // cast" UI. Each entry becomes a Story.initialNpcs row, which the
    // engine's createInitialState seeds into `state.npcs` at save creation.
    // From there the existing pipelines pick up automatically: the portrait
    // scheduler (convex/media/npcMedia.ts:schedulePortraitsForNewNpcs) sees
    // NPCs lacking portraitAssetId on the first turn and queues Imagen;
    // buildNpcSheets surfaces in-scope NPCs to the LLM prompt; NpcRoster
    // renders the cast in the client UI.
    seedNpcs: v.optional(v.array(v.object({
      name: v.string(),
      role: v.union(
        v.literal("companion"),
        v.literal("ally"),
        v.literal("rival"),
        v.literal("neutral"),
        v.literal("antagonist"),
      ),
      description: v.string(),
    }))),
  },
  handler: async (ctx, args) => {
    const account = await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);

    // Reader-authored seed inputs. Trim and length-check upfront so the
    // safety classifier never sees pathological payloads, and so empty
    // strings collapse to undefined (the persistence path treats absent
    // fields and undefined identically via cleanDoc).
    let seedPremise: string | undefined;
    let seedTitle: string | undefined;
    let seedTone: string | undefined;
    if (typeof args.seedPremise === "string") {
      const trimmed = args.seedPremise.trim();
      if (trimmed.length > 0) {
        if (trimmed.length > 2000) throw new AppError("seed_premise_too_long");
        // Surface "publishing" matches the free-form choice flow's treatment
        // of user-typed narrative content: a blocked classification becomes
        // a hard block (reader rewords the premise) rather than a safe_end
        // that would close the tale on what's really a UI-level retry case.
        const { context: seedContext } = await resolveContentContext(
          ctx,
          args.accountId,
          "publishing",
        );
        const policy = evaluateTextPolicy({ text: trimmed, context: seedContext });
        if (policy.action === "block" || policy.action === "rewrite") {
          throw new AppError("seed_premise_blocked");
        }
        seedPremise = trimmed;
      }
    }
    if (typeof args.seedTitle === "string") {
      const trimmed = args.seedTitle.trim();
      if (trimmed.length > 0) {
        if (trimmed.length > 120) throw new AppError("seed_title_too_long");
        seedTitle = trimmed;
      }
    }
    if (typeof args.seedTone === "string") {
      const trimmed = args.seedTone.trim();
      if (trimmed.length > 0) {
        if (trimmed.length > 40) throw new AppError("seed_tone_too_long");
        seedTone = trimmed;
      }
    }

    // Validate authored NPC cast (Seed-an-Adventure "Optional cast" UI).
    // Each NPC's name must match the same allowlist used by the portrait
    // pipeline (so the portrait prompt can interpolate the name safely);
    // each description must pass evaluateTextPolicy in the publishing
    // surface (same gate seedPremise uses) so reader-typed prose can't
    // slip past safety. Validated NPCs are converted to NpcState rows and
    // merged into story.initialNpcs below, before buildCreateSavePlan
    // delegates to the engine's createInitialState (which seeds them into
    // state.npcs at save creation time per Requirement 31.7).
    const seedNpcsValidated: Array<{
      id: string;
      name: string;
      role: NpcRole;
      description: string;
    }> = [];
    if (Array.isArray(args.seedNpcs) && args.seedNpcs.length > 0) {
      if (args.seedNpcs.length > 8) throw new AppError("seed_npcs_too_many");
      const { context: npcContext } = await resolveContentContext(
        ctx,
        args.accountId,
        "publishing",
      );
      const seenIds = new Set<string>();
      for (const npc of args.seedNpcs) {
        const name = npc.name.trim();
        if (name.length === 0 || name.length > 40) {
          throw new AppError("seed_npc_name_invalid");
        }
        // Match convex/media/npcMedia.ts:NPC_NAME_ALLOWLIST exactly — the
        // portrait pipeline drops NPCs whose names fail this regex, so a
        // looser gate here would create roster entries that never get a
        // portrait queued.
        if (!/^[\p{L}\p{N} '\-]{1,40}$/u.test(name)) {
          throw new AppError("seed_npc_name_invalid");
        }
        const description = npc.description.trim();
        if (description.length < 8 || description.length > 200) {
          throw new AppError("seed_npc_description_invalid");
        }
        const policy = evaluateTextPolicy({ text: description, context: npcContext });
        if (policy.action === "block" || policy.action === "rewrite") {
          throw new AppError("seed_npc_blocked");
        }
        const id = slugifyNpcName(name);
        if (seenIds.has(id)) throw new AppError("seed_npc_duplicate_name");
        seenIds.add(id);
        seedNpcsValidated.push({ id, name, role: npc.role, description });
      }
    }

    const now = Date.now();
    let story = await loadStory(ctx, args.storyId, args.accountId);
    // Splice the validated seed NPCs onto the story's initialNpcs map so
    // the engine's createInitialState (called inside buildCreateSavePlan
    // via createSaveRecord) merges them into state.npcs at save creation.
    // We shallow-clone the story first — `loadStory` returns the cached
    // starter object directly, so mutating it would leak across all saves
    // in this Convex isolate. `cloneNpc`-style deep copies aren't needed
    // because each NPC here is freshly built from the validated input.
    if (seedNpcsValidated.length > 0) {
      const initialNpcs: Record<string, NpcState> = { ...(story.initialNpcs ?? {}) };
      for (const npc of seedNpcsValidated) {
        initialNpcs[npc.id] = {
          id: npc.id,
          name: npc.name,
          role: npc.role,
          disposition: 0,
          attributes: {},
          // engine clamps each fact to NPC_FACT_MAX_LENGTH (200) — our
          // 8-200 char description gate already lands inside that budget.
          knownFacts: [npc.description],
          flags: {},
        };
      }
      story = { ...story, initialNpcs };
    }
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
    // it up via save.voiceId. Seed fields are spread conditionally so
    // cleanDoc doesn't have to filter them — schema's optional() handles
    // the case where the reader launched a plain starter.
    save = {
      ...save,
      voiceId,
      ...(seedPremise ? { seedPremise } : {}),
      ...(seedTitle ? { seedTitle } : {}),
      ...(seedTone ? { seedTone } : {}),
    };
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
    const account = await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);
    const story = await loadStory(ctx, save.storyId, args.accountId);
    const storyMode = resolveStoryMode(save.storyId);
    if (storyMode === "llm-driven") {
      return projectLlmSceneFromRecord(ctx, save);
    }
    return await projectAuthoredSceneFromRecord(ctx, save, story);
  },
});

/**
 * Maximum number of past turns surfaced through `getRunHistory`. Defensive
 * cap so a very long-running save doesn't blow up the wire payload — the
 * archive UI streams a card per turn and 200 cards is already a long
 * scroll. Older turns sit behind `hasMore: true`; we deliberately don't
 * implement cursored pagination here (per the feature spec) — readers
 * with longer runs will see the 200 most-recent and a hint in the UI.
 */
const RUN_HISTORY_MAX_TURNS = 200;

/**
 * Build the canonical "scene archive" projection for a save: every past
 * turn the reader has lived through, joined with the matching scene record
 * and ready Pro-tier asset URIs (image / video / narrator). Used by the
 * `/read/[saveId]/history` archive view and by `/map/[saveId]`'s visited-
 * nodes map renderer.
 *
 * Auth gate mirrors `getCurrentScene`: requester must own the save AND
 * present a valid session for the matching account. The query never
 * surfaces engine flags or hidden state — only the prose, choice label,
 * and assets the reader has already seen are returned.
 */
export const getRunHistory = queryGeneric({
  args: { accountId, saveId, guestTokenHash },
  handler: async (ctx, args) => {
    const saveDoc = await ctx.db.get(args.saveId);
    if (!saveDoc) throw new AppError("save_not_found");
    const save = saveFromDoc(saveDoc);
    assertCanAccessSave(args.accountId, save);
    const account = await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);

    const story = await loadStory(ctx, save.storyId, args.accountId);

    // Pull turn_history rows in DESCENDING turn order so the take() cap
    // surfaces the MOST recent N turns when a save has gone long. We
    // reverse to oldest-first at the end so the archive scrolls top→down
    // in narrative time.
    const historyRows: any[] = await ctx.db
      .query("turn_history")
      .withIndex("by_save_turn", (q: any) => q.eq("saveId", args.saveId))
      .order("desc")
      .take(RUN_HISTORY_MAX_TURNS + 1);
    const hasMore = historyRows.length > RUN_HISTORY_MAX_TURNS;
    const cappedRows = hasMore
      ? historyRows.slice(0, RUN_HISTORY_MAX_TURNS)
      : historyRows;

    // Join each turn with its scene record by (saveId, turnNumber). The
    // scenes table is already indexed on `by_save_turn`; this is one DB
    // read per turn — bounded by the 200-cap above.
    const sceneRows = await Promise.all(
      cappedRows.map(async (row) => {
        const turnNumber =
          typeof row?.turnNumber === "number" ? row.turnNumber : null;
        if (turnNumber === null) return null;
        return await ctx.db
          .query("scenes")
          .withIndex("by_save_turn", (q: any) =>
            q.eq("saveId", args.saveId).eq("turnNumber", turnNumber),
          )
          .first();
      }),
    );

    // Asset join: for each scene row that has a real Convex id, look up
    // its ready image/video/narrator URIs via the same `by_scene` index
    // `getSceneMedia` uses. Filtering on `status === "ready"` mirrors the
    // contract — a queued / generating / failed asset never surfaces a
    // URI. Skip scene records with no _id (defensive).
    const sceneAssets = await Promise.all(
      sceneRows.map(async (scene) => {
        const sceneIdValue =
          scene && (scene as { _id?: unknown })._id
            ? String((scene as { _id: unknown })._id)
            : null;
        if (!sceneIdValue) return null;
        const docs: any[] = await ctx.db
          .query("assets")
          .withIndex("by_scene", (q: any) => q.eq("sceneId", sceneIdValue))
          .collect();
        return docs;
      }),
    );

    type HistoryTurn = {
      turnNumber: number;
      sceneId: string | null;
      nodeId: string;
      sceneTitle: string;
      prose: string;
      streamStatus:
        | "pending"
        | "streaming"
        | "complete"
        | "failed"
        | "blocked";
      completedAt: number | null;
      choice?: { choiceId: string; choiceLabel: string };
      media?: {
        imageUri?: string;
        videoUri?: string;
        narratorUri?: string;
        narratorVoiceId?: string;
      };
    };

    const turns: HistoryTurn[] = cappedRows.map((row, index) => {
      const scene = sceneRows[index] as Record<string, unknown> | null;
      const assets = (sceneAssets[index] ?? []) as Array<
        Record<string, unknown>
      >;

      const nodeId =
        (scene && typeof scene.nodeId === "string"
          ? (scene.nodeId as string)
          : null) ??
        (typeof row.fromNodeId === "string" ? (row.fromNodeId as string) : "");

      // Scene "title": authored stories have node.title; llm-driven scenes
      // have synthetic node ids with no title, in which case we fall back
      // to a "Turn N" label rather than leaking the synthetic id.
      const turnNumber = Number(row.turnNumber ?? 0);
      const authoredNode = story.nodes[nodeId];
      const sceneTitle =
        authoredNode?.title ??
        (nodeId && nodeId.includes(":llm:")
          ? `Turn ${turnNumber}`
          : nodeId || `Turn ${turnNumber}`);

      // Prose: scene.prose is the LLM-elaborated text we want to surface.
      // Fall back to "" when the scene record is missing or empty — the
      // client suppresses the prose block in that case.
      const prose =
        scene && typeof scene.prose === "string" ? (scene.prose as string) : "";

      const streamStatusRaw =
        scene && typeof scene.streamStatus === "string"
          ? (scene.streamStatus as string)
          : "complete";
      const streamStatus = (
        streamStatusRaw === "pending" ||
        streamStatusRaw === "streaming" ||
        streamStatusRaw === "complete" ||
        streamStatusRaw === "failed" ||
        streamStatusRaw === "blocked"
          ? streamStatusRaw
          : "complete"
      ) as HistoryTurn["streamStatus"];

      const completedAt =
        scene && typeof scene.completedAt === "number"
          ? (scene.completedAt as number)
          : null;

      // Reader's choice that LED INTO this scene. turn_history.choiceLabel
      // carries the human-readable label (free-form text for "Option D"
      // turns, the proposal's label for LLM-proposed turns). Legacy rows
      // without choiceLabel fall back to the raw choiceId so older saves
      // still render something usable.
      const choiceId =
        typeof row.choiceId === "string" ? (row.choiceId as string) : null;
      const choiceLabel =
        typeof row.choiceLabel === "string" && row.choiceLabel.length > 0
          ? (row.choiceLabel as string)
          : choiceId ?? "";
      const choice =
        choiceId !== null ? { choiceId, choiceLabel } : undefined;

      // Asset projection: pick the ready image / video / google-tts audio.
      // Mirrors the `getSceneMedia` filtering — only surface URIs whose
      // asset row is `status: ready` and carries a non-empty url.
      const readyImage = assets.find(
        (a) =>
          a.kind === "image" &&
          a.status === "ready" &&
          typeof a.url === "string" &&
          (a.url as string).length > 0,
      );
      const readyVideo = assets.find(
        (a) =>
          a.kind === "video" &&
          a.status === "ready" &&
          typeof a.url === "string" &&
          (a.url as string).length > 0,
      );
      const readyNarrator = assets.find(
        (a) =>
          a.kind === "audio" &&
          a.provider === "google-tts" &&
          a.status === "ready" &&
          typeof a.url === "string" &&
          (a.url as string).length > 0,
      );
      const narratorVoiceId =
        readyNarrator &&
        readyNarrator.provenance &&
        typeof (readyNarrator.provenance as { voiceId?: unknown }).voiceId ===
          "string"
          ? ((readyNarrator.provenance as { voiceId: string }).voiceId)
          : undefined;

      const media: HistoryTurn["media"] = {
        ...(readyImage ? { imageUri: readyImage.url as string } : {}),
        ...(readyVideo ? { videoUri: readyVideo.url as string } : {}),
        ...(readyNarrator ? { narratorUri: readyNarrator.url as string } : {}),
        ...(narratorVoiceId ? { narratorVoiceId } : {}),
      };
      const hasAnyMedia = Object.keys(media).length > 0;

      return {
        turnNumber,
        sceneId: scene && (scene as { _id?: unknown })._id
          ? String((scene as { _id: unknown })._id)
          : null,
        nodeId,
        sceneTitle,
        prose,
        streamStatus,
        completedAt,
        ...(choice ? { choice } : {}),
        ...(hasAnyMedia ? { media } : {}),
      };
    });

    // Reverse to oldest → newest narrative order. The DB returned
    // descending; the cap kept the most-recent N; flipping here surfaces
    // them top-down in turn order so the archive scrolls forward in time.
    turns.reverse();

    return {
      saveId: args.saveId,
      storyId: save.storyId,
      // Reader-authored title (Seed-an-Adventure) wins over the engine
      // story title — same precedence the rest of the system uses so the
      // archive header matches what the reader sees in /library.
      storyTitle: save.seedTitle ?? story.title,
      currentTurnNumber: save.turnNumber,
      turns,
      hasMore,
    };
  },
});

// Authored stories run the LLM to elaborate `node.seed` into multi-paragraph
// scene prose. `completeSceneStream` persists that prose onto the scene
// record alongside the new streamStatus, and `queueSceneNarration` reads it
// to generate the TTS clip. But the legacy `projectCurrentScene` was prose-
// blind to the scene record and always returned `node.seed`, so once the
// SSE stream finished and the client refetched, the on-screen prose
// snapped back to the short seed text while the narrator continued
// playing the LLM-elaborated clip — the "narration doesn't match screen
// text" bug. Prefer scene.prose when present; fall through to the
// projection's seed-derived prose when the record is empty or pending.
export async function projectAuthoredSceneFromRecord(
  ctx: { db: { get: (id: any) => Promise<any> } },
  save: SaveRecord,
  story: Story,
) {
  const projection = projectCurrentScene(save, story);
  if (!save.currentSceneId) return projection;
  const sceneDoc = await ctx.db.get(save.currentSceneId as any);
  if (!sceneDoc) return projection;
  const sceneProse = (sceneDoc as { prose?: string }).prose ?? "";
  const sceneStreamStatus = (sceneDoc as { streamStatus?: string }).streamStatus;
  const nextStreamStatus = (sceneStreamStatus === "pending" ||
    sceneStreamStatus === "streaming" ||
    sceneStreamStatus === "complete" ||
    sceneStreamStatus === "blocked" ||
    sceneStreamStatus === "failed"
    ? sceneStreamStatus
    : projection.streamStatus) as typeof projection.streamStatus;
  // Deterministic-fallback sentinel: surface only when actually true. The
  // reader UI uses this to render the FallbackTurnPanel in place of the
  // placeholder prose + choices the deterministic provider would emit.
  const sceneIsFallback = (sceneDoc as { isFallback?: boolean }).isFallback === true;
  return {
    ...projection,
    ...(sceneProse.length > 0 ? { prose: sceneProse } : {}),
    streamStatus: nextStreamStatus,
    ...(sceneIsFallback ? { isFallback: true } : {}),
  };
}

/**
 * Operator-grade rewind: delete the last N turns of a save and roll the
 * scene cursor back to the most recent kept turn. Surfaced so a reader
 * who got polluted prose from the deterministic fallback (the
 * "cat-ramen premise echo" bug) can chop off the bad turns and keep
 * playing instead of starting a new save.
 *
 * What this DOES:
 *  - Validates the caller owns the save.
 *  - Deletes the top-`dropTurns` turn_history rows (sorted DESC by
 *    turnNumber), the corresponding scene records, and any asset rows
 *    indexed off those sceneIds (image/video/narrator/anchor).
 *  - Rolls `save.currentSceneId` and `save.currentNodeId` back to the
 *    scene record at the new top turn (or to the start node when every
 *    turn is being dropped).
 *  - Clears `activeTurnRequestId` and any "streaming" lock so the next
 *    submitChoice path isn't blocked.
 *  - Patches `save.turnNumber` down to the new top.
 *  - Resets `save.status` to "active" if a death/ending was just chopped.
 *
 * What this does NOT do:
 *  - Fully replay engine state through the kept turns. The save's `state`
 *    keeps the most recent stat/currency/inventory/flag values (the
 *    post-dropped-turns shape); only the `currentNodeId` / `turnNumber`
 *    cursor is rolled back to the kept top so the engine and the projection
 *    agree on position (otherwise the next choice throws choice_not_found).
 *    Readers who want a clean stat rollback can start a fresh save instead.
 *  - Touch turn_history rows OR scenes OR assets belonging to OTHER
 *    saves. Every delete is scoped by the by_save_turn index then by
 *    the saveId field on the matched docs.
 */
export const rewindSaveTurns = mutationGeneric({
  args: {
    accountId,
    guestTokenHash,
    saveId,
    dropTurns: v.number(),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.dropTurns) || args.dropTurns < 1) {
      throw new AppError("rewind_drop_turns_invalid");
    }
    const save = await loadAndMigrateSave(ctx, args.saveId);
    if (!save) throw new AppError("save_not_found");
    assertCanAccessSave(args.accountId, save);
    const account = await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);

    // Pull every turn_history row for this save in ascending order so the
    // "last N" selection is unambiguous. by_save_turn is the right index;
    // we sort ASC and slice the tail.
    const history = await ctx.db
      .query("turn_history")
      .withIndex("by_save_turn", (q: any) => q.eq("saveId", args.saveId))
      .collect();
    history.sort((a: any, b: any) => a.turnNumber - b.turnNumber);

    const drop = Math.min(args.dropTurns, history.length);
    const droppedHistory = history.slice(history.length - drop);
    const keptHistory = history.slice(0, history.length - drop);

    // Drop the scene records by turnNumber. We can't trust that scene
    // turnNumbers line up 1:1 with turn_history (a turn that was blocked
    // by safety still writes a scene without a history row), so we
    // collect every scene whose turnNumber is greater than the new top.
    const newTopTurnNumber =
      keptHistory.length > 0
        ? (keptHistory[keptHistory.length - 1] as any).turnNumber
        : 0;
    const allScenes = await ctx.db
      .query("scenes")
      .withIndex("by_save_turn", (q: any) => q.eq("saveId", args.saveId))
      .collect();
    allScenes.sort((a: any, b: any) => a.turnNumber - b.turnNumber);
    const droppedScenes = allScenes.filter(
      (s: any) => s.turnNumber > newTopTurnNumber,
    );
    const keptScenes = allScenes.filter(
      (s: any) => s.turnNumber <= newTopTurnNumber,
    );

    // Cascade-delete: assets indexed off the dropped scenes' ids. Skip
    // assets that have no sceneId (anchor portraits etc. are scoped by
    // save, not scene — leave them alone).
    for (const scene of droppedScenes) {
      const sceneAssets = await ctx.db
        .query("assets")
        .withIndex("by_scene", (q: any) => q.eq("sceneId", scene._id))
        .collect();
      for (const asset of sceneAssets) {
        await ctx.db.delete(asset._id);
      }
      await ctx.db.delete(scene._id);
    }
    for (const row of droppedHistory) {
      await ctx.db.delete(row._id);
    }

    // Compute the new save cursor.
    const newTopScene = keptScenes[keptScenes.length - 1];
    const story = await loadStory(ctx, save.storyId, args.accountId);
    const fallbackNodeId = story.startNodeId;
    const nextCurrentSceneId = newTopScene ? newTopScene._id : undefined;
    const nextCurrentNodeId = newTopScene
      ? ((newTopScene as { nodeId?: string }).nodeId ?? fallbackNodeId)
      : fallbackNodeId;
    const nextTurnNumber = newTopTurnNumber;

    // If the original save had ended (death / safe / success), restore it
    // to active when the dropped turns included the terminal — keeps the
    // reader from being stuck on an ending panel after the rewind.
    const nextStatus: "active" | "dead" | "ended" | "ended_safely" =
      save.status === "active" ? "active" : "active";

    // Roll the engine state's cursor back in lockstep with the save cursor.
    // We deliberately keep the most-recent stat/currency/inventory/flag shape
    // (see the docstring — full replay is out of scope), but `state.currentNodeId`
    // and `state.turnNumber` MUST match the kept top: submitChoice /
    // beginStreamingChoice call applyChoiceAndEnterNode(save.state, ...) which
    // looks up story.nodes[state.currentNodeId]. If state still points at the
    // dropped node, the rendered choices (projected from the patched
    // save.currentNodeId) won't exist on it and every choice throws
    // choice_not_found — a permanently bricked save. Keeping turnNumber in sync
    // also stops llm-driven turns from re-numbering back over the hole.
    const priorState = (save.state ?? {}) as PlayerState;
    const nextState: PlayerState = {
      ...priorState,
      currentNodeId: nextCurrentNodeId,
      turnNumber: nextTurnNumber,
    };

    await ctx.db.patch(args.saveId, {
      currentNodeId: nextCurrentNodeId,
      ...(nextCurrentSceneId ? { currentSceneId: nextCurrentSceneId } : {}),
      turnNumber: nextTurnNumber,
      state: nextState,
      status: nextStatus,
      activeTurnRequestId: undefined,
      updatedAt: Date.now(),
    });

    // Clear any "streaming" lock on the new top scene so the reader
    // doesn't sit on a stale pending state. completeSceneStream's
    // streamStatus locking treats anything other than "complete"/
    // "blocked"/"streaming" as eligible for a fresh stream; we
    // explicitly force "complete" here since the kept scene already has
    // its persisted prose.
    if (newTopScene) {
      const currentStatus = (newTopScene as { streamStatus?: string }).streamStatus;
      if (currentStatus !== "complete" && currentStatus !== "blocked") {
        await ctx.db.patch(newTopScene._id, {
          streamStatus: "complete" as const,
          streamStartedAt: undefined,
        });
      }
    }

    return {
      saveId: args.saveId,
      droppedTurnCount: droppedHistory.length,
      droppedSceneCount: droppedScenes.length,
      newTopTurnNumber: nextTurnNumber,
      currentNodeId: nextCurrentNodeId,
      currentSceneId: nextCurrentSceneId ?? null,
    };
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
    const save = await loadAndMigrateSave(ctx, args.saveId);
    if (!save) throw new AppError("save_not_found");
    assertCanAccessSave(args.accountId, save);
    const account = await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);

    const now = Date.now();
    // Idempotent replay: a duplicate requestId within the TTL returns the
    // original result without re-running the turn or re-consuming the budget.
    const cachedSubmit = await readIdempotentTurnResult(
      ctx,
      "submitChoice",
      args.requestId,
      args.accountId,
      args.saveId,
      now,
    );
    if (cachedSubmit) return cachedSubmit;
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
      const llmResult = await runLlmDrivenSubmitChoice(ctx, {
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
      // Req 14.4: record for idempotent replay (the cache read above covers
      // llm-driven too; without this record only authored turns were guarded).
      await recordIdempotentTurnResult(ctx, {
        scope: "submitChoice",
        requestId: args.requestId,
        accountId: args.accountId,
        saveId: args.saveId,
        result: llmResult,
        now,
      });
      return llmResult;
    }

    // Req 11.1: classify the memory window (which includes the appended seed)
    // before it is threaded into the prompt via submitTurn.
    const memory = guardMemoryBeats(
      await loadMemoryWindow(ctx, args.saveId, story.nodes[save.currentNodeId]?.seed ?? ""),
      contentContext,
    );
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

    // Turn-completion analytics (Req 15.2 / 27.2-27.5) for the authored
    // non-streaming path — real provider + token usage + per-stage latency
    // from submitTurn's inline engine + LLM step.
    {
      const tokenUsage = result.history.tokenUsage ?? estimateTokenUsage("", result.prose);
      await insertTurnCompletedAnalytics(ctx, {
        accountId: args.accountId,
        saveId: args.saveId,
        storyId: save.storyId,
        turnNumber: result.save.turnNumber,
        provider: normalizeProviderName(result.provider),
        inputTokens: tokenUsage.input,
        outputTokens: tokenUsage.output,
        engineMs: result.history.latency.engineMs,
        llmMs: result.history.latency.llmMs,
        totalMs: result.history.latency.engineMs + result.history.latency.llmMs,
        fallback: false,
        createdAt: now,
      });
    }
    // Authored terminal (death / success via node endingId) → record the
    // ending unlock (Req 8.1 / 19.1). Engine state already carries the
    // UnlockedEnding via applyChoiceAndEnterNode's unlockCurrentEnding.
    const submittedTerminal = resolveTerminal(result.save.state, story);
    if (submittedTerminal) {
      await recordEndingUnlock(ctx, {
        accountId: args.accountId,
        unlock: unlockedEndingForTerminal(result.save, result.save.state, submittedTerminal),
        safetyEnding: false,
      });
    }

    const submitResponse = { saveId: args.saveId, sceneId, scene: result.scene, prose: result.prose };
    await recordIdempotentTurnResult(ctx, {
      scope: "submitChoice",
      requestId: args.requestId,
      accountId: args.accountId,
      saveId: args.saveId,
      result: submitResponse,
      now,
    });
    return submitResponse;
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
    const save = await loadAndMigrateSave(ctx, args.saveId);
    if (!save) throw new AppError("save_not_found");
    assertCanAccessSave(args.accountId, save);
    const account = await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);
    if (save.activeTurnRequestId && save.activeTurnRequestId !== args.requestId) throw new AppError("turn_in_progress");

    const now = Date.now();
    // Idempotent replay: a duplicate requestId within the TTL returns the
    // original result without re-consuming the budget or re-opening a turn.
    const cachedBegin = await readIdempotentTurnResult(
      ctx,
      "beginStreamingChoice",
      args.requestId,
      args.accountId,
      args.saveId,
      now,
    );
    if (cachedBegin) return cachedBegin;
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
    const storyMode = resolveStoryMode(save.storyId);
    // Validate the free-form ("Option D") payload BEFORE consuming the
    // reader's daily turn budget. Previously `consumeTurn` ran first, so a
    // typed action rejected for being empty / too long / policy-blocked
    // still burned a turn — the reader lost budget for a request the server
    // never processed. Moving validation upstream keeps the budget aligned
    // with turns the engine actually advances on.
    //
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

    // Only NOW consume the daily budget — every validation gate above has
    // passed and the turn is guaranteed to advance (modulo downstream LLM
    // failures, which are tracked separately via scene streamStatus).
    const dailyCounter = consumeTurn({
      counter: dailyCounterDoc ? dailyCounterFromDoc(dailyCounterDoc) : null,
      accountId: args.accountId,
      dayKey,
      now,
      resetAt: nextUtcMidnight(now),
      allowance: dailyAllowance(entitlement),
    });
    if (storyMode === "llm-driven") {
      const llmBeginResult = await runLlmDrivenBeginStreaming(ctx, {
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
      // Req 14.4: record for idempotent replay so a duplicate delivery of this
      // requestId returns the original result instead of re-running the turn
      // (which threw llm_prior_proposal_missing on the now-pending scene).
      await recordIdempotentTurnResult(ctx, {
        scope: "beginStreamingChoice",
        requestId: args.requestId,
        accountId: args.accountId,
        saveId: args.saveId,
        result: llmBeginResult,
        now,
      });
      return llmBeginResult;
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
      // Story-driven authored terminal (death / success / safe via node
      // endingId). Record the ending unlock (Req 8.1 / 19.1) — engine state
      // already holds the UnlockedEnding via applyChoiceAndEnterNode's
      // unlockCurrentEnding. Not a safety-forced exit, so safetyEnding=false.
      await recordEndingUnlock(ctx, {
        accountId: args.accountId,
        unlock: unlockedEndingForTerminal(nextSave, nextSave.state, terminal),
        safetyEnding: false,
      });
      // Deterministic terminals never enter the SSE stream (stream:false), so
      // completeSceneStream won't emit their turn-completion analytics — do it
      // here (provider deterministic, no LLM tokens) so the turn is counted.
      await insertTurnCompletedAnalytics(ctx, {
        accountId: args.accountId,
        saveId: args.saveId,
        storyId: save.storyId,
        turnNumber: nextSave.turnNumber,
        provider: "deterministic",
        inputTokens: 0,
        outputTokens: 0,
        engineMs: 0,
        llmMs: 0,
        fallback: false,
        createdAt: now,
      });
    }

    const beginResponse = {
      saveId: args.saveId,
      sceneId,
      scene: { ...sceneProjection, prose: scene.prose, streamStatus: scene.streamStatus },
      stream: !terminal,
    };
    await recordIdempotentTurnResult(ctx, {
      scope: "beginStreamingChoice",
      requestId: args.requestId,
      accountId: args.accountId,
      saveId: args.saveId,
      result: beginResponse,
      now,
    });
    return beginResponse;
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
    const account = await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);
    return { ok: true };
  },
});

/**
 * TTL on the "streaming" lock. If a scene has been in `streaming` for longer
 * than this, we assume the prior holder crashed or disconnected and let a
 * fresh stream claim the lock. Set generously above Vertex's typical stream
 * duration so legitimate slow runs aren't yanked out from under themselves,
 * but well below the user-visible "the candle guttered out" threshold so a
 * crashed stream can be retried within one reader-attention span.
 */
// Must exceed `LLM_TIMEOUT_MS` (currently 180_000) plus a small buffer.
// If the lock expires while a real LLM call is still in flight, a sibling
// stream open (React StrictMode remount, retry button mash, second tab)
// passes the dedup guard and runs concurrently — both finish, both call
// completeSceneStream, double-queueing media and overwriting prose. The
// previous 30_000 was set when the LLM call was expected to land in
// ~5-10s; with real Gemini calls observed at 30-90s, that ceiling was
// far too low. 200_000 covers the LLM timeout plus a 20s buffer for the
// completeSceneStream mutation + media queueing.
const SCENE_STREAM_LOCK_TTL_MS = 200_000;

/**
 * Reset the current scene so the next `/llm/scene-stream` call is allowed
 * to run. Required for the FallbackTurnPanel "Try again" button: when the
 * deterministic provider was persisted (every real provider failed), the
 * scene's `streamStatus` is "complete" and `getAuthorizedSceneStreamRequest`
 * rejects with `scene_stream_not_pending` (HTTP 403). This mutation
 * un-finalises the scene so the retry SSE can open.
 *
 * What it does:
 *   - Validates the caller owns the save (same auth gate as every other
 *     query/mutation here).
 *   - Refuses to reset scenes that already carry a terminal (death / safe
 *     / success ending) — those are real story end-states, not failures.
 *   - Patches the scene to `streamStatus: "pending"`, clears `isFallback`,
 *     `prose`, `proposal`, `terminal`, `streamStartedAt`, `completedAt`,
 *     and `provider` so the next stream's writer sees a fresh slate.
 *   - Sets `save.activeTurnRequestId` to a fresh UUID so
 *     `getAuthorizedSceneStreamRequest` accepts the next SSE open.
 */
export const retryCurrentScene = mutationGeneric({
  args: {
    accountId,
    saveId,
    guestTokenHash,
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const saveDoc = await ctx.db.get(args.saveId);
    if (!saveDoc) throw new AppError("save_not_found");
    const save = saveFromDoc(saveDoc);
    assertCanAccessSave(args.accountId, save);
    const account = await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);
    if (!save.currentSceneId) throw new AppError("scene_not_found");
    const sceneDoc = await ctx.db.get(save.currentSceneId as any);
    if (!sceneDoc) throw new AppError("scene_not_found");
    // Refuse to clobber a real ending — terminal scenes are the reader's
    // canonical outcome, not a retry candidate. The fallback panel only
    // ever surfaces for non-terminal scenes that fell to deterministic.
    const sceneTerminal = (sceneDoc as { terminal?: unknown }).terminal;
    if (sceneTerminal && typeof sceneTerminal === "object" && sceneTerminal !== null) {
      throw new AppError("scene_terminal_not_retryable");
    }
    const now = Date.now();
    await ctx.db.patch(save.currentSceneId as any, {
      streamStatus: "pending" as const,
      prose: "",
      isFallback: undefined,
      proposal: undefined,
      provider: undefined,
      streamStartedAt: undefined,
      completedAt: undefined,
      // Defensive: the guard at line 1214 already refuses retries on
      // terminal scenes, but Convex's patch leaves omitted fields
      // unchanged, so explicit `undefined` documents intent and protects
      // future callers that might bypass the guard.
      terminal: undefined,
      // safety: leave previous record so we don't lose blocked-history;
      // the next completeSceneStream will overwrite it with the fresh
      // policy evaluation.
    });
    await ctx.db.patch(args.saveId, {
      activeTurnRequestId: args.requestId,
      updatedAt: now,
    });
    return { ok: true } as const;
  },
});

export const getAuthorizedSceneStreamRequest = mutationGeneric({
  args: { accountId, saveId, guestTokenHash },
  handler: async (ctx, args) => {
    const saveDoc = await ctx.db.get(args.saveId);
    if (!saveDoc) throw new AppError("save_not_found");
    const save = saveFromDoc(saveDoc);
    assertCanAccessSave(args.accountId, save);
    const account = await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);
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
    // Defense-in-depth dedup against double-opened SSE streams. When two
    // browser tabs (or, more commonly, a racing useTurn mount-effect and a
    // submitChoice call) both POST `/llm/scene-stream` for the same save,
    // the second one cancels the first browser-side; Vertex throws
    // `AbortError`, the LLM router falls back to the deterministic provider,
    // and the reader sees their premise echoed back as the scene prose
    // (252 chars instead of ~1200). Mark the scene as "streaming" with a
    // timestamp here so concurrent callers within the TTL window are
    // rejected with `scene_stream_in_progress`. The completion path keeps
    // its own guard for the COMPLETION write — this guard fires at REQUEST
    // time, well before that.
    const now = Date.now();
    const claimedAt = (sceneDoc as { streamStartedAt?: number }).streamStartedAt;
    if (
      streamStatus === "streaming" &&
      typeof claimedAt === "number" &&
      now - claimedAt < SCENE_STREAM_LOCK_TTL_MS
    ) {
      throw new AppError("scene_stream_in_progress");
    }
    await ctx.db.patch(save.currentSceneId as any, {
      streamStatus: "streaming" as const,
      streamStartedAt: now,
    });
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
      // Reader-authored seed (createSave's "Seed an adventure" flow) overrides
      // the starter story's hardcoded seed/title/tone when present. Falling
      // back to the starter map keeps every existing save unaffected.
      const seedPremiseValue = save.seedPremise ?? startNode?.seed;
      const storyToneValue = save.seedTone ?? summary?.tone;
      // Req 11.1: classify the seed + memory window before they enter the prompt.
      const guardedSeed = guardSeedText(seedPremiseValue ?? "", contentContext);
      const memory = guardMemoryBeats(
        await loadMemoryWindow(ctx, args.saveId, seedPremiseValue ?? ""),
        contentContext,
      );
      const npcSheets = await buildNpcSheetsForSave(ctx, save, args.saveId);
      return {
        saveId: args.saveId,
        storyId: story.id,
        storyTitle: save.seedTitle ?? story.title,
        ...(storyToneValue ? { storyTone: storyToneValue } : {}),
        ...(guardedSeed ? { premise: guardedSeed } : {}),
        turnNumber: save.turnNumber,
        nodeId: save.currentNodeId,
        seed: guardedSeed,
        memory,
        choices: [],
        sceneLength: story.defaultSceneLength ?? "standard",
        contentContext,
        risk: "normal",
        entitlementTier,
        retryCount: 0,
        mode: "llm-driven",
        playerState: snapshotPlayerState(save.state),
        ...(npcSheets.length > 0 ? { npcSheets } : {}),
        // Running summary maintained by `convex/llm/summarizer.ts`. Absent
        // on the opening turn (nothing to summarise) and on legacy saves.
        ...(save.storySummary ? { storySummary: save.storySummary } : {}),
      };
    }

    const node = story.nodes[save.currentNodeId];
    if (!node) throw new AppError("node_not_found");
    if (resolveTerminal(save.state, story)) throw new AppError("scene_stream_not_required");
    // Req 11.1: classify authored seed + memory window before prompt assembly.
    const guardedNodeSeed = guardSeedText(node.seed ?? "", contentContext);
    const memory = guardMemoryBeats(
      await loadMemoryWindow(ctx, args.saveId, node.seed ?? ""),
      contentContext,
    );
    return {
      saveId: args.saveId,
      storyId: story.id,
      nodeId: node.id,
      seed: guardedNodeSeed,
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
    /**
     * The streaming provider's reported token usage, forwarded from the SSE
     * handler. Persisted verbatim on turn_history so the operator cost
     * dashboard sees real input/output counts. Falls back to a prose-based
     * estimate (input still unknown → 0) only when the provider didn't report.
     */
    tokenUsage: v.optional(v.object({ input: v.number(), output: v.number() })),
    /**
     * Out-of-band sentinel forwarded from the SSE handler when the router
     * fell through to the deterministic provider (every real provider failed
     * / was ineligible). Persisted on the scene record so the projection +
     * reader UI render the FallbackTurnPanel instead of pretending the
     * placeholder prose + choices are a real scene. Treated as `false` when
     * absent — real-provider scenes never set this.
     */
    isFallback: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const save = await loadAndMigrateSave(ctx, args.saveId);
    if (!save) throw new AppError("save_not_found");
    assertCanAccessSave(args.accountId, save);
    const account = await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);
    if (!save.currentSceneId) throw new AppError("scene_not_found");
    const now = Date.now();
    const story = await loadStory(ctx, save.storyId, args.accountId);
    const storyMode = resolveStoryMode(save.storyId);

    // Idempotency guard. The authorize-and-claim mutation
    // (`getAuthorizedSceneStreamRequest`) now sets the scene to
    // `streamStatus: "streaming"` at the start of the SSE handler, so by
    // the time we reach here the canonical state is always "streaming"
    // (modulo retry-from-failed). We only need to guard against terminal
    // states leaking back in: a duplicate completion that arrives after
    // the scene has already been finalised must NOT overwrite the prose,
    // re-queue media, or burn a second Veo / Imagen quota slot. The
    // pre-claim dedup against concurrent streams now lives in
    // `getAuthorizedSceneStreamRequest`, so the second SSE handler never
    // reaches this mutation at all.
    {
      const existingScene = await ctx.db.get(save.currentSceneId as any);
      const existingStatus = (existingScene as { streamStatus?: string } | null)?.streamStatus;
      if (existingStatus === "complete" || existingStatus === "blocked") {
        return { ok: true, deduped: true } as const;
      }
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
      // Redacted safety.blocked row (Req 11.9 / 15.6) — metadata only.
      await insertSafetyAnalytics(ctx, {
        action: proseChoicePolicy.action,
        categories: proseChoicePolicy.safetyCategories,
        accountId: args.accountId,
        saveId: args.saveId,
        storyId: save.storyId,
        turnNumber: save.turnNumber,
        provider: args.provider,
        now,
      });
      return { ok: true, blocked: true };
    }
    const policyForcedSafe =
      proseChoicePolicy.action === "safe_end" ||
      proseChoicePolicy.action === "safe_redirect";

    // LLM-driven scenes carry a structured proposal — validate it via the
    // engine's Zod schema, apply terminal handling, then persist proposal +
    // choice views to the scene record.
    if (storyMode === "llm-driven") {
      // Missing / malformed proposal is fatal for llm-driven streams. We must
      // fail-loud so the SSE client sees `event: error` and the scene becomes
      // retry-eligible. NOTE: this mutation is atomic — throwing rolls back any
      // patch we make here, so we do NOT persist the failed state inline (that
      // write would be discarded). Instead the throw propagates to the SSE
      // handler's catch, which runs `failSceneStream` to persist
      // streamStatus:"failed" while PRESERVING activeTurnRequestId — leaving the
      // turn retry-eligible via getAuthorizedSceneStreamRequest. Just throw.
      if (args.proposal === undefined) {
        throw new AppError("llm_scene_invalid_shape");
      }
      const parsedProposal = llmSceneOutputSchema.safeParse(args.proposal);
      if (!parsedProposal.success) {
        // Bad payload — same contract as the missing-proposal branch above:
        // throw, let failSceneStream persist the failed state + keep the turn
        // retryable. An inline patch here would only roll back.
        throw new AppError("llm_scene_invalid_shape");
      }
      const proposal: LlmSceneProposal | null = parsedProposal.data
        ? guardEarlyTerminal(parsedProposal.data, save.turnNumber)
        : null;
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
        streamStatus: "complete",
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
        // Persist (or explicitly clear) the deterministic-fallback sentinel.
        // The retry path (`useTurn.retryCurrentTurn`) re-streams the same
        // scene, and a real provider's completion needs to flip the flag
        // back to false so the FallbackTurnPanel hides itself.
        isFallback: args.isFallback === true,
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
      // Terminal → record the ending unlock (Req 8.1 / 11.4 / 19.1). Idempotent
      // per (account, ending); safetyEnding flags classifier-forced safe exits.
      if (terminal) {
        await recordEndingUnlock(ctx, {
          accountId: args.accountId,
          unlock: unlockedEndingForTerminal(save, nextState, terminal),
          safetyEnding: policyForcedSafe,
        });
        // Endpoint-cinematics: the ending is the highest-value trigger (Req 2.4).
        await maybeScheduleEndingCinematic(ctx, {
          accountId: args.accountId,
          saveId: args.saveId,
          endingId: terminal.endingId,
        });
      }
      // Safe-terminal forced by the safety classifier → redacted safety.ended /
      // safety.redirected row (Req 11.9 / 15.6).
      if (policyForcedSafe) {
        await insertSafetyAnalytics(ctx, {
          action: proseChoicePolicy.action,
          categories: proseChoicePolicy.safetyCategories,
          accountId: args.accountId,
          saveId: args.saveId,
          storyId: save.storyId,
          turnNumber: save.turnNumber,
          provider: args.provider,
          now,
        });
      }
      // NPC portraits: schedule a 1:1 Imagen job for any NPC id that
      // appeared in `state.npcs` on this turn (true spawn) and doesn't
      // already carry a `portraitAssetId`. The engine package (other
      // agent) owns NPC state mutations — this trigger is shape-only and
      // tolerates state shapes it doesn't recognise. The cast bypasses
      // TS until the engine agent's NpcState lands in the convex tree.
      try {
        const priorNpcs = (save.state as { npcs?: Record<string, any> } | undefined)?.npcs;
        const nextNpcs = (nextState as { npcs?: Record<string, any> } | undefined)?.npcs;
        await schedulePortraitsForNewNpcs(ctx, {
          accountId: args.accountId,
          saveId: args.saveId,
          priorNpcs,
          nextNpcs,
        });
      } catch {
        // Portraits are a Pro extra — text + roster name are the contract.
      }
      // Reference-image carry-over: schedule the two save-level anchors
      // (protagonist + setting) when this is the opening turn and the
      // LLM emitted matching anchor descriptions. Idempotent at the
      // queueAnchorImage layer via `save.anchorProtagonistAssetId` /
      // `save.anchorSettingAssetId` — a duplicate completion on the same
      // opening (the SSE-re-mount race the existing dedup guards against)
      // will find a pointer already set and bail. Subsequent scenes
      // (turn 2+) just thread these anchors as references via
      // `queueSceneImage`; nothing to do here.
      try {
        if (proposal && save.turnNumber === 0) {
          const protoText = proposal.protagonistAnchor?.trim();
          const settingText = proposal.settingAnchor?.trim();
          if (protoText && !save.anchorProtagonistAssetId) {
            await ctx.runMutation(
              ("media/sceneMedia:queueAnchorImage" as unknown) as any,
              {
                accountId: args.accountId,
                saveId: args.saveId,
                kind: "protagonist" as const,
                prompt: protoText,
              },
            );
          }
          if (settingText && !save.anchorSettingAssetId) {
            await ctx.runMutation(
              ("media/sceneMedia:queueAnchorImage" as unknown) as any,
              {
                accountId: args.accountId,
                saveId: args.saveId,
                kind: "setting" as const,
                prompt: settingText,
              },
            );
          }
        }
      } catch {
        // Anchors are a Pro-tier consistency enhancer — text and the
        // scene-image fallback chain stay intact when the queue fails.
      }
      // Endpoint-cinematics OPENING trigger (Req 2.1 / C3). Scheduled on
      // turn-1 completion right after the anchor jobs; queueEndpointCinematic
      // reschedules itself until the anchors land, then produces the title
      // sequence behind the reader. Strategy-gated + best-effort. Fires even
      // when the LLM emitted no anchor text (proceeds reference-less after the
      // settle window) so every endpoint_cinematic run still gets an opening.
      if (save.turnNumber === 0 && !terminal) {
        await maybeScheduleOpeningCinematic(ctx, {
          accountId: args.accountId,
          saveId: args.saveId,
        });
      }
      // Endpoint-cinematics CHAPTER trigger (P2 / C1). On a non-terminal turn
      // completion past the opening, fire a stinger on the server turn-number
      // cadence. Best-effort + strategy-gated; the queue mutation enforces the
      // per-run cap + dedupe. `save.turnNumber` is the just-completed turn here
      // (same value the opening branch keys 0 on), so cadence phase is stable.
      if (save.turnNumber > 0 && !terminal) {
        await maybeScheduleChapterCinematic(ctx, {
          accountId: args.accountId,
          saveId: args.saveId,
          turnNumber: save.turnNumber,
        });
      }
      // Pro media for llm-driven scenes happens below (same code path as
      // authored streams). Fall through.
    } else {
      await ctx.db.patch(save.currentSceneId as any, {
        prose: args.prose,
        streamStatus: "complete",
        provider: args.provider,
        completedAt: now,
        // Authored-mode parity with the llm-driven branch above — persist /
        // clear the deterministic-fallback sentinel so retries flip the
        // FallbackTurnPanel off when a real provider succeeds.
        isFallback: args.isFallback === true,
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
      // Authored streams only hit a terminal here when the safety classifier
      // forces a safe exit (story-driven authored terminals resolve in the
      // deterministic beginStreamingChoice path). Record the safe ending +
      // redacted safety row (Req 11.4 / 11.9 / 15.6).
      if (policyForcedSafe) {
        await recordEndingUnlock(ctx, {
          accountId: args.accountId,
          unlock: unlockedEndingForTerminal(save, save.state, {
            kind: "safe",
            endingId: "ending-safe",
          }),
          safetyEnding: true,
        });
        await maybeScheduleEndingCinematic(ctx, {
          accountId: args.accountId,
          saveId: args.saveId,
          endingId: "ending-safe",
        });
        await insertSafetyAnalytics(ctx, {
          action: proseChoicePolicy.action,
          categories: proseChoicePolicy.safetyCategories,
          accountId: args.accountId,
          saveId: args.saveId,
          storyId: save.storyId,
          turnNumber: save.turnNumber,
          provider: args.provider,
          now,
        });
      }
    }

    // Pro media: queue an Imagen job for this scene. The mutation gates on
    // Pro entitlement (or CYOA_DEV_FORCE_PRO_MEDIA=1) and schedules the
    // async action that fills the asset URL. Text streaming never blocks
    // on media; this is fire-and-forget — failures land in the asset's
    // status and the MediaPlate gracefully holds at Skeleton. We skip the
    // media queue when the safety classifier forced a safe exit on this
    // scene — there is no scene to illustrate.
    if (!policyForcedSafe) {
      // Image/video prompt: prefer the LLM's structured `visualDescription`
      // (concrete subject + setting + spatial objects + composition, written
      // by the same model that wrote the prose so the visual matches the
      // scene). Fall back to truncated prose only when the field is absent
      // — which produces incoherent images because the drawer doesn't know
      // what the writer was thinking, and is exactly why some prompts came
      // out misaligned with the story.
      const proposalForVisual = args.proposal
        ? (() => {
            const parsed = llmSceneOutputSchema.safeParse(args.proposal);
            return parsed.success ? parsed.data : null;
          })()
        : null;
      const visualPrompt =
        proposalForVisual?.visualDescription?.trim() || extractVisualFallback(args.prose);
      try {
        await ctx.runMutation(
          ("media/sceneMedia:queueSceneImage" as unknown) as any,
          {
            accountId: args.accountId,
            saveId: args.saveId,
            sceneId: save.currentSceneId,
            nodeId: save.currentNodeId,
            prompt: visualPrompt,
            alt: `Scene illustration for ${save.currentNodeId}`,
          },
        );
      } catch {
        // Pro media is non-fatal — text is the contract, images are a tier.
      }
      // Video is queued by runImagenJob after the image is ready so Veo
      // can use the still as its first-frame reference (i2v). Queueing it
      // separately here would race Imagen, produce a text-only Veo whose
      // first frame doesn't match the still, AND double Veo API spend
      // per scene — the free-tier 10 RPD quota burns through twice as
      // fast when both paths fire.
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
      // Carry the streamed proposal's `npcMentions` through to turn_history
      // so the next prompt-builder pass picks the right NPC sheets. Parse
      // defensively — the proposal field is `v.any()` on the wire so a
      // mis-shaped payload must not throw inside this completion path.
      const proposalParsed = args.proposal
        ? llmSceneOutputSchema.safeParse(args.proposal)
        : null;
      const npcMentions = proposalParsed?.success
        ? proposalParsed.data.npcMentions
        : undefined;
      await ctx.db.patch(history._id, {
        provider: args.provider,
        // Prefer the provider's real token usage (forwarded from the SSE
        // handler). The estimate fallback only knows the output prose, so its
        // input count is 0 — good enough as a floor when the provider is silent.
        tokenUsage: args.tokenUsage ?? estimateTokenUsage("", args.prose),
        latency: { ...(history.latency as Record<string, unknown>), llmMs: Math.max(0, now - history.createdAt) },
        ...(npcMentions ? { mentionsExtracted: npcMentions } : {}),
      });
    }

    // Turn-completion analytics (Req 15.2 / 27.2-27.5). This is the streaming
    // turn's completion point for BOTH authored-elaboration and llm-driven
    // scenes — provider, token usage, LLM latency, and the deterministic-
    // fallback flag all land here so the operator dashboard can compute
    // tokens/session, cost-per-turn-by-provider, and fallback rate. The
    // pre-stream turn_history row created the `createdAt` we measure llmMs from.
    {
      const tokenUsage = args.tokenUsage ?? estimateTokenUsage("", args.prose);
      const llmMs = history ? Math.max(0, now - (history.createdAt as number)) : undefined;
      await insertTurnCompletedAnalytics(ctx, {
        accountId: args.accountId,
        saveId: args.saveId,
        storyId: save.storyId,
        turnNumber: save.turnNumber,
        provider: args.provider,
        inputTokens: tokenUsage.input,
        outputTokens: tokenUsage.output,
        ...(llmMs === undefined ? {} : { llmMs, totalMs: llmMs }),
        fallback: args.isFallback === true,
        createdAt: now,
      });
    }

    // Running "story so far" summary. Schedule non-blocking — the action
    // calls the cheapest configured LLM with a tight prompt, sanitises the
    // reply, and patches `save.storySummary` so the next scene prompt has
    // canonical continuity context (Bug fix: LLM repeated "open the
    // coconut" on a beach story because the 6-turn memory window only
    // carries excerpts + labels). The summarizer is failure-safe: any
    // exception inside the action logs and leaves the prior summary in
    // place. We deliberately read the choice label from the SAME turn_history
    // row that completeSceneStream's `history.choiceLabel` carries — that
    // is the choice the reader picked to LAND on this just-completed scene,
    // which is exactly the "reader's choice this turn" the summarizer needs.
    // We skip when the scene is blocked / forced-safe (no useful state to
    // summarise) and when storyMode is not llm-driven (authored stories have
    // their own continuity in the node graph).
    if (storyMode === "llm-driven" && !policyForcedSafe) {
      try {
        const choiceLabel =
          (history as { choiceLabel?: string } | null)?.choiceLabel ?? "";
        const premise = save.seedPremise ?? "";
        await ctx.scheduler.runAfter(
          0,
          ("llm/summarizer:summarizeStory" as unknown) as any,
          {
            saveId: args.saveId,
            accountId: args.accountId,
            priorSummary: save.storySummary ?? "",
            lastSceneExcerpt: args.prose.slice(0, 300),
            lastChoiceLabel: choiceLabel,
            premise,
            // `save.turnNumber` is the just-completed turn number (the
            // streaming path advanced the cursor in `beginStreamingChoice`
            // before the SSE began). That's the right value to label the
            // summary with — the NEXT scene prompt reads it as "what's
            // already happened, up to and including turn N".
            turnNumber: save.turnNumber,
          },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[completeSceneStream] summarizer schedule failed save=${args.saveId} error=${message.slice(0, 240)}`);
      }
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
    const save = await loadAndMigrateSave(ctx, args.saveId);
    if (!save) throw new AppError("save_not_found");
    assertCanAccessSave(args.accountId, save);
    const account = await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);
    const now = Date.now();
    if (save.currentSceneId) {
      await ctx.db.patch(save.currentSceneId as any, {
        streamStatus: "failed",
        completedAt: now,
      });
    }
    // Preserve `activeTurnRequestId`. A failed stream must stay retry-eligible:
    // `getAuthorizedSceneStreamRequest` accepts a "failed" scene ONLY while the
    // active turn request id is still set (game.ts §getAuthorizedSceneStreamRequest).
    // Clearing it here would make every retry POST /llm/scene-stream throw
    // `scene_stream_not_pending` (HTTP 403), stranding the reader on an empty
    // failed scene with a consumed turn and no recovery. The turn is fully
    // finalised (activeTurnRequestId cleared) only on a real completion,
    // terminal, or safety block — all handled in completeSceneStream.
    await ctx.db.patch(args.saveId, { updatedAt: now });
    return { ok: true };
  },
});


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
 * compact memory window for the LLM prompt. Each turn's choice + a short
 * excerpt of the scene's prose collapse to a single beat; older turns sit
 * at the front of the window so the narrator reads them oldest → newest.
 *
 * Scene prose is joined in by `(saveId, turnNumber)` via the `by_save_turn`
 * index on `scenes` (one scene row per turn). Including a 1-2 sentence
 * excerpt is what lets the LLM remember what actually happened in prior
 * turns — without it each turn sees only the opaque "from X chose 'Y' →
 * entered Z" join and coherence collapses by turn 3-4.
 */
/**
 * Requirement 11.1 defense-in-depth: any authored story seed and the
 * memory-window summary text must be run through the narrative-safety
 * classifier BEFORE they are assembled into an LLM prompt. Reader-typed input
 * and LLM output are already classified on their own paths; these two helpers
 * cover the derived/authored text that flows into the prompt at generation
 * time. A beat/seed that fails the policy is dropped (memory) or blanked
 * (seed) rather than sent to the provider — the output-side classifier in
 * `completeSceneStream` remains the hard gate on what reaches the reader.
 */
export function guardMemoryBeats(memory: string[], context: ContentPolicyContext): string[] {
  return memory.filter(
    (beat) => beat.trim().length === 0 || guardPromptText(beat, context).allowed,
  );
}

export function guardSeedText(seed: string, context: ContentPolicyContext): string {
  if (seed.trim().length === 0) return seed;
  return guardPromptText(seed, context).allowed ? seed : "";
}

/**
 * Idempotent turn replay (Requirement 14.4 + NFR Reliability). A turn mutation
 * that carries a `requestId` records its result keyed by `(scope, requestId)`;
 * a duplicate call with the same id within the TTL returns the original result
 * without re-running the engine / LLM or re-consuming the daily turn budget.
 * Guards against client network-replay double-submits (which otherwise
 * double-applied engine effects and double-decremented the allowance).
 */
const IDEMPOTENCY_TTL_MS = 60_000;

export async function readIdempotentTurnResult(
  ctx: { db: any },
  scope: string,
  requestId: string,
  accountId: string,
  saveId: string,
  now: number,
): Promise<any | null> {
  // requestId is an arbitrary client-supplied string, so it is NOT a
  // sufficient key on its own — two accounts (or one account across two saves)
  // could collide. Only replay a cached result when the stored accountId AND
  // saveId also match the caller; otherwise treat it as a miss and re-run.
  const rows = await ctx.db
    .query("idempotency_records")
    .withIndex("by_scope_request", (q: any) => q.eq("scope", scope).eq("requestId", requestId))
    .collect();
  const match = rows.find(
    (r: any) =>
      r.accountId === accountId &&
      r.saveId === saveId &&
      typeof r.expiresAt === "number" &&
      r.expiresAt > now,
  );
  return match ? (match.result ?? null) : null;
}

export async function recordIdempotentTurnResult(
  ctx: { db: any },
  input: { scope: string; requestId: string; accountId: string; saveId: string; result: unknown; now: number },
): Promise<void> {
  await ctx.db.insert("idempotency_records", {
    scope: input.scope,
    requestId: input.requestId,
    accountId: input.accountId,
    saveId: input.saveId,
    result: input.result,
    expiresAt: input.now + IDEMPOTENCY_TTL_MS,
    createdAt: input.now,
  });
}

export async function loadMemoryWindow(
  ctx: { db: any },
  saveIdValue: string,
  currentSeed: string,
  // Raised 6 → 10 on 2026-05-28. With per-beat excerpts at ~300 chars,
  // 10 beats = ~3KB of memory window — comfortably under prompt budget
  // (current scene prompt ~7-8KB total). Combined with the bigger
  // structured storySummary (2000 chars), the model has continuity
  // anchors at two scales: recent prose detail (memory window) + durable
  // world facts (storySummary).
  maxBeats = 10,
): Promise<string[]> {
  const rows: any[] = await ctx.db
    .query("turn_history")
    .withIndex("by_save_turn", (q: any) => q.eq("saveId", saveIdValue))
    .order("desc")
    .take(maxBeats);

  // Pull each turn's persisted scene row in parallel so the memory beats can
  // include a prose excerpt. The scenes table is indexed by (saveId,
  // turnNumber); we read at most `maxBeats` extra documents per memory build.
  const scenesByTurn = new Map<number, Record<string, unknown>>();
  await Promise.all(
    rows.map(async (row) => {
      const turnNumber = typeof row?.turnNumber === "number" ? row.turnNumber : null;
      if (turnNumber === null) return;
      const sceneRow = await ctx.db
        .query("scenes")
        .withIndex("by_save_turn", (q: any) =>
          q.eq("saveId", saveIdValue).eq("turnNumber", turnNumber),
        )
        .first();
      if (sceneRow) scenesByTurn.set(turnNumber, sceneRow);
    }),
  );

  const beats: MemoryBeat[] = rows
    .map((row) => {
      const turnNumber = typeof row?.turnNumber === "number" ? row.turnNumber : null;
      const sceneRow = turnNumber !== null ? scenesByTurn.get(turnNumber) ?? null : null;
      return memoryBeatFromHistory(row, sceneRow);
    })
    .filter((beat): beat is MemoryBeat => beat !== null);
  return buildMemoryWindow({ currentSeed, beats, maxBeats });
}

/**
 * Pick the most readable prose snippet from a persisted scene record. The
 * caller can pass either an LLM-driven scene record (whose `proposal.prose`
 * is the structured source of truth) or a deterministic scene record (whose
 * `prose` field carries the inline-generated text). We prefer `proposal.prose`
 * when present so safety/rewrite passes don't surface stale prose, and fall
 * back to the top-level `prose` field for non-LLM-driven turns.
 */
export function pickSceneProse(scene: Record<string, unknown> | null): string {
  if (!scene) return "";
  const proposal = scene.proposal;
  if (proposal && typeof proposal === "object") {
    const proposalProse = (proposal as { prose?: unknown }).prose;
    if (typeof proposalProse === "string" && proposalProse.length > 0) return proposalProse;
  }
  const prose = scene.prose;
  return typeof prose === "string" ? prose : "";
}

/**
 * Trim a prose blob down to a sentence-bounded excerpt under `maxChars`.
 * Splits on `.`, `!`, `?` (followed by whitespace) and keeps the last 1-2
 * complete sentences that fit. Falls back to a hard slice when the prose
 * contains no sentence terminators (e.g. a single long fragment).
 */
export function lastSentencesExcerpt(prose: string, maxChars = 200): string {
  const trimmed = prose.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length <= maxChars) return trimmed;

  // Split into sentences while preserving the trailing punctuation.
  const sentences = trimmed.match(/[^.!?]+[.!?]+(?:["')\]]+)?\s*/g);
  if (!sentences || sentences.length === 0) {
    // No sentence terminators at all — hard-trim and add an ellipsis so the
    // LLM can tell the snippet was truncated.
    return trimmed.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
  }
  const cleaned = sentences.map((s) => s.trim()).filter((s) => s.length > 0);

  // Walk from the end backwards, accumulating sentences until adding the
  // next one would blow past `maxChars`. Keep at least the last sentence
  // even if it overshoots (better one truncated complete sentence than
  // mid-sentence garbage).
  const picked: string[] = [];
  let total = 0;
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const candidate = cleaned[i] ?? "";
    const next = picked.length === 0 ? candidate.length : total + 1 + candidate.length;
    if (picked.length > 0 && next > maxChars) break;
    picked.unshift(candidate);
    total = next;
  }
  const joined = picked.join(" ");
  if (joined.length <= maxChars) return joined;
  // Single overshoot sentence — hard-cap with ellipsis.
  return joined.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
}

/**
 * Compose the NPC sheets payload for a save's current cursor. Loads recent
 * mentions from turn_history and projects the save's `state.npcs` through
 * `buildNpcSheets` per Requirement 31.3. Returns `[]` when no NPCs are in
 * scope; the caller conditionally spreads to keep the request shape tight.
 */
async function buildNpcSheetsForSave(
  ctx: { db: any },
  save: SaveRecord,
  saveIdValue: string = String(save._id ?? ""),
): Promise<NpcSheetSnapshot[]> {
  const npcs = (save.state as PlayerState).npcs ?? {};
  const recentMentions = await loadRecentNpcMentions(ctx, saveIdValue);
  return buildNpcSheets({
    npcs,
    currentNodeId: save.currentNodeId ?? null,
    recentMentions,
  });
}

/**
 * Read the last `n` turn-history rows for the save and aggregate the NPC ids
 * mentioned across them, most-recent first, deduped (Requirement 31.3 / 31.4).
 * Source today is `turn_history.mentionsExtracted`, which the LLM-contract
 * task (Task 55) populates from `proposal.npcMentions`. The function tolerates
 * rows written before the field existed — pre-feature rows contribute zero
 * mentions and just slide out of the recency window over the next few turns.
 */
export async function loadRecentNpcMentions(
  ctx: { db: any },
  saveIdValue: string,
  n = 3,
): Promise<string[]> {
  const rows: any[] = await ctx.db
    .query("turn_history")
    .withIndex("by_save_turn", (q: any) => q.eq("saveId", saveIdValue))
    .order("desc")
    .take(n);
  const aggregate: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const mentions = Array.isArray(row?.mentionsExtracted) ? row.mentionsExtracted : [];
    for (const raw of mentions) {
      if (typeof raw !== "string" || raw.length === 0) continue;
      if (seen.has(raw)) continue;
      seen.add(raw);
      aggregate.push(raw);
    }
  }
  return aggregate;
}

/**
 * Minimum turn at which the LLM may close the story with a non-safety
 * terminal. Below this, `death` or `success` terminals are dropped and the
 * scene is persisted as a normal continuation — the PM scrub flagged
 * stories that closed at turn 1-2 as a P0 coherence bug. Safety-driven
 * (`kind: "safe"`) terminals from the content classifier are NEVER gated
 * here — Requirement 11 still requires those exits to fire.
 */
export const MIN_TURN_BEFORE_TERMINAL = 6;

/**
 * Drop a `death` / `success` terminal from an LLM proposal when the scene
 * would close the story before `MIN_TURN_BEFORE_TERMINAL`. Returns the
 * proposal unchanged when there is no terminal, when the terminal is a
 * safety exit, or when the turn floor has been reached.
 *
 * Mutates a shallow copy so the caller's proposal reference is unaffected.
 * `sceneTurnNumber` is the turn the about-to-be-persisted scene will land
 * at (i.e. `save.turnNumber + 1` for non-streaming, `save.turnNumber` for
 * the completeSceneStream path where the scene row was created up-front).
 */
export function guardEarlyTerminal(
  proposal: LlmSceneProposal,
  sceneTurnNumber: number,
): LlmSceneProposal {
  const terminal = proposal.terminal;
  if (!terminal) return proposal;
  if (terminal.kind === "safe") return proposal;
  if (sceneTurnNumber >= MIN_TURN_BEFORE_TERMINAL) return proposal;
  // eslint-disable-next-line no-console
  console.log(
    `[engine] dropped early terminal at turn ${sceneTurnNumber}, min is ${MIN_TURN_BEFORE_TERMINAL}`,
  );
  return { ...proposal, terminal: null };
}

export function memoryBeatFromHistory(
  row: Record<string, unknown>,
  sceneRow: Record<string, unknown> | null = null,
): MemoryBeat | null {
  const turnNumber = typeof row.turnNumber === "number" ? row.turnNumber : null;
  const choiceId = typeof row.choiceId === "string" ? row.choiceId : null;
  if (turnNumber === null || choiceId === null) return null;
  // Prefer the human-readable choiceLabel when present (free-form turns
  // carry the reader's typed text; LLM-proposed turns now carry the
  // proposal's label). Fall back to the raw choiceId for rows written
  // before the choiceLabel field existed.
  const label = typeof row.choiceLabel === "string" && row.choiceLabel.length > 0
    ? row.choiceLabel
    : choiceId;
  // Pull a 1-2 sentence excerpt of what actually happened in the scene the
  // reader just lived through. Without this the prompt's "memory" was only
  // the choice/node join, and the LLM had no awareness of prior prose →
  // coherence collapsed after a handful of turns.
  const excerpt = lastSentencesExcerpt(pickSceneProse(sceneRow), 300);
  const text = excerpt.length > 0
    ? `Turn ${turnNumber}: ${excerpt} Chose "${label}".`
    : `Turn ${turnNumber}: chose "${label}".`;
  return {
    id: String(row._id ?? `${turnNumber}:${choiceId}`),
    text,
    tags: [],
    turnNumber,
  };
}

/**
 * Sync converter from a raw Convex `saves` doc into a {@link SaveRecord}.
 *
 * Runs {@link migrateSaveIfNeeded} so the in-memory record is always at the
 * current `ENGINE_SCHEMA_VERSION` — without this, legacy v1 saves (no
 * `npcs` field) crash on every turn because the engine's `cloneState` calls
 * `cloneNpcRoster(state.npcs)` unconditionally, which trips
 * `Object.entries(undefined)`.
 *
 * Callers that intend to **continue mutating** the save (any read path
 * followed by `ctx.db.patch(saveId, ...)`) should prefer
 * {@link loadAndMigrateSave}, which also persists the migrated state back
 * to the doc so we don't pay the migration cost on every subsequent read.
 * `saveFromDoc` is kept for callers that already have a doc in hand (e.g.
 * the `listLibrary` map over a query result) and don't have a place to
 * patch back.
 */
function saveFromDoc(doc: Record<string, unknown>): SaveRecord {
  const raw = { ...doc, _id: String(doc._id) } as SaveRecord;
  const plan = migrateSaveIfNeeded(raw);
  return plan.save;
}

/**
 * Async loader: fetch the save by id, migrate the in-memory copy, and — if
 * the migration touched the shape — patch the canonical doc so subsequent
 * reads land on the migrated form directly. Returns `null` when the doc
 * doesn't exist so callers can throw their domain-specific `save_not_found`.
 *
 * Use this in every mutation/query handler that previously did:
 *   `const doc = await ctx.db.get(saveId); const save = saveFromDoc(doc);`
 */
export async function loadAndMigrateSave(
  ctx: { db: { get: (id: any) => Promise<any>; patch: (id: any, patch: any) => Promise<any> } },
  saveIdValue: any,
): Promise<SaveRecord | null> {
  const doc = await ctx.db.get(saveIdValue);
  if (!doc) return null;
  const raw = { ...doc, _id: String((doc as { _id: unknown })._id) } as SaveRecord;
  const plan = migrateSaveIfNeeded(raw);
  if (plan.migrated) {
    await ctx.db.patch(saveIdValue, {
      state: plan.save.state,
      engineVersion: plan.save.state.schemaVersion,
      updatedAt: Date.now(),
    });
  }
  return plan.save;
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


/**
 * Convert a reader-typed NPC name into a stable, deterministic id. The
 * portrait queue, NpcRoster UI, and the engine's npc_* effects all index
 * NPCs by string id; matching the same mapping at every call site is what
 * lets the seed-NPC roster light up the existing pipelines (portrait
 * generation, prompt sheets, roster card) without bespoke wiring. Empty
 * results (a name composed entirely of non-alphanumeric chars) collapse to
 * "npc" as a last-resort fallback — the name allowlist gate above already
 * rejects pathological inputs so this branch is defensive only.
 */
function slugifyNpcName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40)
    || "npc";
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
 * Smart prose-to-image fallback for when the LLM omitted `visualDescription`.
 * The scene-prompt pacing rule (rule 11) instructs the LLM to OPEN scenes
 * with memory/sensory establishment, so the first paragraph often describes
 * a past location, an internal thought, or a flashback — feeding that to
 * Imagen produces images of the wrong place (the user's "living room during
 * a plane crash" report). Take the LAST 1-2 paragraphs instead, since the
 * present-moment visual lands at the end of the scene right before the
 * choice point. Caps at 480 chars to stay under Imagen's safe budget.
 */
function extractVisualFallback(prose: string): string {
  const paragraphs = prose
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) return prose.slice(0, 480);
  const tail = paragraphs.slice(-2).join("\n\n");
  if (tail.length <= 480) return tail;
  const lastParagraph = paragraphs[paragraphs.length - 1] ?? "";
  return lastParagraph.length <= 480 ? lastParagraph : lastParagraph.slice(-480);
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
  inventory: Array<{ id: string; label: string; description?: string }>;
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
    // Carry description through so the prompt's playerStateSummary can
    // render WHERE each item is right now (hidden in book, in pocket, on
    // workbench). Without this, the next turn forgets that the ticket
    // isn't in the protagonist's hand.
    inventory: state.inventory.map((item) => ({
      id: item.id,
      label: item.label,
      ...(item.description ? { description: item.description } : {}),
    })),
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
    // Propagate the deterministic-fallback sentinel onto the projection so
    // the WS-subscribed reader picks up `isFallback: true` and the
    // FallbackTurnPanel renders without waiting for a separate refetch.
    isFallback: (sceneDoc as { isFallback?: boolean }).isFallback === true,
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
    // NPCs the just-completed scene's proposal flagged as mentioned. Carried
    // forward here so `loadRecentNpcMentions` can surface those NPCs' sheets
    // in the next prompt-builder pass (Requirement 31.3 / 31.4). The streaming
    // path's NEW proposal arrives via `completeSceneStream`; that handler
    // patches the field again if the streamed proposal carries one of its own.
    ...(prior?.npcMentions ? { mentionsExtracted: prior.npcMentions } : {}),
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
  ctx: {
    db: any;
    runMutation?: (ref: any, args: any) => Promise<any>;
    scheduler?: { runAfter: (ms: number, ref: any, args: any) => Promise<any> };
  },
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
  // Same precedence as the streaming request builder: reader-authored seed
  // (createSave's "Seed an adventure" flow) wins over the starter story's
  // hardcoded seed/title/tone whenever the save carries one.
  const seedPremiseValue = input.save.seedPremise ?? startNode?.seed;
  const storyToneValue = input.save.seedTone ?? summary?.tone;
  // Req 11.1: classify the seed + memory window before they enter the prompt.
  const guardedSeed = guardSeedText(seedPremiseValue ?? "", input.contentContext);
  const memory = guardMemoryBeats(
    await loadMemoryWindow(ctx, input.saveIdValue, seedPremiseValue ?? ""),
    input.contentContext,
  );
  const recentMentions = await loadRecentNpcMentions(ctx, input.saveIdValue);
  const npcSheets: NpcSheetSnapshot[] = buildNpcSheets({
    npcs: advanced.state.npcs,
    currentNodeId: advanced.state.currentNodeId,
    recentMentions,
  });
  const generated = await router.generateScene({
    saveId: input.saveIdValue,
    storyId: input.story.id,
    storyTitle: input.save.seedTitle ?? input.story.title,
    ...(storyToneValue ? { storyTone: storyToneValue } : {}),
    ...(guardedSeed ? { premise: guardedSeed } : {}),
    turnNumber: advanced.state.turnNumber,
    nodeId: advanced.nodeId,
    seed: guardedSeed,
    memory,
    choices: [],
    sceneLength: input.story.defaultSceneLength ?? "standard",
    contentContext: input.contentContext,
    risk: "normal",
    entitlementTier: input.entitlementTier,
    retryCount: 0,
    mode: "llm-driven",
    playerState: snapshotPlayerState(advanced.state),
    ...(npcSheets.length > 0 ? { npcSheets } : {}),
    // Running summary maintained by `convex/llm/summarizer.ts`. Absent on
    // the opening turn (nothing to summarise) and on legacy saves.
    ...(input.save.storySummary ? { storySummary: input.save.storySummary } : {}),
  });

  const rawProposal: LlmSceneProposal | null = generated.parsed.proposal ?? null;
  if (!rawProposal) throw new AppError("llm_scene_invalid_shape");
  // The about-to-be-persisted scene lands at the post-advance turn number.
  // Guard non-safety terminals here so the LLM can't close the story at
  // turn 1-2 just because it felt narratively tidy (PM scrub P0 bug).
  const proposal: LlmSceneProposal = guardEarlyTerminal(rawProposal, advanced.state.turnNumber);

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
    // Redacted safety.blocked row (Req 11.9 / 15.6) — metadata only.
    await insertSafetyAnalytics(ctx, {
      action: policy.action,
      categories: policy.safetyCategories,
      accountId: input.accountId,
      saveId: input.saveIdValue,
      storyId: input.story.id,
      turnNumber: input.save.turnNumber + 1,
      provider: normalizeProviderName(generated.generation.provider),
      now: input.now,
    });
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
  // Terminal → record the ending unlock (Req 8.1 / 11.4 / 19.1); safetyEnding
  // flags classifier-forced safe exits. Emit the redacted safety row for those.
  if (terminal) {
    await recordEndingUnlock(ctx, {
      accountId: input.accountId,
      unlock: unlockedEndingForTerminal(nextSave, nextSave.state, terminal),
      safetyEnding: policyForcedSafe,
    });
    // Endpoint-cinematics ending trigger (Req 2.4) for the non-streaming
    // llm-driven path. Strategy-gated + best-effort inside the helper.
    await maybeScheduleEndingCinematic(ctx as { db: any; scheduler: any }, {
      accountId: input.accountId,
      saveId: input.saveIdValue,
      endingId: terminal.endingId,
    });
  }
  if (policyForcedSafe) {
    await insertSafetyAnalytics(ctx, {
      action: policy.action,
      categories: policy.safetyCategories,
      accountId: input.accountId,
      saveId: input.saveIdValue,
      storyId: input.story.id,
      turnNumber: nextSave.turnNumber,
      provider: normalizeProviderName(generated.generation.provider),
      now: input.now,
    });
  }
  // NPC portraits: schedule a 1:1 Imagen job for any NPC newly present
  // in `state.npcs` post-turn. Same trigger as the completeSceneStream
  // path — kept here so the non-streaming submitChoice llm-driven path
  // also picks up freshly spawned NPCs. Failures are swallowed by the
  // helper; portraits are a Pro extra on top of the roster name.
  try {
    const priorNpcs = (input.save.state as { npcs?: Record<string, any> } | undefined)?.npcs;
    const nextNpcs = (nextSave.state as { npcs?: Record<string, any> } | undefined)?.npcs;
    if (ctx.runMutation) {
      await schedulePortraitsForNewNpcs(
        ctx as { runMutation: (ref: any, args: any) => Promise<any> },
        {
          accountId: input.accountId,
          saveId: input.saveIdValue,
          priorNpcs,
          nextNpcs,
        },
      );
    }
  } catch {
    // non-fatal — portraits are layered on top of the engine roster
  }
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
    // NPCs the freshly generated scene's proposal flagged as mentioned. Stored
    // so the NEXT turn's prompt-builder (via `loadRecentNpcMentions`) can
    // surface those NPCs' sheets without re-parsing prose (Req 31.3 / 31.4).
    ...(proposal.npcMentions ? { mentionsExtracted: proposal.npcMentions } : {}),
    engineDiffs: [...advanced.diffs, ...recorded.diffs],
    engineEvents: [...advanced.events, ...recorded.events],
    provider: generated.generation.provider,
    tokenUsage: generated.generation.tokenUsage,
    latency: { engineMs: 0, llmMs: Math.max(0, Date.now() - input.now) },
    createdAt: input.now,
  }));
  // Turn-completion analytics (Req 15.2 / 27.2-27.5) for the non-streaming
  // llm-driven path — real provider + token usage from the inline router call.
  {
    const tokenUsage = generated.generation.tokenUsage ?? estimateTokenUsage("", generated.parsed.prose);
    const llmMs = Math.max(0, Date.now() - input.now);
    await insertTurnCompletedAnalytics(ctx, {
      accountId: input.accountId,
      saveId: input.saveIdValue,
      storyId: input.story.id,
      turnNumber: nextSave.turnNumber,
      provider: normalizeProviderName(generated.generation.provider),
      inputTokens: tokenUsage.input,
      outputTokens: tokenUsage.output,
      llmMs,
      totalMs: llmMs,
      fallback: false,
      createdAt: input.now,
    });
  }
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

  // Running "story so far" summary — non-streaming twin of the
  // completeSceneStream wiring. Skip on policy-forced-safe (no useful
  // state to summarise) and when the scheduler isn't available (test
  // contexts that pass a minimal ctx). Choice label comes from the
  // proposal we just resolved against — for llm-driven submitChoice the
  // typed/free-form path doesn't apply (that's the streaming flow), so
  // the proposal's label is always defined.
  if (!policyForcedSafe && ctx.scheduler) {
    try {
      await ctx.scheduler.runAfter(
        0,
        ("llm/summarizer:summarizeStory" as unknown) as any,
        {
          saveId: input.saveIdValue,
          accountId: input.accountId,
          priorSummary: input.save.storySummary ?? "",
          lastSceneExcerpt: generated.parsed.prose.slice(0, 300),
          lastChoiceLabel: choice.label,
          premise: input.save.seedPremise ?? "",
          turnNumber: nextSave.turnNumber,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[runLlmDrivenSubmitChoice] summarizer schedule failed save=${input.saveIdValue} error=${message.slice(0, 240)}`);
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
 * Resolve the canonical {@link UnlockedEnding} for a terminal the reader just
 * hit. The engine's terminal recorders (`recordLlmProposalTerminal`, and
 * `unlockCurrentEnding` via `applyChoiceAndEnterNode`) populate
 * `state.endingsUnlocked[endingId]` for story-driven death / success / safe
 * terminals, so prefer that record — it carries the authoritative firstSeen
 * turn, mode, and path (Requirement 19.1). Safety-classifier-forced safe exits
 * (`{ kind: "safe", endingId: "ending-safe" }`) are deliberately NOT written
 * into engine state, so synthesize the record from the current cursor.
 */
function unlockedEndingForTerminal(
  save: SaveRecord,
  state: PlayerState,
  terminal: { endingId: string; kind: string },
): UnlockedEnding {
  const recorded = state.endingsUnlocked?.[terminal.endingId];
  if (recorded) return recorded;
  return {
    storyId: save.storyId,
    endingId: terminal.endingId,
    firstSeenTurn: state.turnNumber,
    mode: state.mode,
    path: [...(state.path ?? [])],
  };
}

/**
 * Idempotently persist an `endings_unlocked` row for a terminal the reader
 * just reached (Requirements 8.1, 11.4, 19.1, 8.6). First-seen semantics are
 * per `(accountId, endingId)`: if this account has already unlocked this
 * ending — in this or any other save — we skip the insert so the original
 * firstSeen / mode / path survive and the row is never duplicated (the
 * "don't double-insert" guard). `safetyEnding` flags safety-classifier-forced
 * safe exits so the trophy crypt can render them distinctly (Req 11.4).
 *
 * Best-effort by design: this runs inside the same atomic mutation that
 * persists the terminal scene the reader is about to see, so a throw here
 * would roll the whole terminal write back. We swallow + log instead.
 */
async function recordEndingUnlock(
  ctx: { db: any },
  input: { accountId: string; unlock: UnlockedEnding; safetyEnding: boolean },
): Promise<void> {
  try {
    const existing = await ctx.db
      .query("endings_unlocked")
      .withIndex("by_account_ending", (q: any) =>
        q.eq("accountId", input.accountId).eq("endingId", input.unlock.endingId),
      )
      .first();
    if (existing) return;
    await ctx.db.insert(
      "endings_unlocked",
      cleanDoc(
        endingRecordFromUnlock(input.accountId, input.unlock, {
          safetyEnding: input.safetyEnding,
        }),
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[recordEndingUnlock] failed endingId=${input.unlock.endingId} error=${message.slice(0, 240)}`,
    );
  }
}

/**
 * Endpoint-cinematics: schedule the ENDING cinematic (omni-cinematics Req 2.4)
 * next to the ending-unlock write. Best-effort and strategy-gated — only fires
 * when the reader's effective media strategy is `endpoint_cinematic`. The
 * scheduled `queueEndpointCinematic` mutation re-checks strategy + Pro +
 * omniConfigured + dedupe, so this is a thin, fire-and-forget hook. A throw
 * here would roll back the terminal write, so we swallow + log — cinematics are
 * strictly additive to the read loop.
 */
async function maybeScheduleEndingCinematic(
  ctx: { db: any; scheduler: any },
  input: { accountId: string; saveId: string; endingId: string },
): Promise<void> {
  try {
    const strategy = await resolveMediaStrategy(ctx, input.accountId);
    console.log(`[cinematics] ending hook save=${input.saveId} ending=${input.endingId} strategy=${strategy}`);
    if (strategy !== "endpoint_cinematic") return;
    await ctx.scheduler.runAfter(0, ("media/cinematics:queueEndpointCinematic" as unknown) as any, {
      accountId: input.accountId,
      saveId: input.saveId,
      trigger: "ending" as const,
      endingId: input.endingId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[cinematics] ending schedule failed save=${input.saveId} error=${message.slice(0, 200)}`);
  }
}

/**
 * Endpoint-cinematics: schedule the OPENING title cinematic (Req 2.1 as
 * corrected by C3). Called once on turn-1 completion, right where the anchor
 * jobs are scheduled. `queueEndpointCinematic` reschedules itself until the
 * anchors land (C3) and then produces the title sequence in behind the reader.
 * Strategy-gated + best-effort, same contract as the ending hook.
 */
async function maybeScheduleOpeningCinematic(
  ctx: { db: any; scheduler: any },
  input: { accountId: string; saveId: string },
): Promise<void> {
  try {
    const strategy = await resolveMediaStrategy(ctx, input.accountId);
    console.log(`[cinematics] opening hook save=${input.saveId} strategy=${strategy}`);
    if (strategy !== "endpoint_cinematic") return;
    await ctx.scheduler.runAfter(0, ("media/cinematics:queueEndpointCinematic" as unknown) as any, {
      accountId: input.accountId,
      saveId: input.saveId,
      trigger: "opening" as const,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[cinematics] opening schedule failed save=${input.saveId} error=${message.slice(0, 200)}`);
  }
}

/**
 * Endpoint-cinematics: schedule a CHAPTER stinger on a server turn-number
 * cadence (omni-cinematics P2, build-correction C1). Fires every
 * `CHAPTER_CINEMATIC_TURNS` completed turns — a pure `turnNumber % N` server
 * cadence, NOT the client `CHAPTER_TURNS` localStorage notion. Strategy-gated +
 * best-effort; `queueEndpointCinematic` enforces the per-run cap (Req 8.2) and
 * the (saveId, trigger, sceneId) dedupe, so double-fires and the K-th+1 boundary
 * are absorbed there.
 */
async function maybeScheduleChapterCinematic(
  ctx: { db: any; scheduler: any },
  input: { accountId: string; saveId: string; turnNumber: number },
): Promise<void> {
  try {
    if (detectChapterCinematicTrigger({ turnNumber: input.turnNumber }) !== "chapter") return;
    const strategy = await resolveMediaStrategy(ctx, input.accountId);
    if (strategy !== "endpoint_cinematic") return;
    await ctx.scheduler.runAfter(0, ("media/cinematics:queueEndpointCinematic" as unknown) as any, {
      accountId: input.accountId,
      saveId: input.saveId,
      trigger: "chapter" as const,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[cinematics] chapter schedule failed save=${input.saveId} error=${message.slice(0, 200)}`);
  }
}

/**
 * Best-effort `analytics_events` insert for a completed turn (Requirement 15.2
 * / 27.2-27.5). Analytics is observability, never the reader's contract — a
 * failure here must not roll back the turn, so we swallow + log.
 */
async function insertTurnCompletedAnalytics(
  ctx: { db: any },
  input: TurnCompletedAnalyticsInput,
): Promise<void> {
  try {
    await ctx.db.insert("analytics_events", buildTurnCompletedEvent(input));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[analytics] turn-completed insert failed save=${input.saveId} error=${message.slice(0, 240)}`);
  }
}

/**
 * Best-effort redacted `safety.blocked|redirected|ended` insert (Requirements
 * 11.9 / 15.6). Stores metadata only (category + action + latency); the unsafe
 * text is never passed in. No-op when the action carries no safety event.
 */
async function insertSafetyAnalytics(
  ctx: { db: any },
  input: {
    action: ContentPolicySummary["action"];
    categories: string[];
    accountId: string;
    saveId: string;
    storyId?: string;
    turnNumber?: number;
    provider?: "anthropic" | "vertex" | "deepseek" | "deterministic";
    latencyMs?: number;
    now: number;
  },
): Promise<void> {
  const eventName = safetyEventNameForAction(input.action);
  if (!eventName) return;
  try {
    await ctx.db.insert(
      "analytics_events",
      buildSafetyAnalyticsEvent({
        eventName,
        action: input.action,
        categories: input.categories,
        accountId: input.accountId,
        saveId: input.saveId,
        ...(input.storyId === undefined ? {} : { storyId: input.storyId }),
        ...(input.turnNumber === undefined ? {} : { turnNumber: input.turnNumber }),
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.latencyMs === undefined ? {} : { latencyMs: input.latencyMs }),
        createdAt: input.now,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[analytics] safety insert failed save=${input.saveId} error=${message.slice(0, 240)}`);
  }
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
