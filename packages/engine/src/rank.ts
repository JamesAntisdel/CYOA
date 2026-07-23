// =============================================================================
// Librarian Rank (Requirement 12.3, W3). Pure — no `console`, no Date.now/
// Math.random (BC6). A display-only progression title derived from three
// lifetime account metrics: endings unlocked, arc beats fired, and tales
// published. `librarianRank` returns the HIGHEST tier whose thresholds are ALL
// met (never throws; negative / non-finite inputs floor to 0).
// =============================================================================

export type LibrarianTier =
  | "novice"
  | "keeper"
  | "archivist"
  | "librarian"
  | "unwritten";

export type LibrarianRank = {
  tier: LibrarianTier;
  /** Human-facing display name for the tier. */
  label: string;
  /** The metrics the rank was computed from (echoed for the profile UI). */
  endings: number;
  beats: number;
  tales: number;
};

type TierSpec = {
  tier: LibrarianTier;
  label: string;
  minEndings: number;
  minBeats: number;
  minTales: number;
};

// Ordered LOW → HIGH. `librarianRank` walks this HIGH → LOW and returns the
// first tier whose thresholds are all met, so the ordering here is the single
// source of truth for the progression (design §8 / R12.3).
const TIERS: readonly TierSpec[] = [
  { tier: "novice", label: "Novice", minEndings: 0, minBeats: 0, minTales: 0 },
  { tier: "keeper", label: "Keeper", minEndings: 3, minBeats: 0, minTales: 0 },
  { tier: "archivist", label: "Archivist", minEndings: 8, minBeats: 10, minTales: 0 },
  { tier: "librarian", label: "Librarian", minEndings: 15, minBeats: 0, minTales: 3 },
  { tier: "unwritten", label: "The Unwritten", minEndings: 30, minBeats: 10, minTales: 10 },
];

function floorMetric(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const int = Math.trunc(value);
  return int < 0 ? 0 : int;
}

/**
 * Compute the account's Librarian Rank (Requirement 12.3). Returns the highest
 * tier whose endings/beats/tales thresholds are ALL satisfied. `novice` (the
 * zero-threshold floor) is always a valid fallback, so this never returns
 * undefined. Inputs are floored to non-negative integers first.
 */
export function librarianRank(input: {
  endings: number;
  beats: number;
  tales: number;
}): LibrarianRank {
  const endings = floorMetric(input.endings);
  const beats = floorMetric(input.beats);
  const tales = floorMetric(input.tales);

  let matched: TierSpec = TIERS[0]!;
  for (const spec of TIERS) {
    if (endings >= spec.minEndings && beats >= spec.minBeats && tales >= spec.minTales) {
      matched = spec;
    }
  }

  return { tier: matched.tier, label: matched.label, endings, beats, tales };
}

/** The reader's distance to the NEXT tier of the Librarian ladder (R3.1). */
export type RankProgress = {
  /** The tier immediately ABOVE the current one in `TIERS` order. */
  nextTier: LibrarianTier;
  /** Human-facing display name for that next tier. */
  nextLabel: string;
  /** Zero-floored deficits against the next tier's OWN thresholds. */
  needsEndings: number;
  needsBeats: number;
  needsTales: number;
};

/**
 * Distance from a `LibrarianRank` to the NEXT tier above it in `TIERS` order
 * (R3.1). Deficits are computed against that next tier's own thresholds and
 * zero-floored, so a metric already at or above its next-tier requirement lists
 * nothing (the ladder is intentionally non-monotonic per metric — e.g. the jump
 * to `librarian` needs tales rather than more beats). Returns `null` at the top
 * tier ("The Unwritten"), where there is no next rung. Pure and total: the
 * rank's echoed metrics are re-floored via `floorMetric`, and an unrecognized
 * tier is treated as the floor, so this never throws.
 */
export function rankProgress(rank: LibrarianRank): RankProgress | null {
  let currentIndex = TIERS.findIndex((spec) => spec.tier === rank.tier);
  if (currentIndex < 0) currentIndex = 0;

  const next = TIERS[currentIndex + 1];
  if (!next) return null;

  const endings = floorMetric(rank.endings);
  const beats = floorMetric(rank.beats);
  const tales = floorMetric(rank.tales);

  return {
    nextTier: next.tier,
    nextLabel: next.label,
    needsEndings: Math.max(0, next.minEndings - endings),
    needsBeats: Math.max(0, next.minBeats - beats),
    needsTales: Math.max(0, next.minTales - tales),
  };
}
