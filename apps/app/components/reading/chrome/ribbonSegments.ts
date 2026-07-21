import { candleSegments } from "../../../lib/storyEngagement";

/**
 * Reader-chrome-declutter — the shared page-column cap (R7.1 / RC9). Every
 * ReaderScreen-owned chrome row (top bar, story ribbon, interstitials) centres
 * inside a single `maxWidth: PAGE_COLUMN_MAX` container instead of stretching
 * the raw viewport. 760 matches the widest layout (Book / Novel). This is the
 * ONE shared constant RC9 asks for — `ReaderTopBar` re-exports it so the
 * directory has a single source (`export { PAGE_COLUMN_MAX } from "./ribbonSegments"`).
 */
export const PAGE_COLUMN_MAX = 760;

/** Truncation budget for the collapsed pursuit phrase (R3.1 / U1 — "≈40ch"). */
export const PURSUIT_MAX = 40;

/**
 * Two-stage-candle second threshold (R3.4 / U4). The top-bar wick lights at
 * ≥50% burn (`showCandleMeter`, owned by ReaderScreen); the ribbon gains its
 * leading book-voice candle segment only once the candle is ≥80% burned.
 */
export const CANDLE_LOW_BURN = 0.8;

/** One collapsed ribbon segment — a stable key + its rendered label. */
export type RibbonSegment = { key: string; label: string };

/** Candle burn state, passed only under today's `showCandleMeter` rule. */
export type RibbonCandleInput = { turnsUsed: number; turnsAllowed: number };

/**
 * Pure input for {@link buildRibbonSegments}. Every field is a signal the
 * ribbon composes WITHOUT re-deriving a predicate or adding a query (RC2):
 *   - `pursuit`        — `arc.dramaticQuestion` (present ⇔ the save has an arc)
 *   - `threadsPending` — `arc.threadsPending`
 *   - `doorsCount`     — the DoorsJournal entry count (see StoryRibbon wiring note)
 *   - `pulseLine`      — the DailyPulseChip one-liner (see wiring note)
 *   - `candle`         — burn state, only when `showCandleMeter` is already true
 */
export type RibbonSegmentsInput = {
  pursuit?: string | undefined;
  threadsPending?: number | undefined;
  doorsCount?: number | undefined;
  pulseLine?: string | undefined;
  candle?: RibbonCandleInput | undefined;
};

/**
 * Truncate the pursuit phrase to `max` graphemes, appending a single ellipsis
 * character (plain punctuation — not an emoji, RC5) when it overflows. The
 * ellipsis eats one slot so the visible width never exceeds `max`.
 */
export function truncatePursuit(text: string, max: number = PURSUIT_MAX): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/**
 * buildRibbonSegments (design §1, R3.1/R3.4) — the PURE render model for the
 * collapsed StoryRibbon row. Ordering encodes the review deltas:
 *
 *   1. the ≥80%-burn candle segment LEADS when present (U4 two-stage candle),
 *   2. then the pursuit phrase (U1 — the reader's active goal is the
 *      load-bearing line, never demoted),
 *   3. then compact counts: threads · doors · daily-pulse.
 *
 * Each segment appears ONLY when its source signal exists today; when every
 * signal is absent the function returns `[]` and StoryRibbon renders nothing
 * (zero layout shift — RC2). No React, no I/O: matrix-testable.
 */
export function buildRibbonSegments(input: RibbonSegmentsInput): RibbonSegment[] {
  const segments: RibbonSegment[] = [];

  // (1) Two-stage candle — a LEADING book-voice segment at ≥80% burn (U4). The
  // turns-left copy mirrors the top-bar/detail meter's remaining count.
  if (input.candle) {
    const { turnsUsed, turnsAllowed } = input.candle;
    const model = candleSegments(turnsUsed, turnsAllowed);
    if (model.total > 0 && model.pct >= CANDLE_LOW_BURN) {
      const left = Math.max(0, turnsAllowed - turnsUsed);
      segments.push({
        key: "candle",
        label:
          left <= 1
            ? "the candle burns low — 1 turn left"
            : `the candle burns low — ${left} turns left`,
      });
    }
  }

  // (2) Pursuit phrase — leads the ordinary ribbon (U1), truncated to ≈40ch.
  const pursuit = input.pursuit?.trim();
  if (pursuit) {
    segments.push({ key: "pursuit", label: truncatePursuit(pursuit) });
  }

  // (3) Compact counts, each self-hiding at its own zero-state.
  const threads = input.threadsPending ?? 0;
  if (threads > 0) {
    segments.push({ key: "threads", label: `${threads} ${threads === 1 ? "thread" : "threads"}` });
  }

  const doors = input.doorsCount ?? 0;
  if (doors > 0) {
    segments.push({ key: "doors", label: `${doors} ${doors === 1 ? "door" : "doors"}` });
  }

  const pulse = input.pulseLine?.trim();
  if (pulse) {
    segments.push({ key: "pulse", label: pulse });
  }

  return segments;
}
