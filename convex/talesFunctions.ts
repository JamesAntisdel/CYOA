import {
  applyChoiceAndEnterNode,
  applyLlmSceneToState,
  createInitialState,
  type LlmSceneProposal,
  type PlayerState,
  type Story,
} from "@cyoa/engine";
import { getStory, getStoryMode } from "@cyoa/stories";
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

import { canEnableMatureContent, type AccountRecord } from "./account";
import { assertAccountSessionAccess, assertOwns } from "./lib/authz";
import { accountFromDoc, cleanDoc } from "./lib/docs";
import { loadEntitlementLite } from "./lib/entitlement";
import { AppError } from "./lib/errors";
import { parseAuthoredSeedStoryId } from "./liveCore";
import { createSaveRecord, projectCurrentScene, type SaveRecord } from "./saves";
import {
  assertCanReadTale,
  buildForkPlan,
  projectReadAlong,
  publishTaleSnapshot,
  revokeTale,
  snapshotTurn,
  updateTaleMetadata,
  type PublishedTaleRecord,
  type TaleForkPolicy,
  type TalePrivacy,
  type TaleTurnSnapshot,
} from "./tales";

const accountId = v.id("accounts");
const saveId = v.id("saves");
const taleId = v.id("published_tales");
const turnId = v.id("turn_history");
const guestTokenHash = v.optional(v.string());
const privacy = v.union(v.literal("public"), v.literal("unlisted"), v.literal("friends"));
const forkPolicy = v.union(
  v.literal("any_decision"),
  v.literal("ending_only"),
  v.literal("disabled"),
);

// -------------------------------------------------------------------------
// Registered Convex functions for the publish / read-along / fork lifecycle
// (Requirement 21). The pure snapshot / fork / projection logic lives in
// ./tales; this module is the thin DB-bound wrapper that loads records,
// enforces owner + session authz, and persists to `published_tales` /
// `tale_reads` / `tale_forks`.
//
// NOTE (schema): `published_tales` stores the DENORMALIZED snapshot — `storyId`
// plus the full `snapshotTurns` (prose, choices, per-turn engine state, and a
// scene mirror for fork). Read + fork resolve entirely from the stored doc via
// `resolveTaleRecord`, so a published tale is immutable and survives the source
// save being rewound or purged. `snapshotTurnIds` are retained only for
// lineage. Tales published before this field existed fall back to rehydrating
// from the live `turn_history` + `scenes` rows (see `resolveTaleRecord`).
// -------------------------------------------------------------------------

/**
 * Load a Story for a tale's `storyId`. Starter/hidden stories resolve from the
 * bundled catalog; authored-seed stories (`authored_seed:<id>`) resolve from
 * the persisted seed. Unlike game.ts's private `loadStory`, this deliberately
 * does NOT re-check seed ownership/status: a published tale is the access
 * grant, so a reader forking someone else's authored-seed tale must still be
 * able to resolve the underlying graph for engine replay.
 */
async function loadTaleStory(
  ctx: { db: { get: (id: any) => Promise<any> } },
  storyId: string,
): Promise<Story> {
  const seedIdValue = parseAuthoredSeedStoryId(storyId);
  if (!seedIdValue) return getStory(storyId);
  const seed = await ctx.db.get(seedIdValue);
  if (!seed) throw new AppError("creator_seed_not_found");
  return { ...(seed.story as Story), id: storyId };
}

function isLlmDrivenStory(storyId: string): boolean {
  if (parseAuthoredSeedStoryId(storyId)) return false; // authored seeds walk the node graph
  return getStoryMode(storyId) === "llm-driven";
}

const loadEntitlement = loadEntitlementLite;

type HydratedTurn = {
  turnDoc: Record<string, any>;
  scene: Record<string, any> | null;
};

/** Load the ordered turn_history rows referenced by a tale, joined with their scene. */
async function hydrateTurns(
  ctx: { db: any },
  tale: { sourceSaveId: string; snapshotTurnIds: string[] },
): Promise<HydratedTurn[]> {
  const turnDocs = (
    await Promise.all(tale.snapshotTurnIds.map((id) => ctx.db.get(id as any)))
  ).filter((doc): doc is Record<string, any> => Boolean(doc));
  turnDocs.sort((a, b) => Number(a.turnNumber ?? 0) - Number(b.turnNumber ?? 0));

  return Promise.all(
    turnDocs.map(async (turnDoc) => {
      const turnNumber = Number(turnDoc.turnNumber ?? 0);
      const scene = await ctx.db
        .query("scenes")
        .withIndex("by_save_turn", (q: any) =>
          q.eq("saveId", tale.sourceSaveId).eq("turnNumber", turnNumber),
        )
        .first();
      return { turnDoc, scene: (scene as Record<string, any> | null) ?? null };
    }),
  );
}

function choicesFromScene(scene: Record<string, any> | null): Array<{ choiceId: string; label: string }> {
  const proposal = scene?.proposal as LlmSceneProposal | undefined;
  if (proposal?.choices) {
    return proposal.choices.map((c) => ({ choiceId: c.id, label: c.label }));
  }
  const views = (scene?.choiceViews as Array<{ choice?: { id?: string; label?: string } }> | undefined) ?? [];
  return views
    .map((view) => view.choice)
    .filter((c): c is { id?: string; label?: string } => Boolean(c))
    .map((c) => ({ choiceId: String(c.id ?? ""), label: String(c.label ?? "") }));
}

/**
 * Re-derive the engine state after each snapshot turn by replaying the recorded
 * choices onto a fresh initial state. LLM-driven turns are deterministic given
 * the persisted per-scene proposals (their effects are explicit), so replay is
 * faithful; authored turns replay through the engine graph. Returns a map from
 * turn_history id -> post-turn state. Throws if any required record is missing;
 * callers that only need prose/choices skip this and pass `stateAfter: {}`.
 */
function replayTurnStates(
  story: Story,
  mode: SaveRecord["mode"],
  hydrated: HydratedTurn[],
): Map<string, PlayerState> {
  const llm = isLlmDrivenStory(story.id);
  let state = createInitialState(story, mode, Date.now(), `tale-replay:${story.id}`);
  let priorProposal: LlmSceneProposal | null = null;
  const out = new Map<string, PlayerState>();

  for (const { turnDoc, scene } of hydrated) {
    const now = Number(turnDoc.createdAt ?? Date.now());
    const rngSeed = String(turnDoc.requestId ?? turnDoc._id ?? "tale-replay");
    const choiceId = String(turnDoc.choiceId ?? "");
    if (llm) {
      const nextProposal = (scene?.proposal as LlmSceneProposal | undefined) ?? null;
      if (nextProposal) {
        const result = applyLlmSceneToState({
          state,
          story,
          priorProposal,
          // The opening turn has no prior proposal to apply a choice against.
          choiceId: priorProposal ? choiceId : null,
          nextProposal,
          ctx: { now, rngSeed },
        });
        state = result.state;
        priorProposal = nextProposal;
      }
      // Missing proposal (e.g. an un-streamed opening scene): keep the current
      // state; the reader forks from the best-known state at that point.
    } else {
      const result = applyChoiceAndEnterNode(state, story, choiceId, { now, rngSeed });
      state = result.state;
    }
    out.set(String(turnDoc._id), state);
  }
  return out;
}

/** Build the immutable turn snapshots the pure tale logic consumes. */
function buildSnapshotTurns(
  hydrated: HydratedTurn[],
  states: Map<string, PlayerState> | null,
): TaleTurnSnapshot[] {
  return hydrated.map(({ turnDoc, scene }) =>
    snapshotTurn({
      sourceTurnId: String(turnDoc._id),
      history: {
        turnNumber: Number(turnDoc.turnNumber ?? 0),
        fromNodeId: String(turnDoc.fromNodeId ?? ""),
        choiceId: String(turnDoc.choiceId ?? ""),
        engineDiffs: (turnDoc.engineDiffs as unknown[]) ?? [],
        engineEvents: (turnDoc.engineEvents as any[]) ?? [],
        createdAt: Number(turnDoc.createdAt ?? 0),
      } as any,
      prose: typeof scene?.prose === "string" ? scene.prose : "",
      choices: choicesFromScene(scene),
      stateAfter: states?.get(String(turnDoc._id)) ?? {},
      // Capture the minimal source-scene fields fork needs to mirror the
      // starting scene without re-reading the live `scenes` row later.
      ...(scene
        ? {
            sceneMirror: {
              choiceViews: (scene.choiceViews as unknown[]) ?? [],
              safety: scene.safety ?? { risk: "normal", reasons: [] },
              provider: typeof scene.provider === "string" ? scene.provider : "deterministic",
              ...(scene.proposal ? { proposal: scene.proposal } : {}),
            },
          }
        : {}),
    }),
  );
}

/**
 * Reassemble an in-memory PublishedTaleRecord from a stored doc + its resolved
 * snapshot turns. `storyId` is now persisted on the doc (denormalized); callers
 * pass the resolved value (from the doc, or derived for legacy rows).
 */
function taleRecordFromDoc(
  doc: Record<string, any>,
  snapshotTurns: TaleTurnSnapshot[],
  storyId = "",
): PublishedTaleRecord {
  return {
    _id: String(doc._id),
    ownerAccountId: String(doc.ownerAccountId),
    sourceSaveId: String(doc.sourceSaveId),
    storyId,
    title: String(doc.title ?? ""),
    synopsis: String(doc.synopsis ?? ""),
    privacy: doc.privacy as TalePrivacy,
    ...(doc.accessRevokedAt === undefined ? {} : { accessRevokedAt: Number(doc.accessRevokedAt) }),
    forkPolicy: doc.forkPolicy as TaleForkPolicy,
    isMature: Boolean(doc.isMature),
    safetySummary: doc.safetySummary,
    snapshotTurnIds: (doc.snapshotTurnIds as string[]).map(String),
    snapshotTurns,
    createdAt: Number(doc.createdAt ?? 0),
    updatedAt: Number(doc.updatedAt ?? 0),
  };
}

/**
 * Reassemble a PublishedTaleRecord from a stored doc, source-independently.
 * New tales persist `storyId` + `snapshotTurns` (denormalized), so we build the
 * record straight from the doc with no extra reads. Tales published before that
 * field existed fall back to rehydrating from the live turn_history/scenes (the
 * pre-denormalization path) — which may be lossy if the source was rewound.
 */
async function resolveTaleRecord(
  ctx: { db: any },
  doc: Record<string, any>,
): Promise<PublishedTaleRecord> {
  if (Array.isArray(doc.snapshotTurns) && typeof doc.storyId === "string") {
    return taleRecordFromDoc(doc, doc.snapshotTurns as TaleTurnSnapshot[], doc.storyId);
  }
  // Legacy fallback: rehydrate from the source save's live rows.
  const sourceSaveDoc = await ctx.db.get(doc.sourceSaveId);
  const storyId = doc.storyId ? String(doc.storyId) : String(sourceSaveDoc?.storyId ?? "");
  const mode: SaveRecord["mode"] = (sourceSaveDoc?.mode as SaveRecord["mode"]) ?? "story";
  const hydrated = await hydrateTurns(ctx, {
    sourceSaveId: String(doc.sourceSaveId),
    snapshotTurnIds: (doc.snapshotTurnIds as string[]).map(String),
  });
  let states: Map<string, PlayerState> | null = null;
  try {
    const story = await loadTaleStory(ctx, storyId);
    states = replayTurnStates(story, mode, hydrated);
  } catch {
    states = null;
  }
  return taleRecordFromDoc(doc, buildSnapshotTurns(hydrated, states), storyId);
}

/**
 * The denormalized lead cinematic featured on a published tale (Req 10.1). Its
 * playable URL (+ assetId, audio flag, SynthID provenance) is copied ONTO the
 * `published_tales` row at publish time so it survives the source save being
 * rewound or purged — mirroring the snapshot denormalization. `endingId` links
 * back to the ending the cinematic depicts.
 */
type LeadCinematic = {
  assetId: string;
  url: string;
  hasAudio: boolean;
  synthId: boolean;
  endingId?: string;
};

function leadCinematicFromDoc(doc: Record<string, any>): LeadCinematic | null {
  const raw = doc.leadCinematic as Record<string, any> | undefined;
  if (!raw || typeof raw.url !== "string" || raw.url.length === 0) return null;
  return {
    assetId: String(raw.assetId ?? ""),
    url: String(raw.url),
    hasAudio: raw.hasAudio === true,
    synthId: raw.synthId === true,
    ...(raw.endingId ? { endingId: String(raw.endingId) } : {}),
  };
}

/**
 * Resolve the save's featured ending cinematic for publishing (Req 10.1). Reads
 * the save's `kind:"cinematic"` asset rows (produced by the P1/P2 pipeline via
 * `queueEndpointCinematic`), and picks the newest READY ending cinematic that
 * passes the publishing-surface safety gate (Req 10.3 / 11): a blocked or
 * still-generating cinematic is never featured. Returns null when the save has
 * none — the tale simply publishes with a text blurb as before.
 */
async function resolveLeadCinematic(
  ctx: { db: any },
  saveIdValue: string,
): Promise<LeadCinematic | null> {
  let docs: Array<Record<string, any>> = [];
  try {
    docs = (await ctx.db
      .query("assets")
      .withIndex("by_save_kind", (q: any) => q.eq("saveId", saveIdValue).eq("kind", "cinematic"))
      .collect()) as Array<Record<string, any>>;
  } catch {
    return null;
  }
  const ready = docs
    .filter((d) => d.kind === "cinematic" && d.cinematicTrigger === "ending")
    .filter((d) => d.status === "ready" && typeof d.url === "string" && d.url.length > 0)
    // Publishing-surface safety gate: never feature a cinematic the classifier
    // blocked (Req 10.3 / 11.2). Rows generated by the pipeline carry a `safety`
    // object; absence is treated as allow (older rows).
    .filter((d) => ((d.safety as { action?: string } | undefined)?.action ?? "allow") !== "block")
    .sort((a, b) => Number(b.readyAt ?? b.createdAt ?? 0) - Number(a.readyAt ?? a.createdAt ?? 0));
  const best = ready[0];
  if (!best) return null;
  const prov = (best.provenance ?? {}) as Record<string, unknown>;
  return {
    assetId: String(best._id),
    url: String(best.url),
    hasAudio: best.hasAudio === true,
    synthId: prov.synthId === true,
    ...(best.endingId ? { endingId: String(best.endingId) } : {}),
  };
}

function taleSummary(doc: Record<string, any>) {
  return {
    taleId: String(doc._id),
    ownerAccountId: String(doc.ownerAccountId),
    storyId: doc.storyId ? String(doc.storyId) : "",
    title: String(doc.title ?? ""),
    synopsis: String(doc.synopsis ?? ""),
    privacy: doc.privacy as TalePrivacy,
    forkPolicy: doc.forkPolicy as TaleForkPolicy,
    isMature: Boolean(doc.isMature),
    revoked: doc.accessRevokedAt !== undefined,
    turnCount: Array.isArray(doc.snapshotTurnIds) ? doc.snapshotTurnIds.length : 0,
    // Req 10.1: the featured cinematic gives discovery a video hook. Mature
    // gating is enforced by the caller (listPublicTales filters mature tales for
    // viewers without the opt-in), so a summary that reaches a viewer is already
    // cleared to carry the URL.
    leadCinematic: leadCinematicFromDoc(doc),
    createdAt: Number(doc.createdAt ?? 0),
    updatedAt: Number(doc.updatedAt ?? 0),
  };
}

// -------------------------------------------------------------------------
// Publish (Req 21.1)
// -------------------------------------------------------------------------
export const publishTale = mutationGeneric({
  args: {
    accountId,
    saveId,
    guestTokenHash,
    title: v.string(),
    synopsis: v.string(),
    privacy,
    forkPolicy,
    // Owner consent to feature the save's ending cinematic as the tale's lead
    // artifact (Req 10.1). Defaults on; pass false to publish text-only.
    featureCinematic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const accountDoc = await ctx.db.get(args.accountId);
    if (!accountDoc) throw new AppError("account_not_found");
    const owner = accountFromDoc(accountDoc) as AccountRecord & { _id: string };
    await assertAccountSessionAccess(ctx, owner, args.guestTokenHash);

    const saveDoc = await ctx.db.get(args.saveId);
    if (!saveDoc) throw new AppError("save_not_found");
    if (String(saveDoc.accountId) !== args.accountId) throw new AppError("save_forbidden");
    const save = { ...(saveDoc as any), _id: args.saveId } as SaveRecord & { _id: string };

    const entitlement = await loadEntitlement(ctx, args.accountId);
    const story = await loadTaleStory(ctx, save.storyId);

    // Pull the source save's full append-only turn history, oldest-first, and
    // join each turn's persisted scene for prose + choices.
    const turnDocs = await ctx.db
      .query("turn_history")
      .withIndex("by_save_turn", (q: any) => q.eq("saveId", args.saveId))
      .order("asc")
      .collect();
    if (turnDocs.length === 0) throw new AppError("tale_snapshot_empty");
    const hydrated: HydratedTurn[] = await Promise.all(
      (turnDocs as Array<Record<string, any>>).map(async (turnDoc) => {
        const scene = await ctx.db
          .query("scenes")
          .withIndex("by_save_turn", (q: any) =>
            q.eq("saveId", args.saveId).eq("turnNumber", Number(turnDoc.turnNumber ?? 0)),
          )
          .first();
        return { turnDoc, scene: (scene as Record<string, any> | null) ?? null };
      }),
    );

    let states: Map<string, PlayerState> | null = null;
    try {
      states = replayTurnStates(story, save.mode, hydrated);
    } catch {
      // Replay is best-effort at publish time; the snapshot's prose/choices are
      // the immutable contract. A fork later re-derives state on demand.
      states = null;
    }
    const turns = buildSnapshotTurns(hydrated, states);

    const now = Date.now();
    // Pure logic: validates non-empty, re-runs the safety/mature policy, and
    // computes isMature + safetySummary (Req 12.5).
    const tale = publishTaleSnapshot({
      owner,
      entitlement,
      save,
      title: args.title,
      synopsis: args.synopsis,
      privacy: args.privacy,
      forkPolicy: args.forkPolicy,
      turns,
      now,
    });

    // Req 10.1: feature the save's ending cinematic as the tale's lead artifact,
    // subject to the owner's consent (featureCinematic, default on) and the
    // publishing-surface safety gate (resolveLeadCinematic). DENORMALIZED onto
    // the tale — the source save may later be rewound/purged, so the URL must
    // live on the tale (mirrors the snapshot denormalization above).
    const featureCinematic = args.featureCinematic !== false;
    const leadCinematic = featureCinematic
      ? await resolveLeadCinematic(ctx, args.saveId)
      : null;

    // Persist the DENORMALIZED snapshot (storyId + snapshotTurns) so the tale is
    // immutable and source-independent: rewinding or purging the source save no
    // longer empties the published tale. snapshotTurnIds are kept for lineage.
    const insertedId = await ctx.db.insert(
      "published_tales",
      cleanDoc({
        ownerAccountId: args.accountId,
        sourceSaveId: args.saveId,
        storyId: tale.storyId,
        title: tale.title,
        synopsis: tale.synopsis,
        privacy: tale.privacy,
        forkPolicy: tale.forkPolicy,
        isMature: tale.isMature,
        safetySummary: tale.safetySummary,
        snapshotTurnIds: tale.snapshotTurnIds,
        snapshotTurns: tale.snapshotTurns,
        ...(leadCinematic ? { leadCinematic } : {}),
        createdAt: tale.createdAt,
        updatedAt: tale.updatedAt,
      }),
    );

    return {
      taleId: insertedId,
      isMature: tale.isMature,
      privacy: tale.privacy,
      forkPolicy: tale.forkPolicy,
      title: tale.title,
      turnCount: tale.snapshotTurnIds.length,
      hasLeadCinematic: Boolean(leadCinematic),
    };
  },
});

// -------------------------------------------------------------------------
// Discovery listing with mature exclusion (Req 12.9)
// -------------------------------------------------------------------------
const LIST_PUBLIC_TALES_DEFAULT_LIMIT = 50;
// Hard cap on how many public-tale docs a single discovery read scans. Each doc
// now carries the denormalized snapshotTurns, so an unbounded .collect() would
// load the entire published corpus into memory. We over-scan the cap to leave
// room for the revoked/mature filter, then return at most `limit` summaries.
const LIST_PUBLIC_TALES_SCAN_CAP = 500;

export const listPublicTales = queryGeneric({
  args: { accountId: v.optional(accountId), guestTokenHash, limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    // Determine whether this viewer may see mature tales. Anonymous guests and
    // readers without an active paid 18+ opt-in never can (Req 12.9).
    let matureAllowed = false;
    if (args.accountId) {
      const accountDoc = await ctx.db.get(args.accountId);
      if (accountDoc) {
        const account = accountFromDoc(accountDoc);
        // Only honor this account's 18+ opt-in if the caller actually owns the
        // session. Without this gate any caller could pass a mature-enabled
        // account's id (with no/invalid guest token) and borrow its opt-in
        // (Req 12.9). We degrade rather than throw — discovery is a public
        // surface, so an unowned/invalid session simply sees the non-mature
        // list instead of erroring the whole page.
        let sessionOwned = false;
        try {
          await assertAccountSessionAccess(ctx, account, args.guestTokenHash);
          sessionOwned = true;
        } catch {
          sessionOwned = false;
        }
        if (sessionOwned) {
          const entitlement = await loadEntitlement(ctx, args.accountId);
          matureAllowed = account.matureContentEnabled && canEnableMatureContent(account, entitlement);
        }
      }
    }

    const limit = Math.max(1, Math.min(args.limit ?? LIST_PUBLIC_TALES_DEFAULT_LIMIT, LIST_PUBLIC_TALES_SCAN_CAP));
    const docs = await ctx.db
      .query("published_tales")
      .withIndex("by_privacy", (q: any) => q.eq("privacy", "public"))
      .take(LIST_PUBLIC_TALES_SCAN_CAP);

    return (docs as Array<Record<string, any>>)
      .filter((doc) => doc.accessRevokedAt === undefined)
      .filter((doc) => matureAllowed || !doc.isMature)
      .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0))
      .slice(0, limit)
      .map(taleSummary);
  },
});

// -------------------------------------------------------------------------
// Owner's published tales (manage / unpublish surface)
// -------------------------------------------------------------------------
export const listMyTales = queryGeneric({
  args: { accountId, guestTokenHash },
  handler: async (ctx, args) => {
    const accountDoc = await ctx.db.get(args.accountId);
    if (!accountDoc) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(accountDoc), args.guestTokenHash);
    const docs = await ctx.db
      .query("published_tales")
      .withIndex("by_ownerAccountId", (q: any) => q.eq("ownerAccountId", args.accountId))
      .collect();
    return (docs as Array<Record<string, any>>)
      .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0))
      .map(taleSummary);
  },
});

// -------------------------------------------------------------------------
// Read-along (Req 21.2) — records a tale_reads row and returns the paged,
// read-only projection. Enforces revocation, friends-only access (Req 21.5),
// and mature gating for the viewer (Req 12.9).
// -------------------------------------------------------------------------
export const readTale = mutationGeneric({
  args: { taleId, accountId: v.optional(accountId), guestTokenHash },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.taleId);
    if (!doc) throw new AppError("tale_not_found");

    // Resolve the viewer (optional — public/unlisted tales read anonymously).
    let viewerAccountId: string | undefined;
    let matureAllowed = false;
    if (args.accountId) {
      const accountDoc = await ctx.db.get(args.accountId);
      if (!accountDoc) throw new AppError("account_not_found");
      const account = accountFromDoc(accountDoc);
      await assertAccountSessionAccess(ctx, account, args.guestTokenHash);
      viewerAccountId = args.accountId;
      const entitlement = await loadEntitlement(ctx, args.accountId);
      matureAllowed = account.matureContentEnabled && canEnableMatureContent(account, entitlement);
    }

    // Mature tales are unavailable to anonymous guests and non-opted-in readers
    // (Req 12.9). Checked before the read is recorded.
    if (doc.isMature && !matureAllowed) throw new AppError("tale_mature_forbidden");

    // Source-independent: reads the denormalized snapshot (no live-row deps).
    const tale = await resolveTaleRecord(ctx, doc);

    // projectReadAlong enforces revocation (Req 21.6) + friends-only (Req 21.5).
    // No friend graph exists yet, so friends-only tales resolve for the owner
    // only. See integrator notes.
    const projection = projectReadAlong({
      tale,
      ...(viewerAccountId === undefined ? {} : { viewerAccountId }),
      friendAccountIds: [],
      now: Date.now(),
    });

    await ctx.db.insert(
      "tale_reads",
      cleanDoc({
        taleId: args.taleId,
        ...(viewerAccountId ? { accountId: args.accountId } : {}),
        readAt: Date.now(),
      }),
    );

    // Req 10.1: surface the featured cinematic on the read-along projection so
    // the tale screen can play it via CinematicMoment. Reached only after the
    // tale-level mature gate above (a mature tale throws for a non-opted-in
    // viewer before this), so the URL is only ever returned to a cleared viewer.
    return { ...projection, leadCinematic: leadCinematicFromDoc(doc) };
  },
});

// -------------------------------------------------------------------------
// Fork (Req 21.3) — create a new save initialized from the engine state at the
// chosen decision point, record the fork lineage, and return the new save.
// -------------------------------------------------------------------------
export const forkTale = mutationGeneric({
  args: { taleId, sourceTurnId: turnId, accountId, guestTokenHash },
  handler: async (ctx, args) => {
    const accountDoc = await ctx.db.get(args.accountId);
    if (!accountDoc) throw new AppError("account_not_found");
    const account = accountFromDoc(accountDoc) as AccountRecord & { _id: string };
    await assertAccountSessionAccess(ctx, account, args.guestTokenHash);

    const doc = await ctx.db.get(args.taleId);
    if (!doc) throw new AppError("tale_not_found");

    const entitlement = await loadEntitlement(ctx, args.accountId);
    const matureAllowed = account.matureContentEnabled && canEnableMatureContent(account, entitlement);
    if (doc.isMature && !matureAllowed) throw new AppError("tale_mature_forbidden");

    // Source-independent: resolve the tale from the denormalized snapshot
    // (storyId + per-turn stateAfter + scene mirror), so a fork works even after
    // the source save was rewound or purged. No hydrate / replay needed.
    const tale = await resolveTaleRecord(ctx, doc);
    const storyId = tale.storyId;
    const story = await loadTaleStory(ctx, storyId);

    // Req 21.5: enforce the same privacy/revocation gate as readTale — a
    // friends-only or private tale is forkable only by its owner (no friend
    // graph yet, so friends-only resolves to owner-only). Without this,
    // forkTale let any account holding the taleId read a private tale's prose.
    assertCanReadTale({ tale, viewerAccountId: args.accountId, friendAccountIds: [] });

    const now = Date.now();
    // Pure logic: enforces forkPolicy (disabled / ending_only), revocation, and
    // re-runs the safety policy on the forked prose (Req 12.1-12.2).
    const plan = buildForkPlan({
      tale,
      sourceTurnId: String(args.sourceTurnId),
      account,
      entitlement,
      now,
    });

    const startingState = plan.startingState as PlayerState;
    // Mode travels with the snapshot's engine state (PlayerState.mode).
    const mode: SaveRecord["mode"] = startingState.mode === "hardcore" ? "hardcore" : "story";
    const base = createSaveRecord({
      accountId: args.accountId,
      story,
      mode,
      now,
      rngSeed: `fork:${String(args.taleId)}:${String(args.sourceTurnId)}`,
    });
    const forkedSave: SaveRecord = {
      ...base,
      state: startingState,
      currentNodeId: startingState.currentNodeId,
      turnNumber: startingState.turnNumber,
      updatedAt: now,
    };
    const newSaveId = await ctx.db.insert("saves", cleanDoc(forkedSave));

    // Story Bible fork copy (story-bible R1.6/R2.4): a fork inherits the same
    // planned world — copy the source save's bible row verbatim (consumption
    // state included) instead of scheduling a new bible call. Only a ready
    // bible is worth carrying (a queued/failed source row means the fork
    // simply plays bible-less, exactly like its source would). Best-effort:
    // a purged source save (hardcore) or missing row is a silent no-op.
    try {
      const sourceBible = await ctx.db
        .query("story_bibles")
        .withIndex("by_saveId", (q: any) => q.eq("saveId", doc.sourceSaveId))
        .first();
      if (sourceBible && (sourceBible as { status?: string }).status === "ready") {
        const src = sourceBible as {
          bible?: unknown;
          attachedAtTurn?: number;
          lastRefreshAct?: number;
          retryCount?: number;
        };
        await ctx.db.insert(
          "story_bibles",
          cleanDoc({
            saveId: newSaveId,
            status: "ready" as const,
            bible: src.bible,
            ...(src.attachedAtTurn !== undefined
              ? { attachedAtTurn: src.attachedAtTurn }
              : {}),
            ...(src.lastRefreshAct !== undefined
              ? { lastRefreshAct: src.lastRefreshAct }
              : {}),
            retryCount: src.retryCount ?? 0,
            createdAt: now,
            updatedAt: now,
          }),
        );
      }
    } catch {
      // The fork itself is the contract — a missing bible copy just means
      // the forked save plays bible-less (BC9).
    }

    // Mirror the source decision-point scene onto the new save so the reader
    // lands on the forked prose + choices; picking a choice continues with
    // fresh LLM generation through the normal read loop. The mirror data comes
    // from the snapshot (sceneMirror), not the live scenes row.
    const sourceSnapshot = tale.snapshotTurns.find(
      (turn) => turn.sourceTurnId === String(args.sourceTurnId),
    );
    const sourceScene = (sourceSnapshot?.sceneMirror ?? null) as
      | { choiceViews?: unknown[]; safety?: unknown; provider?: string; proposal?: unknown }
      | null;
    const sourceProse = sourceSnapshot?.prose;
    const scene = {
      saveId: newSaveId,
      nodeId: startingState.currentNodeId,
      turnNumber: startingState.turnNumber,
      stateFingerprint: [
        forkedSave.storyId,
        forkedSave.storyVersion,
        forkedSave.engineVersion,
        startingState.currentNodeId,
        startingState.turnNumber,
      ].join(":"),
      prose: typeof sourceProse === "string" ? sourceProse : "",
      streamStatus: "complete" as const,
      choiceViews: (sourceScene?.choiceViews as unknown[]) ?? [],
      engineEvents: (sourceSnapshot?.engineEvents as unknown[]) ?? [],
      safety: sourceScene?.safety ?? { risk: "normal", reasons: [] },
      provider: (sourceScene?.provider as string) ?? "deterministic",
      createdAt: now,
      completedAt: now,
      ...(sourceScene?.proposal ? { proposal: sourceScene.proposal } : {}),
    };
    const sceneId = await ctx.db.insert("scenes", cleanDoc(scene));
    await ctx.db.patch(newSaveId, { currentSceneId: sceneId });

    await ctx.db.insert(
      "tale_forks",
      cleanDoc({
        taleId: args.taleId,
        sourceTurnId: args.sourceTurnId,
        newSaveId,
        accountId: args.accountId,
        createdAt: now,
      }),
    );

    return {
      saveId: newSaveId,
      sceneId,
      scene: projectCurrentScene(
        { ...forkedSave, _id: newSaveId, currentSceneId: sceneId },
        story,
      ),
    };
  },
});

// -------------------------------------------------------------------------
// Edit metadata without rewriting the immutable turn snapshot (Req 21.4).
// Also the surface for switching privacy, including friends-only (Req 21.5).
// -------------------------------------------------------------------------
export const editTaleMetadata = mutationGeneric({
  args: {
    accountId,
    taleId,
    guestTokenHash,
    title: v.optional(v.string()),
    synopsis: v.optional(v.string()),
    privacy: v.optional(privacy),
    forkPolicy: v.optional(forkPolicy),
  },
  handler: async (ctx, args) => {
    const accountDoc = await ctx.db.get(args.accountId);
    if (!accountDoc) throw new AppError("account_not_found");
    const account = accountFromDoc(accountDoc);
    await assertAccountSessionAccess(ctx, account, args.guestTokenHash);

    const doc = await ctx.db.get(args.taleId);
    if (!doc) throw new AppError("tale_not_found");
    assertOwns({ ...account, _id: args.accountId }, { ownerAccountId: String(doc.ownerAccountId) });

    // Pure metadata edit — snapshot turns are untouched (Req 21.4).
    const current = taleRecordFromDoc(doc, []);
    const updated = updateTaleMetadata(current, {
      ...(args.title === undefined ? {} : { title: args.title }),
      ...(args.synopsis === undefined ? {} : { synopsis: args.synopsis }),
      ...(args.privacy === undefined ? {} : { privacy: args.privacy }),
      ...(args.forkPolicy === undefined ? {} : { forkPolicy: args.forkPolicy }),
      now: Date.now(),
    });

    await ctx.db.patch(
      args.taleId,
      cleanDoc({
        title: updated.title,
        synopsis: updated.synopsis,
        privacy: updated.privacy,
        forkPolicy: updated.forkPolicy,
        updatedAt: updated.updatedAt,
      }),
    );

    return taleSummary({
      ...doc,
      title: updated.title,
      synopsis: updated.synopsis,
      privacy: updated.privacy,
      forkPolicy: updated.forkPolicy,
      updatedAt: updated.updatedAt,
    });
  },
});

// -------------------------------------------------------------------------
// Unpublish (Req 21.6) — revoke public read/fork access immediately while the
// immutable audit record (snapshotTurnIds, tale_reads, tale_forks) is retained
// for owner export/deletion workflows.
// -------------------------------------------------------------------------
export const unpublishTale = mutationGeneric({
  args: { accountId, taleId, guestTokenHash },
  handler: async (ctx, args) => {
    const accountDoc = await ctx.db.get(args.accountId);
    if (!accountDoc) throw new AppError("account_not_found");
    const account = accountFromDoc(accountDoc);
    await assertAccountSessionAccess(ctx, account, args.guestTokenHash);

    const doc = await ctx.db.get(args.taleId);
    if (!doc) throw new AppError("tale_not_found");
    assertOwns({ ...account, _id: args.accountId }, { ownerAccountId: String(doc.ownerAccountId) });

    const revoked = revokeTale(taleRecordFromDoc(doc, []), Date.now());
    await ctx.db.patch(
      args.taleId,
      cleanDoc({ accessRevokedAt: revoked.accessRevokedAt, updatedAt: revoked.updatedAt }),
    );

    return { taleId: args.taleId, revoked: true, accessRevokedAt: revoked.accessRevokedAt };
  },
});
