// =============================================================================
// Daily Tale — pure logic (story-engagement W3 / R13, design §6).
//
// PURE MODULE (BC6): no `Date.now`, no `Math.random`, no `console`. Every
// function is deterministic in its inputs — the date STRING (`yyyy-mm-dd`) and
// any timestamps/seeds are passed as PARAMETERS. This is what lets the mint
// cron reproduce the same premise for a given UTC day and lets tests assert
// determinism without mocking the clock.
// =============================================================================

/**
 * 14-entry tone rotation table (design §6). The date-derived epoch-day indexes
 * into this so the Daily's mood rotates on a two-week cycle. All entries are
 * all-ages by construction (R13.5).
 */
export const DAILY_TONE_ROTATION: readonly string[] = [
  "hopeful",
  "eerie",
  "whimsical",
  "melancholy",
  "adventurous",
  "mysterious",
  "tense",
  "wondrous",
  "bittersweet",
  "playful",
  "haunting",
  "heroic",
  "cozy",
  "wistful",
];

/**
 * Curated premise TEMPLATE BANK (design §6). Deterministic + reviewable — v1
 * does NOT ask an LLM to write the premise text; only the storyArc is authored
 * downstream. Every premise is all-ages (R13.5). Keep each `premise` a single
 * evocative sentence the opening-scene prompt can build on.
 */
export const DAILY_PREMISE_BANK: readonly { title: string; premise: string }[] = [
  {
    title: "The Lamp at World's Edge",
    premise:
      "You keep the last lighthouse on a coast the maps forgot, and tonight a ship signals in a language the light was built to answer.",
  },
  {
    title: "The Apprentice's Hour",
    premise:
      "The old clockmaker has vanished, leaving you a workshop of half-finished hours and one clock that must not be allowed to stop.",
  },
  {
    title: "The Shifting Valley",
    premise:
      "You are a cartographer hired to map a valley that rearranges itself each dawn, and the townsfolk swear the last mapmaker walked into their own drawing.",
  },
  {
    title: "What the Forest Remembers",
    premise:
      "You can hear the memories the old wood keeps, and the trees have grown restless about a promise someone broke a hundred years ago.",
  },
  {
    title: "The Folding Town",
    premise:
      "The last train is leaving a town that is quietly folding itself away, and you hold the only ticket that was never printed.",
  },
  {
    title: "Letters in the Crust",
    premise:
      "Your bakery bakes messages between two worlds into its loaves, and this morning a stranger's plea rose in the dough instead of yours.",
  },
  {
    title: "The Once Comet",
    premise:
      "You are a young astronomer chasing a comet that returns only once in a lifetime, and it has begun to answer the questions you point at it.",
  },
  {
    title: "The Book That Writes Back",
    premise:
      "You guard a library's single restless book that rewrites itself each night, and tonight it has started writing about you.",
  },
  {
    title: "Ferry Between Seasons",
    premise:
      "You ferry travelers across a river where one bank is always autumn and the other always spring, and a passenger has asked to be taken somewhere the river does not go.",
  },
  {
    title: "Wings for the Grounded",
    premise:
      "You are a tinkerer building wings for a town that has never left the ground, and the mayor wants them finished before the wind that comes only once a year.",
  },
  {
    title: "The Dream Garden",
    premise:
      "You tend a garden where the town's dreams take root and bloom, and something has begun growing there that no sleeper will admit to.",
  },
  {
    title: "The Singing Glass",
    premise:
      "You are a courier crossing a desert of glass that hums when the wind crosses it, carrying a sealed message the sand keeps trying to read.",
  },
];

// -- date math (pure) --------------------------------------------------------

/**
 * Days since the Unix epoch for a proleptic-Gregorian civil date. Howard
 * Hinnant's `days_from_civil` algorithm — pure integer math, no `Date`. Used to
 * turn a `yyyy-mm-dd` key into a monotonically increasing day ordinal so the
 * tone/template selection rotates sequentially day over day.
 */
export function epochDayFromISO(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) return 0;
  const y0 = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const y = y0 - (m <= 2 ? 1 : 0);
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/**
 * Format a millisecond timestamp as a UTC `yyyy-mm-dd` key. Pure (takes the
 * timestamp as a parameter — the caller reads `Date.now()`), so the cron and
 * tests agree on how a moment maps to a Daily day.
 */
export function isoDateFromMillis(nowMillis: number): string {
  const d = new Date(nowMillis);
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type DailyPremise = { premise: string; tone: string; title: string };

/**
 * Deterministic Daily premise for a UTC day (design §6). The epoch-day ordinal
 * indexes the tone rotation (mod 14) and — with a co-prime stride so tone and
 * template don't move in lockstep — the premise bank. Same `date` ⇒ same
 * output, forever. Returns the title from the bank entry so the Daily card and
 * the injected save share one name.
 */
export function buildDailyPremise(date: string): DailyPremise {
  const ordinal = epochDayFromISO(date);
  const toneCount = DAILY_TONE_ROTATION.length;
  const bankCount = DAILY_PREMISE_BANK.length;
  const toneIndex = ((ordinal % toneCount) + toneCount) % toneCount;
  // Stride the bank by a value co-prime with its length so the (tone, premise)
  // pair only repeats after toneCount × bankCount days rather than every day.
  const bankIndex = ((ordinal % bankCount) + bankCount) % bankCount;
  const tone = DAILY_TONE_ROTATION[toneIndex] ?? DAILY_TONE_ROTATION[0]!;
  const entry = DAILY_PREMISE_BANK[bankIndex] ?? DAILY_PREMISE_BANK[0]!;
  return { premise: entry.premise, tone, title: entry.title };
}

// -- distribution (pure) -----------------------------------------------------

export type DailyResultInput = {
  endingId: string;
  accountId: string;
  finishedAt: number;
};

export type DailyDistributionRow = {
  endingId: string;
  label: string;
  count: number;
  pct: number;
  firstAccountName?: string;
};

/**
 * Global ending distribution for a Daily (R13.3). Groups the result rows by
 * endingId, computes rounded percentages, and picks the EARLIEST finisher
 * (min `finishedAt`, ties broken by accountId for determinism) as the
 * first-finder whose display name — via `nameFor` — surfaces on the results
 * screen's badge. Pure: `labelFor`/`nameFor` inject all I/O-derived data.
 *
 * Sorted by count descending (then endingId) so the rarest paths sink to the
 * bottom and the client can render a stable order + a "rarest path" callout.
 */
export function computeDistribution(
  results: readonly DailyResultInput[],
  labelFor: (endingId: string) => string,
  nameFor?: (accountId: string) => string | undefined,
): DailyDistributionRow[] {
  const total = results.length;
  if (total === 0) return [];

  type Group = { count: number; firstAt: number; firstAccountId: string };
  const groups = new Map<string, Group>();
  for (const row of results) {
    const existing = groups.get(row.endingId);
    if (!existing) {
      groups.set(row.endingId, {
        count: 1,
        firstAt: row.finishedAt,
        firstAccountId: row.accountId,
      });
      continue;
    }
    existing.count += 1;
    // Earliest finisher wins; deterministic tie-break by accountId.
    if (
      row.finishedAt < existing.firstAt ||
      (row.finishedAt === existing.firstAt && row.accountId < existing.firstAccountId)
    ) {
      existing.firstAt = row.finishedAt;
      existing.firstAccountId = row.accountId;
    }
  }

  const rows: DailyDistributionRow[] = [];
  for (const [endingId, group] of groups) {
    const firstAccountName = nameFor ? nameFor(group.firstAccountId) : undefined;
    rows.push({
      endingId,
      label: labelFor(endingId),
      count: group.count,
      pct: Math.round((group.count / total) * 100),
      // BC4: conditional-spread the optional field, never `field: undefined`.
      ...(firstAccountName ? { firstAccountName } : {}),
    });
  }

  rows.sort((a, b) => (b.count - a.count) || (a.endingId < b.endingId ? -1 : a.endingId > b.endingId ? 1 : 0));
  return rows;
}

// -- terminal row shaper (pure) ----------------------------------------------

export type DailyResultRowInput = {
  dailyId: string;
  accountId: string;
  endingId: string;
  turnCount: number;
  finishedAt: number;
};

export type DailyResultRow = {
  dailyId: string;
  accountId: string;
  endingId: string;
  turnCount: number;
  finishedAt: number;
};

/**
 * Pure shaper for the `daily_results` row written when a Daily save reaches a
 * terminal (R13.3). Kept separate from the DB insert so the integrator's
 * game.ts terminal hook can build the row without importing convex context and
 * so the shape is unit-testable. `turnCount` is floored to a non-negative int.
 */
export function buildDailyResultRow(input: DailyResultRowInput): DailyResultRow {
  return {
    dailyId: input.dailyId,
    accountId: input.accountId,
    endingId: input.endingId,
    turnCount: Number.isFinite(input.turnCount) ? Math.max(0, Math.floor(input.turnCount)) : 0,
    finishedAt: input.finishedAt,
  };
}

/**
 * The teaser-safe dramatic question shown on the Daily card (R13.4). Reads the
 * stored storyArc's `dramaticQuestion` (a question is spoiler-safe — it frames
 * the stakes without revealing the candidate endings, BC10). Falls back to the
 * title when the arc is malformed. Pure over the stored json blob.
 */
export function dailyQuestionTeaser(storyArc: unknown, fallbackTitle: string): string {
  if (storyArc && typeof storyArc === "object") {
    const q = (storyArc as Record<string, unknown>).dramaticQuestion;
    if (typeof q === "string" && q.trim().length > 0) return q.trim();
  }
  return fallbackTitle;
}

/**
 * Map an endingId → its human label using the Daily arc's candidate endings
 * (design §7 results shape). Falls back to the raw id so a freeform ending id
 * (R2.4) still renders. Pure over the stored json blob.
 */
export function endingLabelResolver(storyArc: unknown): (endingId: string) => string {
  const labels = new Map<string, string>();
  if (storyArc && typeof storyArc === "object") {
    const candidates = (storyArc as Record<string, unknown>).candidateEndings;
    if (Array.isArray(candidates)) {
      for (const candidate of candidates) {
        if (candidate && typeof candidate === "object") {
          const id = (candidate as Record<string, unknown>).id;
          const label = (candidate as Record<string, unknown>).label;
          if (typeof id === "string" && typeof label === "string") {
            labels.set(id, label);
          }
        }
      }
    }
  }
  return (endingId: string) => labels.get(endingId) ?? endingId;
}

/**
 * Deterministic anonymous display handle for a first-finder badge. The product
 * has no user-facing display-name concept (accounts are anonymous guests/
 * users), so we derive a stable, PII-free handle from the account id rather
 * than leak an email/userId. Pure.
 */
export function anonymousReaderName(accountId: string): string {
  const tail = accountId.replace(/[^a-zA-Z0-9]/g, "").slice(-4).toUpperCase();
  return tail.length > 0 ? `Reader ${tail}` : "A reader";
}

// -- daily streak (pure) -----------------------------------------------------
// Panel-2 Wave 3 (retention). A per-account consecutive-day Daily-completion
// counter. The record is account-scoped (survives guest→account claim, which
// upgrades the account in place — same _id — so no data move is needed, R13.4).
// All date math is the pure `epochDayFromISO` above; the caller passes the
// completion's UTC day string, so this is deterministic + clock-free (BC6).

/**
 * Persisted streak state (the mutable fields of a `daily_streaks` row).
 *   current  — length of the current unbroken run (days).
 *   longest  — best run ever reached (never decreases).
 *   lastDate — yyyy-mm-dd of the most recent counted completion.
 */
export type StreakState = {
  current: number;
  longest: number;
  lastDate: string;
};

/** Result of folding one completion date into the prior streak state. */
export type StreakAdvance = {
  state: StreakState;
  /** false when `date` was already counted (idempotent no-op) or is stale. */
  changed: boolean;
  /** true when `current` moved up (a first day, or a fresh consecutive day). */
  incremented: boolean;
};

/** The empty/zero streak projection for a reader who has no record yet. */
export function emptyStreak(): StreakState {
  return { current: 0, longest: 0, lastDate: "" };
}

/**
 * Fold a Daily completion on `date` (yyyy-mm-dd) into the prior streak state.
 * Pure + total:
 *   - no prior            → current 1 (a fresh streak begins).
 *   - same day as last    → no-op (idempotent; the result insert is already
 *                            once-per-(account,daily), this is belt-and-braces).
 *   - exactly next day    → current + 1 (the run continues).
 *   - a gap of ≥2 days    → current resets to 1 (the run broke; today restarts).
 *   - a date BEFORE last  → no-op (defensive: out-of-order/backfilled results
 *                            never rewind a live streak).
 * `longest` is monotonic (max of prior longest and the new current).
 */
export function advanceDailyStreak(
  prev: StreakState | null | undefined,
  date: string,
): StreakAdvance {
  const day = date.trim();
  if (!prev || !prev.lastDate) {
    const state = { current: 1, longest: Math.max(1, prev?.longest ?? 0), lastDate: day };
    return { state, changed: true, incremented: true };
  }

  const diff = epochDayFromISO(day) - epochDayFromISO(prev.lastDate);
  if (diff <= 0) {
    // Same day (0) or an older/backfilled date (<0): leave the streak untouched.
    return { state: { ...prev }, changed: false, incremented: false };
  }

  const current = diff === 1 ? prev.current + 1 : 1;
  const state = {
    current,
    longest: Math.max(prev.longest, current),
    lastDate: day,
  };
  return { state, changed: true, incremented: true };
}
