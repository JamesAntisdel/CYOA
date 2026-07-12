/**
 * Creator analytics dashboard (core-read-loop Req 22.4/22.5; steering
 * product feature 13 — creator seeds + discovery library).
 *
 * Two concerns live here:
 *
 *  1. `insertCreatorPlayTimeAttribution` — the fire-and-forget writer the
 *     game.ts turn-completion paths call whenever a turn completes on a save
 *     whose storyId parses as an authored seed (`authored_seed:<id>`). Each
 *     event credits ONE contiguous slice of wall-clock time (previous
 *     save.updatedAt → now, clamped) to the seed's creator, so the slices
 *     from submitChoice / beginStreamingChoice / completeSceneStream never
 *     overlap. Owner self-play is still recorded but flagged
 *     (`payload.selfPlay: true`) so the dashboard can separate it from
 *     external reader time.
 *
 *  2. `creatorDashboard:getSeedStats` — the owner-scoped aggregation query.
 *     It aggregates LIVE from existing tables (saves, tale_forks +
 *     published_tales, analytics_events); no new schema. Panel review: the
 *     quit-point histogram (stale, non-terminal saves bucketed by
 *     turnNumber) is the headline creator insight — "readers drift away
 *     around turn N".
 *
 * This is owner-facing analytics about the owner's OWN published story
 * graph, so ending labels here come from the seed's story JSON the creator
 * authored — no reader-hidden state or unfired content leaves the server
 * (BC10 does not bite: nothing here reaches a reader).
 */
import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import type { Story } from "@cyoa/engine";

import { buildPlayTimeAttributionEvent, type AuthoredSeedRecord } from "./creator";
import { assertAccountSessionAccess } from "./lib/authz";
import { accountFromDoc, cleanDoc } from "./lib/docs";
import { AppError } from "./lib/errors";
import { authoredSeedStoryId, parseAuthoredSeedStoryId } from "./liveCore";

const accountId = v.id("accounts");
const guestTokenHash = v.optional(v.string());

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * A non-terminal save untouched for this long counts as a quit point. Long
 * enough that "slept on it" reads don't count as churn; short enough that the
 * histogram reacts within a couple of days of publishing.
 */
export const QUIT_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

/** Play-time clamp: a parked tab must not credit hours to the creator. */
export const PLAY_SECONDS_MIN = 1;
export const PLAY_SECONDS_CAP = 10 * 60; // 10 minutes per turn slice

/**
 * Bounded scans over the attribution event stream / fork rows. Neither table
 * has a per-story index (schema is NOT owned by this module — see blockers in
 * the task report); a bounded most-recent window keeps the query cheap and is
 * accurate at current volume. Revisit with a `by_story` index when creator
 * volume grows.
 */
export const EVENT_SCAN_LIMIT = 4096;
export const FORK_SCAN_LIMIT = 2048;

// ---------------------------------------------------------------------------
// (1) Play-time attribution (Req 22.5 — revenue-share input signal)
// ---------------------------------------------------------------------------

/** Clamp a raw seconds delta into the attribution band. */
export function clampPlaySeconds(rawSeconds: number): number {
  if (!Number.isFinite(rawSeconds)) return PLAY_SECONDS_MIN;
  return Math.min(PLAY_SECONDS_CAP, Math.max(PLAY_SECONDS_MIN, Math.floor(rawSeconds)));
}

/**
 * Fire-and-forget `creator.play_time` insert for one completed turn on an
 * authored-seed save. Same discipline as game.ts's `insertStoryAnalytics`:
 * never throws out of the caller, never blocks or fails the turn.
 *
 * `save.updatedAt` must be the PRE-PATCH value the handler loaded at entry —
 * the moment the save was last written — so `now - updatedAt` is exactly the
 * wall-clock slice this turn owns:
 *   - submitChoice (non-streaming): previous completion → now (read + decide)
 *   - beginStreamingChoice (authored): previous completion → choice made
 *   - completeSceneStream (authored): choice made → prose landed (watch time)
 *
 * Owner ≠ player counts as external play; owner self-play is inserted too but
 * flagged `selfPlay: true` so the dashboard separates it (Req 22.4).
 */
export async function insertCreatorPlayTimeAttribution(
  ctx: { db: { get: (id: any) => Promise<any>; insert: (table: string, doc: any) => Promise<any> } },
  input: {
    save: { storyId: string; updatedAt: number };
    readerAccountId: string;
    now: number;
  },
): Promise<void> {
  const seedIdValue = parseAuthoredSeedStoryId(input.save.storyId);
  if (!seedIdValue) return; // not an authored seed — nothing to attribute
  try {
    const seedDoc = (await ctx.db.get(seedIdValue)) as
      | (Record<string, unknown> & { _id: unknown; ownerAccountId?: unknown })
      | null;
    // Tolerant-drop: a deleted/garbage seed row silently skips attribution —
    // the turn itself already succeeded.
    if (!seedDoc || seedDoc.ownerAccountId === undefined) return;
    const ownerAccountId = String(seedDoc.ownerAccountId);
    const seed = {
      ...seedDoc,
      _id: String(seedDoc._id),
      ownerAccountId,
    } as AuthoredSeedRecord & { _id: string };
    const seconds = clampPlaySeconds((input.now - input.save.updatedAt) / 1000);
    const event = buildPlayTimeAttributionEvent({
      seed,
      readerAccountId: input.readerAccountId,
      seconds,
      now: input.now,
    });
    await ctx.db.insert(
      "analytics_events",
      cleanDoc({
        ...event,
        // The builder reads storyId off the seed's inner story JSON; fall back
        // to the save's canonical `authored_seed:<id>` form if that's absent.
        storyId: typeof event.storyId === "string" && event.storyId.length > 0
          ? event.storyId
          : input.save.storyId,
        payload: { ...event.payload, selfPlay: ownerAccountId === input.readerAccountId },
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[creatorDashboard] play-time attribution failed story=${input.save.storyId} error=${message.slice(0, 200)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// (2) Aggregation — pure helpers (fake-ctx / vitest coverage lives in
//     convex/tests/creatorDashboard.test.ts)
// ---------------------------------------------------------------------------

export type SeedEndingBucket = {
  endingId: string;
  /** Human label from the seed's own story JSON; null when unknown. */
  label: string | null;
  count: number;
};

export type SeedQuitPoint = { turnNumber: number; count: number };

export type SeedStatsWire = {
  seedId: string;
  storyId: string;
  title: string;
  updatedAt: number;
  plays: number;
  selfPlays: number;
  externalPlays: number;
  inProgress: number;
  completions: number;
  deaths: number;
  safeExits: number;
  endings: SeedEndingBucket[];
  forks: number;
  playSeconds: number;
  externalPlaySeconds: number;
  quitPoints: SeedQuitPoint[];
};

/**
 * Resolve the ending a terminal save reached from the seed's own story graph:
 * the save's resting node carries `endingId`, and the story's ending registry
 * carries the label the creator wrote. Safety-forced exits park the save in
 * `ended_safely` without moving it to an ending node — bucket those as the
 * synthetic safe ending. Anything unresolvable lands in "unknown" instead of
 * being dropped, so the distribution always sums to the terminal count.
 */
export function resolveSaveEnding(
  story: Story | null,
  row: Record<string, unknown>,
  status: "dead" | "ended" | "ended_safely",
): { endingId: string; label: string | null } {
  const nodeId = typeof row.currentNodeId === "string" ? row.currentNodeId : "";
  const node = nodeId && story?.nodes ? story.nodes[nodeId] : undefined;
  const endingId = node?.endingId;
  if (endingId) {
    const label = story?.endings?.[endingId]?.label;
    return {
      endingId,
      label: typeof label === "string" && label.trim().length > 0 ? label.trim() : null,
    };
  }
  if (status === "ended_safely") return { endingId: "ending-safe", label: "Safe exit" };
  return { endingId: "unknown", label: null };
}

/**
 * Fold one published seed's save rows into the wire stats. Tolerant-drop:
 * rows missing status/turnNumber/updatedAt are skipped, never thrown on.
 */
export function buildSeedStats(input: {
  seed: { _id: string; ownerAccountId: string; title?: unknown; story?: unknown; updatedAt?: unknown };
  storyId: string;
  saves: Array<Record<string, unknown>>;
  forkCount: number;
  playSeconds: { total: number; external: number };
  now: number;
  staleAfterMs?: number;
}): SeedStatsWire {
  const staleAfterMs = input.staleAfterMs ?? QUIT_STALE_AFTER_MS;
  const story = (input.seed.story && typeof input.seed.story === "object"
    ? input.seed.story
    : null) as Story | null;

  let plays = 0;
  let selfPlays = 0;
  let inProgress = 0;
  let completions = 0;
  let deaths = 0;
  let safeExits = 0;
  const endingBuckets = new Map<string, SeedEndingBucket>();
  const quitBuckets = new Map<number, number>();

  for (const row of input.saves) {
    const status = typeof row.status === "string" ? row.status : null;
    const turnNumber =
      typeof row.turnNumber === "number" && Number.isFinite(row.turnNumber)
        ? Math.max(0, Math.floor(row.turnNumber))
        : null;
    const updatedAt = typeof row.updatedAt === "number" ? row.updatedAt : null;
    if (status === null || turnNumber === null || updatedAt === null) continue;

    plays += 1;
    if (String(row.accountId ?? "") === input.seed.ownerAccountId) selfPlays += 1;

    if (status === "active") {
      // Quit point: a run that stalled mid-story. Fresh active saves are
      // readers still reading — not churn.
      if (input.now - updatedAt >= staleAfterMs) {
        quitBuckets.set(turnNumber, (quitBuckets.get(turnNumber) ?? 0) + 1);
      } else {
        inProgress += 1;
      }
      continue;
    }
    if (status !== "dead" && status !== "ended" && status !== "ended_safely") continue;

    if (status === "dead") deaths += 1;
    else if (status === "ended") completions += 1;
    else safeExits += 1;

    const ending = resolveSaveEnding(story, row, status);
    const bucket = endingBuckets.get(ending.endingId) ?? {
      endingId: ending.endingId,
      label: ending.label,
      count: 0,
    };
    bucket.count += 1;
    endingBuckets.set(ending.endingId, bucket);
  }

  return {
    seedId: input.seed._id,
    storyId: input.storyId,
    title: typeof input.seed.title === "string" ? input.seed.title : input.seed._id,
    updatedAt: typeof input.seed.updatedAt === "number" ? input.seed.updatedAt : 0,
    plays,
    selfPlays,
    externalPlays: plays - selfPlays,
    inProgress,
    completions,
    deaths,
    safeExits,
    endings: [...endingBuckets.values()].sort((left, right) => right.count - left.count),
    forks: input.forkCount,
    playSeconds: Math.round(input.playSeconds.total),
    externalPlaySeconds: Math.round(input.playSeconds.external),
    quitPoints: [...quitBuckets.entries()]
      .map(([turnNumber, count]) => ({ turnNumber, count }))
      .sort((left, right) => left.turnNumber - right.turnNumber),
  };
}

/**
 * Group `creator.play_time` event rows by `payload.authoredSeedId`. Tolerant-
 * drop: rows without an authoredSeedId or a positive finite `seconds` are
 * skipped. `external` excludes owner self-play (`payload.selfPlay: true`).
 */
export function aggregatePlayTimeBySeed(
  events: Array<Record<string, unknown>>,
): Map<string, { total: number; external: number }> {
  const bySeed = new Map<string, { total: number; external: number }>();
  for (const event of events) {
    const payload = (event.payload ?? null) as Record<string, unknown> | null;
    if (!payload) continue;
    const seedId = typeof payload.authoredSeedId === "string" ? payload.authoredSeedId : null;
    const seconds =
      typeof payload.seconds === "number" && Number.isFinite(payload.seconds) && payload.seconds > 0
        ? payload.seconds
        : null;
    if (!seedId || seconds === null) continue;
    const entry = bySeed.get(seedId) ?? { total: 0, external: 0 };
    entry.total += seconds;
    if (payload.selfPlay !== true) entry.external += seconds;
    bySeed.set(seedId, entry);
  }
  return bySeed;
}

// ---------------------------------------------------------------------------
// (2) Aggregation — registered query
// ---------------------------------------------------------------------------

/**
 * Owner-scoped per-seed stats for the creator dashboard.
 *
 * Wire shape (BC2 — the server emits null-for-absent; the client adapter in
 * apps/app/lib/creatorDashboardApi.ts maps nulls to optional fields):
 *
 *   {
 *     seeds: [{
 *       seedId: string,
 *       storyId: string,            // "authored_seed:<seedId>"
 *       title: string,
 *       updatedAt: number,
 *       plays: number,              // distinct saves created on this seed
 *       selfPlays: number,          // owner's own runs (flagged, separable)
 *       externalPlays: number,      // plays - selfPlays
 *       inProgress: number,         // active AND recently touched
 *       completions: number,        // status "ended"
 *       deaths: number,             // status "dead"
 *       safeExits: number,          // status "ended_safely"
 *       endings: [{ endingId: string, label: string | null, count: number }],
 *       forks: number,              // tale forks rooted in this seed's runs
 *       playSeconds: number,        // total attributed creator.play_time
 *       externalPlaySeconds: number,
 *       quitPoints: [{ turnNumber: number, count: number }],
 *     }]
 *   }
 *
 * Sorted newest-published-activity first. Creators with no published seeds
 * get `{ seeds: [] }` — the client renders the empty state.
 */
export const getSeedStats = queryGeneric({
  args: { accountId, guestTokenHash },
  handler: async (ctx, args) => {
    const owner = await ctx.db.get(args.accountId);
    if (!owner) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(owner), args.guestTokenHash);

    const seedDocs: Array<Record<string, unknown> & { _id: unknown }> = await ctx.db
      .query("authored_seeds")
      .withIndex("by_ownerAccountId", (q: any) => q.eq("ownerAccountId", args.accountId))
      .collect();
    const published = seedDocs.filter((doc) => doc.status === "published");
    if (published.length === 0) return { seeds: [] };

    const now = Date.now();

    // Attributed play time — most-recent bounded window of the event stream.
    const playTimeEvents: Array<Record<string, unknown>> = await ctx.db
      .query("analytics_events")
      .withIndex("by_eventName", (q: any) => q.eq("eventName", "creator.play_time"))
      .order("desc")
      .take(EVENT_SCAN_LIMIT);
    const playSecondsBySeed = aggregatePlayTimeBySeed(playTimeEvents);

    // Fork counts: tale_forks → owning tale → tale.storyId. The tale doc get
    // is cached per taleId; tales that predate the denormalized storyId (or
    // were deleted) drop out silently.
    const forkRows: Array<Record<string, unknown>> = await ctx.db
      .query("tale_forks")
      .order("desc")
      .take(FORK_SCAN_LIMIT);
    const taleStoryById = new Map<string, string | null>();
    const forkCountByStory = new Map<string, number>();
    for (const fork of forkRows) {
      const taleIdValue = fork.taleId;
      if (taleIdValue === undefined || taleIdValue === null) continue;
      const taleKey = String(taleIdValue);
      if (!taleStoryById.has(taleKey)) {
        const tale = (await ctx.db.get(taleIdValue as any)) as Record<string, unknown> | null;
        taleStoryById.set(
          taleKey,
          tale && typeof tale.storyId === "string" ? tale.storyId : null,
        );
      }
      const storyId = taleStoryById.get(taleKey);
      if (!storyId) continue;
      forkCountByStory.set(storyId, (forkCountByStory.get(storyId) ?? 0) + 1);
    }

    const seeds: SeedStatsWire[] = [];
    for (const doc of published) {
      const seedId = String(doc._id);
      const storyId = authoredSeedStoryId(seedId);
      const saves: Array<Record<string, unknown>> = await ctx.db
        .query("saves")
        .withIndex("by_storyId", (q: any) => q.eq("storyId", storyId))
        .collect();
      seeds.push(
        buildSeedStats({
          seed: {
            _id: seedId,
            ownerAccountId: String(doc.ownerAccountId),
            title: doc.title,
            story: doc.story,
            updatedAt: doc.updatedAt,
          },
          storyId,
          saves,
          forkCount: forkCountByStory.get(storyId) ?? 0,
          playSeconds: playSecondsBySeed.get(seedId) ?? { total: 0, external: 0 },
          now,
        }),
      );
    }
    seeds.sort((left, right) => right.updatedAt - left.updatedAt);
    return { seeds };
  },
});
