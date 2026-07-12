/**
 * Creator analytics dashboard client (core-read-loop Req 22.4/22.5).
 *
 * Mirrors the per-feature `*Api.ts` pattern (see `dailyApi.ts`): a thin typed
 * wrapper over the canonical `convexHttp` transport plus the pure render-model
 * derivations (quit-point sparkline bars, peak-turn headline, play-time
 * formatting) that `app/creator/dashboard.tsx` renders.
 *
 * BUILD CORRECTIONS honored:
 *  - BC1: the convex path is the FULL registered path
 *    (`convex/creatorDashboard.ts` → `creatorDashboard:getSeedStats`).
 *  - BC2: `convexHttp` casts, it does NOT validate. The server emits
 *    null-for-absent (`endings[].label: string | null`); the adapter maps
 *    nulls to optional client fields and tolerates a partial payload.
 *  - BC4: `exactOptionalPropertyTypes` — optional props via conditional spread.
 *
 * Pure helpers import NOTHING from React Native so they run under vitest
 * (`lib/__tests__/creatorDashboardApi.test.ts`).
 */
import { convexHttp } from "./convexHttp";

// ---------------------------------------------------------------------------
// Wire shapes — client-facing (adapted) types first, then the raw server
// shapes with null-for-absent that the adapter reconciles.
// ---------------------------------------------------------------------------

export type CreatorSeedEnding = {
  endingId: string;
  /** Human label from the creator's own story; absent when unknown. */
  label?: string;
  count: number;
};

export type CreatorSeedQuitPoint = { turnNumber: number; count: number };

export type CreatorSeedStats = {
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
  endings: CreatorSeedEnding[];
  forks: number;
  playSeconds: number;
  externalPlaySeconds: number;
  quitPoints: CreatorSeedQuitPoint[];
};

type ServerSeedEnding = { endingId: string; label: string | null; count: number };
type ServerSeedStats = {
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
  endings: ServerSeedEnding[] | null;
  forks: number;
  playSeconds: number;
  externalPlaySeconds: number;
  quitPoints: Array<{ turnNumber: number; count: number }> | null;
};

// ---------------------------------------------------------------------------
// Adapter (exported for direct unit testing — BC2 null-mapping).
// ---------------------------------------------------------------------------

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Map the raw `getSeedStats` payload to the client model. Tolerates a
 * missing/garbage payload (→ `[]`, which the route renders as the empty
 * state) and drops malformed rows instead of throwing.
 */
export function adaptCreatorSeedStats(
  raw: { seeds: ServerSeedStats[] | null } | null | undefined,
): CreatorSeedStats[] {
  if (!Array.isArray(raw?.seeds)) return [];
  return raw!.seeds
    .filter((seed): seed is ServerSeedStats => Boolean(seed) && typeof seed.seedId === "string")
    .map((seed) => ({
      seedId: seed.seedId,
      storyId: typeof seed.storyId === "string" ? seed.storyId : "",
      title: typeof seed.title === "string" && seed.title.length > 0 ? seed.title : seed.seedId,
      updatedAt: asCount(seed.updatedAt),
      plays: asCount(seed.plays),
      selfPlays: asCount(seed.selfPlays),
      externalPlays: asCount(seed.externalPlays),
      inProgress: asCount(seed.inProgress),
      completions: asCount(seed.completions),
      deaths: asCount(seed.deaths),
      safeExits: asCount(seed.safeExits),
      endings: Array.isArray(seed.endings)
        ? seed.endings
            .filter((e): e is ServerSeedEnding => Boolean(e) && typeof e.endingId === "string")
            .map((e) => ({
              endingId: e.endingId,
              // null-for-absent → drop the optional key entirely (BC4).
              ...(typeof e.label === "string" && e.label.length > 0 ? { label: e.label } : {}),
              count: asCount(e.count),
            }))
        : [],
      forks: asCount(seed.forks),
      playSeconds: asCount(seed.playSeconds),
      externalPlaySeconds: asCount(seed.externalPlaySeconds),
      quitPoints: Array.isArray(seed.quitPoints)
        ? seed.quitPoints
            .filter((point) => Boolean(point) && Number.isFinite(point.turnNumber))
            .map((point) => ({
              turnNumber: Math.max(0, Math.floor(point.turnNumber)),
              count: asCount(point.count),
            }))
        : [],
    }));
}

// ---------------------------------------------------------------------------
// Render models (pure — the "selection logic" the dashboard route draws).
// ---------------------------------------------------------------------------

/** One sparkline bar: `ratio` is 0..1 against the tallest bucket. */
export type QuitBar = {
  turnNumber: number;
  count: number;
  ratio: number;
  /** True for the tail bucket that folds turns ≥ maxBars together. */
  overflow: boolean;
};

/**
 * Turn the sparse quit-point histogram into contiguous sparkline bars:
 * zero-count turns are filled in so the x-axis reads as story progress, and
 * the long tail past `maxBars - 1` folds into one overflow bucket (a 40-turn
 * outlier must not flatten the bars where readers actually quit).
 * Returns `[]` when there is nothing to draw.
 */
export function buildQuitBars(quitPoints: CreatorSeedQuitPoint[], maxBars = 12): QuitBar[] {
  const counted = quitPoints.filter((point) => point.count > 0);
  if (counted.length === 0 || maxBars < 1) return [];
  const lastDirect = maxBars - 1;
  const buckets = new Map<number, number>();
  let hasOverflow = false;
  for (const point of counted) {
    const key = point.turnNumber > lastDirect ? lastDirect + 1 : point.turnNumber;
    if (point.turnNumber > lastDirect) hasOverflow = true;
    buckets.set(key, (buckets.get(key) ?? 0) + point.count);
  }
  const maxTurn = Math.max(...[...buckets.keys()]);
  const maxCount = Math.max(...[...buckets.values()]);
  const bars: QuitBar[] = [];
  for (let turn = 0; turn <= maxTurn; turn += 1) {
    const count = buckets.get(turn) ?? 0;
    bars.push({
      turnNumber: turn,
      count,
      ratio: maxCount > 0 ? count / maxCount : 0,
      overflow: hasOverflow && turn === lastDirect + 1,
    });
  }
  return bars;
}

/** The turn where the most readers drifted away, or null with no quits. */
export function peakQuitTurn(quitPoints: CreatorSeedQuitPoint[]): number | null {
  let peak: CreatorSeedQuitPoint | null = null;
  for (const point of quitPoints) {
    if (point.count <= 0) continue;
    if (!peak || point.count > peak.count) peak = point;
  }
  return peak ? peak.turnNumber : null;
}

/** Compact reader-facing duration: "2h 05m", "45m", "<1m". */
export function formatPlayTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return "<1m";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${String(rest).padStart(2, "0")}m`;
}

// ---------------------------------------------------------------------------
// Transport (BC1 full path).
// ---------------------------------------------------------------------------

/** Full registered convex path — BC1. Exported so tests can pin it. */
export const CREATOR_DASHBOARD_PATHS = {
  getSeedStats: "creatorDashboard:getSeedStats",
} as const;

/**
 * Fetch the owner's per-seed stats. `[]` means "no published seeds" (empty
 * state); `null` means the backend was unreachable so the route can retry.
 */
export async function getRemoteCreatorSeedStats(input: {
  accountId: string;
  guestTokenHash?: string;
}): Promise<CreatorSeedStats[] | null> {
  const result = await convexHttp<{ seeds: ServerSeedStats[] | null }>(
    "query",
    CREATOR_DASHBOARD_PATHS.getSeedStats,
    input as unknown as Record<string, unknown>,
  );
  if (result === null) return null;
  return adaptCreatorSeedStats(result);
}
