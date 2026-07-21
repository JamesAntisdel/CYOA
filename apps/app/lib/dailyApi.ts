/**
 * Story-engagement Wave 3 — Daily Tale client transport + pure render logic
 * (design §4.3, §6, §7 / R13).
 *
 * Mirrors the per-feature `*Api.ts` pattern (see `cinematicApi.ts`): a thin
 * typed wrapper over the canonical `convexHttp` transport plus the pure
 * derivation logic (countdown math, distribution render model) that the
 * DailyCard / DailyResults surfaces render.
 *
 * BUILD CORRECTIONS honored:
 *  - BC1: every convex path string is the FULL registered path INCLUDING the
 *    directory-less `dailyFunctions:` prefix (`convex/dailyFunctions.ts` →
 *    `dailyFunctions:fn`). A wrong path silently 404s every poll.
 *  - BC2: `convexHttp` casts, it does NOT validate. The server emits
 *    null-for-absent; the adapters below map those to optional client fields
 *    and tolerate a partially-populated / missing projection.
 *  - BC4: `exactOptionalPropertyTypes` — optional props via conditional spread.
 *
 * The pure helpers import NOTHING from React Native so they are unit-testable
 * under vitest (`lib/__tests__/dailyApi.test.ts`).
 */
import { convexHttp } from "./convexHttp";
import { convexHttpWithError } from "./convexHttp";

// ---------------------------------------------------------------------------
// Wire shapes (design §7). Client-facing (adapted) types first, then the raw
// server shapes with null-for-absent that the adapters reconcile.
// ---------------------------------------------------------------------------

/** Today's Daily Tale card model (adapted). */
export type RemoteDailyToday = {
  dailyId: string;
  /** UTC calendar day, `yyyy-mm-dd`. */
  date: string;
  title: string;
  /** One-line spoiler-safe teaser of the shared dramatic question. */
  questionTeaser: string;
  /** Whether THIS reader (account/guest) has already started today's run. */
  played: boolean;
};

/** One ending bucket in the global distribution (adapted). */
export type DailyDistributionEntry = {
  endingId: string;
  label: string;
  /** Number of readers who reached this ending. */
  count: number;
  /** Share of finishers, 0–100 (server-computed — BC10, never raw math). */
  pct: number;
  /** Display name of the first reader to find this ending, when known. */
  firstAccountName?: string;
};

/** The Daily results payload (adapted). */
export type RemoteDailyResults = {
  /** The ending this reader reached, or null if they haven't finished. */
  yours: { endingId: string; label: string } | null;
  distribution: DailyDistributionEntry[];
};

// Raw server shapes — every optional field is null-for-absent, not undefined.
type ServerDailyToday = {
  dailyId: string;
  date: string;
  title: string;
  questionTeaser: string;
  played: boolean;
};
type ServerDailyDistributionEntry = {
  endingId: string;
  label: string;
  count: number;
  pct: number;
  firstAccountName: string | null;
};

// ---------------------------------------------------------------------------
// Adapters (exported for direct unit testing — BC2 null-mapping).
// ---------------------------------------------------------------------------

/**
 * Map the raw `getToday` server value to the optional client card. Returns
 * `null` when there is no Daily for today (`daily: null`) OR the payload is
 * missing required fields — the card hides in both cases (design §10: "Daily
 * card hides without a row").
 */
export function adaptDailyToday(
  raw: { daily: ServerDailyToday | null } | null | undefined,
): RemoteDailyToday | null {
  const daily = raw?.daily;
  if (!daily || typeof daily.dailyId !== "string") return null;
  return {
    dailyId: daily.dailyId,
    date: typeof daily.date === "string" ? daily.date : "",
    title: typeof daily.title === "string" ? daily.title : "Today's tale",
    questionTeaser: typeof daily.questionTeaser === "string" ? daily.questionTeaser : "",
    // Absent/garbage `played` → treated as not-yet-played (safer default: the
    // reader can always attempt startDaily, which is the real one-per-day gate).
    played: daily.played === true,
  };
}

/**
 * Map the raw `getResults` server value to the client results model. Tolerates
 * a missing/garbage payload (→ empty distribution) and null-for-absent
 * `firstAccountName` on each bucket (BC2/BC4).
 */
export function adaptDailyResults(
  raw:
    | {
        yours: { endingId: string; label: string } | null;
        distribution: ServerDailyDistributionEntry[] | null;
      }
    | null
    | undefined,
): RemoteDailyResults {
  const yoursRaw = raw?.yours ?? null;
  const yours =
    yoursRaw && typeof yoursRaw.endingId === "string"
      ? { endingId: yoursRaw.endingId, label: typeof yoursRaw.label === "string" ? yoursRaw.label : yoursRaw.endingId }
      : null;
  const distribution = Array.isArray(raw?.distribution)
    ? raw!.distribution
        .filter((e): e is ServerDailyDistributionEntry => Boolean(e) && typeof e.endingId === "string")
        .map((e) => ({
          endingId: e.endingId,
          label: typeof e.label === "string" ? e.label : e.endingId,
          count: Number.isFinite(e.count) ? Math.max(0, Math.floor(e.count)) : 0,
          pct: Number.isFinite(e.pct) ? Math.max(0, e.pct) : 0,
          // null-for-absent → drop the optional key entirely (BC4).
          ...(e.firstAccountName ? { firstAccountName: e.firstAccountName } : {}),
        }))
    : [];
  return { yours, distribution };
}

// ---------------------------------------------------------------------------
// Transport (BC1 full paths).
// ---------------------------------------------------------------------------

/** Full registered convex paths — BC1. Exported so the contract smoke test can assert them. */
export const DAILY_PATHS = {
  getToday: "dailyFunctions:getToday",
  startDaily: "dailyFunctions:startDaily",
  getResults: "dailyFunctions:getResults",
  // Daily Killcam (R2). Full registered path — BC1/DK5.
  getChoicePulse: "dailyFunctions:getChoicePulse",
} as const;

/** Server AppError code raised when the reader already started today's Daily. */
export const DAILY_ALREADY_PLAYED = "daily_already_played";

/**
 * Fetch today's Daily card. Returns `null` when there is no Daily for today or
 * the backend is unreachable — the card hides in both cases.
 */
export async function getRemoteDailyToday(input: {
  accountId?: string;
  guestTokenHash?: string;
}): Promise<RemoteDailyToday | null> {
  const result = await convexHttp<{ daily: ServerDailyToday | null }>(
    "query",
    DAILY_PATHS.getToday,
    input as unknown as Record<string, unknown>,
  );
  return adaptDailyToday(result);
}

/**
 * Start today's Daily run for this reader. Creates a save flagged with the
 * daily's fixed arc and returns its id. Surfaces the `daily_already_played`
 * AppError through the discriminated union so the caller can route the reader
 * to the results screen instead of showing a generic failure.
 */
export async function startRemoteDaily(input: {
  accountId: string;
  guestTokenHash?: string;
}): Promise<
  | { ok: true; saveId: string }
  | { ok: false; errorCode: string; errorMessage: string }
  | null
> {
  return convexHttpWithError<{ saveId: string }>(
    "mutation",
    DAILY_PATHS.startDaily,
    input as unknown as Record<string, unknown>,
  );
}

/**
 * Fetch the Daily results (this reader's ending vs the global distribution).
 * Always returns a model (empty distribution) when reachable; `null` only on
 * transport failure so the caller can retry/poll.
 */
export async function getRemoteDailyResults(input: {
  dailyId: string;
  accountId: string;
  guestTokenHash?: string;
}): Promise<RemoteDailyResults | null> {
  const result = await convexHttp<{
    yours: { endingId: string; label: string } | null;
    distribution: ServerDailyDistributionEntry[] | null;
  }>("query", DAILY_PATHS.getResults, input as unknown as Record<string, unknown>);
  if (result === null) return null;
  return adaptDailyResults(result);
}

// ---------------------------------------------------------------------------
// Countdown math (pure — ms to the next UTC 00:00).
// ---------------------------------------------------------------------------

export type CountdownParts = { hours: number; minutes: number; seconds: number };

/** Milliseconds from `now` until the next UTC midnight (start of tomorrow). */
export function msUntilNextUtcMidnight(now: number): number {
  const d = new Date(now);
  const nextMidnight = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return Math.max(0, nextMidnight - now);
}

/** Break a millisecond span into whole {hours, minutes, seconds}. */
export function countdownParts(ms: number): CountdownParts {
  const clamped = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  return { hours, minutes, seconds };
}

/**
 * Human countdown string for the DailyCard, e.g. `7h 23m` when an hour or more
 * remains, otherwise `23m 04s` for the final hour so the last minutes read as
 * live. Always two-digit-padded on the trailing unit.
 */
export function formatCountdown(ms: number): string {
  const { hours, minutes, seconds } = countdownParts(ms);
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** Convenience: the human countdown to the next Daily from `now`. */
export function nextDailyCountdown(now: number): string {
  return formatCountdown(msUntilNextUtcMidnight(now));
}

// ---------------------------------------------------------------------------
// Distribution render model (pure — sorted bars, rarest + first-finder marks).
// ---------------------------------------------------------------------------

export type DistributionBar = DailyDistributionEntry & {
  /** True for the reader's own ending (highlighted bar). */
  isYours: boolean;
  /** True for the rarest reached ending (min count among count>0). */
  isRarest: boolean;
  /** True when a first-finder name is present on this bucket. */
  hasFirstFinder: boolean;
};

export type DistributionModel = {
  bars: DistributionBar[];
  /** The rarest reached ending, surfaced as a callout above the bars. */
  rarest: DistributionBar | null;
  /** Total finishers across all buckets. */
  total: number;
};

/**
 * Build the DailyResults render model: buckets sorted most-common-first, the
 * reader's own ending flagged, and the rarest REACHED ending (min count with
 * count>0) marked for the "only X% found this" callout. Ties on count break by
 * label for a stable order. A `yoursEndingId` marks the reader's bar even when
 * they finished but their ending has zero others.
 */
export function buildDistributionModel(
  results: RemoteDailyResults | null | undefined,
): DistributionModel {
  const entries = results?.distribution ?? [];
  const yoursId = results?.yours?.endingId ?? null;
  const total = entries.reduce((sum, e) => sum + e.count, 0);

  // Rarest = smallest positive count; ties broken by lowest pct then label.
  const reached = entries.filter((e) => e.count > 0);
  let rarestId: string | null = null;
  if (reached.length > 0) {
    const rarestEntry = reached.reduce((best, e) => {
      if (e.count !== best.count) return e.count < best.count ? e : best;
      if (e.pct !== best.pct) return e.pct < best.pct ? e : best;
      return e.label <= best.label ? e : best;
    });
    rarestId = rarestEntry.endingId;
  }

  const bars: DistributionBar[] = [...entries]
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label);
    })
    .map((e) => ({
      ...e,
      isYours: yoursId !== null && e.endingId === yoursId,
      isRarest: e.endingId === rarestId,
      hasFirstFinder: typeof e.firstAccountName === "string" && e.firstAccountName.length > 0,
    }));

  const rarest = bars.find((b) => b.isRarest) ?? null;
  return { bars, rarest, total };
}

/** The "N% of readers found this" line for a bucket. */
export function distributionShareLine(bar: DailyDistributionEntry): string {
  const pct = Math.round(bar.pct);
  return `${pct}% of readers found this`;
}

// ---------------------------------------------------------------------------
// Daily Killcam — the mid-run pulse (design daily-killcam §3 / R2, R3).
//
// The reader's OWN bucket per early turn: "62% of today's readers chose this".
// Spoiler discipline (BC10 / DK): the server returns ONLY the reader's own
// committed choice bucket — never other readers' labels or the full
// distribution — so there is nothing sensitive to filter here, only presence/
// type tolerance (BC2). Percentages are server-computed and rounded (DK5); the
// client renders `sharePct` VERBATIM — no percentage math client-side.
// ---------------------------------------------------------------------------

/**
 * One early-turn pulse bucket (adapted 1:1 from the server `PulseEntry`). It
 * carries only the reader's own committed choice for that turn — no foreign
 * keys or labels ever cross the wire (BC10).
 */
export type RemotePulseEntry = {
  turnNumber: number;
  /** Share of today's readers who made the same choice, 0–100 (server-rounded, DK5). */
  sharePct: number;
  sameCount: number;
  totalReaders: number;
  /** Server-authored book-voice phrase (R2.4 tier table). */
  phrase: string;
};

// Raw server bucket — no optional/null-for-absent fields (design §3), so the
// adapter only validates presence + types and tolerates a missing payload.
type ServerPulseEntry = {
  turnNumber: number;
  sharePct: number;
  sameCount: number;
  totalReaders: number;
  phrase: string;
};

/**
 * Map the raw `getChoicePulse` server value to the client pulse list. Tolerant
 * by design: ANY malformed / missing payload → empty array, and each malformed
 * bucket is dropped rather than surfaced (the chip/strip simply stays dark —
 * design §6 "malformed pulse payload at the client → adapter returns empty
 * array"). Entries are sorted by `turnNumber` so "newest" is deterministic.
 */
export function adaptChoicePulse(
  raw: { pulses: ServerPulseEntry[] | null } | null | undefined,
): RemotePulseEntry[] {
  const pulses = raw?.pulses;
  if (!Array.isArray(pulses)) return [];
  return pulses
    .filter(
      (e): e is ServerPulseEntry =>
        Boolean(e) &&
        Number.isFinite(e.turnNumber) &&
        Number.isFinite(e.sharePct) &&
        typeof e.phrase === "string",
    )
    .map((e) => ({
      turnNumber: Math.floor(e.turnNumber),
      // Rendered verbatim — clamp only for defensiveness, never re-derive (DK5).
      sharePct: Math.max(0, Math.min(100, e.sharePct)),
      sameCount: Number.isFinite(e.sameCount) ? Math.max(0, Math.floor(e.sameCount)) : 0,
      totalReaders: Number.isFinite(e.totalReaders) ? Math.max(0, Math.floor(e.totalReaders)) : 0,
      phrase: e.phrase,
    }))
    .sort((a, b) => a.turnNumber - b.turnNumber);
}

/**
 * Fetch the reader's early-turn pulse buckets for a Daily. Always resolves to a
 * model (empty array) so the surfaces degrade to "no chip" on any failure —
 * transport error (`null`), deploy skew (query throws → `null`), or malformed
 * payload all collapse to `[]` (design §6, decorative-never-fatal / BC5).
 */
export async function getRemoteChoicePulse(input: {
  dailyId: string;
  accountId: string;
  guestTokenHash?: string;
}): Promise<RemotePulseEntry[]> {
  const result = await convexHttp<{ pulses: ServerPulseEntry[] | null }>(
    "query",
    DAILY_PATHS.getChoicePulse,
    input as unknown as Record<string, unknown>,
  );
  return adaptChoicePulse(result);
}

/**
 * The one-line chip copy: `"62% of today's readers · the well-worn path"`. Copy
 * is ALWAYS scoped to "today's readers" — never "all readers" — because buckets
 * are approximate by design (R3.4). `sharePct` is rendered verbatim (DK5).
 */
export function pulseChipLabel(entry: RemotePulseEntry): string {
  return `${entry.sharePct}% of today's readers · ${entry.phrase}`;
}

/**
 * Pick the NEWEST pulse entry whose turn has actually been committed (its
 * `turnNumber` is at or below the reader's latest completed turn). Returns
 * `null` when the pulse is empty or every entry is for an uncommitted turn — the
 * chip self-hides in both cases (design §4 "self-hides … when the turn is not
 * yet committed"). Pure + deterministic (`adaptChoicePulse` sorts by turn).
 */
export function newestCommittedPulse(
  pulses: readonly RemotePulseEntry[],
  completedTurn: number,
): RemotePulseEntry | null {
  let newest: RemotePulseEntry | null = null;
  for (const entry of pulses) {
    if (entry.turnNumber > completedTurn) continue;
    if (!newest || entry.turnNumber > newest.turnNumber) newest = entry;
  }
  return newest;
}

/**
 * One "Opening forks" tile: the reader's OWN choice label (client-known from
 * their history) joined to its server pulse bucket.
 */
export type OpeningForkTile = {
  turnNumber: number;
  /** The reader's own committed label for that turn (never another reader's). */
  label: string;
  entry: RemotePulseEntry;
};

/**
 * Build the OpeningForks strip model: inner-join the reader's own early-turn
 * choice labels with the pulse buckets that met the server threshold, keyed by
 * `turnNumber`. Only turns for which BOTH a reader label AND a qualifying pulse
 * exist become tiles; the result is sorted by turn and capped by the pulses the
 * server returned (already ≤ KILLCAM_TURN_CAP). Empty result ⇒ the strip hides.
 * Pure + total.
 */
export function buildOpeningForkTiles(
  choiceHistory: readonly { turnNumber: number; choiceLabel: string }[],
  pulses: readonly RemotePulseEntry[],
): OpeningForkTile[] {
  // Last-write-wins per turn so a rewind→re-choose label supersedes the old one.
  const labelByTurn = new Map<number, string>();
  for (const h of choiceHistory) {
    if (typeof h?.choiceLabel === "string" && h.choiceLabel.length > 0) {
      labelByTurn.set(h.turnNumber, h.choiceLabel);
    }
  }
  const tiles: OpeningForkTile[] = [];
  for (const entry of pulses) {
    const label = labelByTurn.get(entry.turnNumber);
    if (!label) continue;
    tiles.push({ turnNumber: entry.turnNumber, label, entry });
  }
  return tiles.sort((a, b) => a.turnNumber - b.turnNumber);
}
