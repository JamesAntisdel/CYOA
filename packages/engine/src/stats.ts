import type { AttributeState, Effect, EngineDiff, NpcState, PlayerState } from "./types";

/**
 * Vitality is a fixed 0–10 stat (see llm.ts "bounds 0–10" and the scene
 * projection's HUD contract). Both bounds are enforced in applyStatDelta and
 * surfaced on the AttributeState so the HUD pip renderer knows the ceiling.
 */
export const VITALITY_MIN = 0;
export const VITALITY_MAX = 10;

export function getStat(state: PlayerState, statId: string): AttributeState | undefined {
  if (statId === "vitality") {
    return {
      id: "vitality",
      label: "Vitality",
      value: state.vitality,
      visibility: "visible",
      min: VITALITY_MIN,
      max: VITALITY_MAX,
    };
  }

  return state.attributes[statId];
}

export function applyStatDelta(
  state: PlayerState,
  statId: string,
  delta: number,
  diffs: EngineDiff[],
): void {
  if (statId === "vitality") {
    const before = state.vitality;
    state.vitality = clamp(before + delta, VITALITY_MIN, VITALITY_MAX);
    diffs.push({ kind: "stat", target: statId, delta, before, after: state.vitality });
    return;
  }

  const existing = state.attributes[statId] ?? {
    id: statId,
    label: statId,
    value: 0,
    visibility: "hidden" as const,
  };
  const before = existing.value;
  const after = clamp(before + delta, existing.min, existing.max);
  state.attributes[statId] = { ...existing, value: after };
  diffs.push({ kind: "stat", target: statId, delta, before, after });
}

function clamp(value: number, min?: number, max?: number): number {
  let next = value;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  return next;
}

// =============================================================================
// Faction reputation (Panel-2 Wave 3). A lightweight CONVENTION over the
// existing hidden-stat system — NO new engine state. A faction standing is an
// attribute keyed `rep:<factionId>`, held HIDDEN (never in the HUD) with a
// signed range so the reader can fall out of favor as well as climb. The bible
// `factions` section names the ids + in-world standingHints; the scene prompt
// tells the model to shift a standing with a plain `stat` effect on `rep:<id>`
// and to gate/color choices with `stat_at_least`/`stat_at_most` on `rep:<id>` —
// so the whole faction-gating UX rides the EXISTING near-miss / humanized-hint
// path (phrase-only, BC10) for free.
//
// The generic llm-path `ensureLlmStatAttribute` would register a first-seen
// `rep:*` stat VISIBLE with 0..5 bounds — which both leaks the standing into
// the HUD and clips the negative half. `ensureFactionRepAttributes`
// pre-registers the correct hidden/signed bounds BEFORE the delta applies, and
// `normalizeFactionReps` is the after-the-fact safety net (covers reps first
// seen via a fired thread). Both are pure-ish (mutate state), idempotent, and
// emit no diff — a visibility/bounds correction is not a reader-facing change.
// =============================================================================

/** Attribute-id prefix marking a hidden faction-standing stat. */
export const FACTION_REP_PREFIX = "rep:";
/** Signed standing range: −10 (sworn enemy) … +10 (sworn ally); 0 = neutral. */
export const FACTION_REP_MIN = -10;
export const FACTION_REP_MAX = 10;

/** True when `statId` is a `rep:<factionId>` faction-standing stat (non-empty id). */
export function isFactionRepStat(statId: string): boolean {
  return (
    statId.startsWith(FACTION_REP_PREFIX) && statId.length > FACTION_REP_PREFIX.length
  );
}

/** The `rep:<factionId>` attribute id for a bible faction id. */
export function factionRepStatId(factionId: string): string {
  return `${FACTION_REP_PREFIX}${factionId}`;
}

/**
 * Pre-register any `rep:*` faction stat referenced by this turn's `stat`
 * effects as a HIDDEN attribute with the signed faction bounds, so the delta
 * that follows clamps into [−10, 10] (not the generic 0..5) and never surfaces
 * in the HUD. Accepts a loose effect shape so both engine `Effect`s and parsed
 * llm effects fit. No-op for already-registered stats.
 */
export function ensureFactionRepAttributes(
  state: PlayerState,
  effects: ReadonlyArray<{ kind: string; statId?: string }>,
): void {
  for (const effect of effects) {
    if (effect.kind !== "stat" || typeof effect.statId !== "string") continue;
    if (!isFactionRepStat(effect.statId)) continue;
    if (state.attributes[effect.statId]) continue;
    state.attributes[effect.statId] = {
      id: effect.statId,
      label: humanizeFactionRepLabel(effect.statId),
      value: 0,
      visibility: "hidden",
      min: FACTION_REP_MIN,
      max: FACTION_REP_MAX,
    };
  }
}

/**
 * Re-flag every `rep:*` attribute as hidden with the signed faction bounds and
 * re-clamp its value into range — the safety net for reps first created by the
 * generic stat path (VISIBLE 0..5) before `ensureFactionRepAttributes` ran
 * (e.g. a thread-fired rep delta). Idempotent; only rewrites attributes that
 * are actually out of spec.
 */
export function normalizeFactionReps(state: PlayerState): void {
  for (const [id, attribute] of Object.entries(state.attributes)) {
    if (!isFactionRepStat(id)) continue;
    const outOfSpec =
      attribute.visibility !== "hidden" ||
      attribute.min !== FACTION_REP_MIN ||
      attribute.max !== FACTION_REP_MAX;
    if (!outOfSpec) continue;
    state.attributes[id] = {
      ...attribute,
      visibility: "hidden",
      min: FACTION_REP_MIN,
      max: FACTION_REP_MAX,
      value: clamp(attribute.value, FACTION_REP_MIN, FACTION_REP_MAX),
    };
  }
}

function humanizeFactionRepLabel(statId: string): string {
  const raw = statId.slice(FACTION_REP_PREFIX.length).replace(/[_-]+/g, " ").trim();
  if (raw.length === 0) return statId;
  return raw
    .split(/\s+/u)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// =============================================================================
// skill_check resolution (Requirement 31.5).
//
// `skill_check` is a declarative effect — it does not mutate state directly.
// The engine computes an effective total and outcome here so callers (prompt
// builder, UI, narrator) can react. When `includeCompanions: true` is set,
// the totals from every NPC with `role === "companion"` and a
// `visibility === "visible"` attribute matching `statId` are added to the
// player's own value. Hidden companion attributes are intentionally skipped
// so the reader never gets credit for stats their party doesn't surface.
// =============================================================================

export type SkillCheckBreakdown = {
  statId: string;
  difficulty: number;
  playerValue: number;
  companionContributions: Array<{ npcId: string; value: number }>;
  total: number;
  margin: number;
  passed: boolean;
  includeCompanions: boolean;
};

export function resolveSkillCheck(
  state: PlayerState,
  input: { statId: string; difficulty: number; includeCompanions?: boolean },
): SkillCheckBreakdown {
  const includeCompanions = input.includeCompanions === true;
  const playerValue = getStat(state, input.statId)?.value ?? 0;

  const companionContributions: Array<{ npcId: string; value: number }> = [];
  if (includeCompanions && state.npcs) {
    for (const npc of Object.values(state.npcs)) {
      // Two additive layers per companion: a VISIBLE matching attribute (the
      // original W2 path) plus a bond-derived bonus from the disposition band
      // (BC10). Either alone qualifies; a companion the reader has won over
      // lends weight even with no surfaced stat — the common case in LLM-driven
      // runs, where spawned companions carry `attributes: {}`.
      const attribute = companionVisibleStat(npc, input.statId) ?? 0;
      const bond = companionBondBonus(npc);
      const value = attribute + bond;
      if (value <= 0) continue;
      companionContributions.push({ npcId: npc.id, value });
    }
  }

  const total =
    playerValue + companionContributions.reduce((sum, entry) => sum + entry.value, 0);
  const margin = total - input.difficulty;

  return {
    statId: input.statId,
    difficulty: input.difficulty,
    playerValue,
    companionContributions,
    total,
    margin,
    passed: total >= input.difficulty,
    includeCompanions,
  };
}

function companionVisibleStat(npc: NpcState, statId: string): number | undefined {
  if (npc.role !== "companion") return undefined;
  const attribute = npc.attributes[statId];
  if (!attribute) return undefined;
  if (attribute.visibility !== "visible") return undefined;
  return attribute.value;
}

/**
 * Disposition band → additive check bonus (BC10 — phrase, never number). A
 * companion the reader has genuinely won over lends weight to a check purely
 * from their disposition, reusing `mapDispositionToVibe`'s bands: +1 at ≥50
 * (the "friendly" band), +2 at ≥90. Only role `companion` contributes; a
 * wary/neutral companion adds nothing, and non-companion roles are ignored.
 *
 * This is the sink the disposition scalar previously lacked — the LLM already
 * moves it ±15/turn but nothing mechanical ever happened at a threshold. The
 * reader sees WHO stands with them (`deriveCheckCompanionPhrase`), never this
 * number. Deterministic + total: a non-finite disposition scores 0.
 */
export const COMPANION_BOND_BONUS_THRESHOLD = 50;
export const COMPANION_BOND_STRONG_THRESHOLD = 90;

function companionBondBonus(npc: NpcState): number {
  if (npc.role !== "companion") return 0;
  const disposition = npc.disposition;
  if (typeof disposition !== "number" || !Number.isFinite(disposition)) return 0;
  if (disposition >= COMPANION_BOND_STRONG_THRESHOLD) return 2;
  if (disposition >= COMPANION_BOND_BONUS_THRESHOLD) return 1;
  return 0;
}

// =============================================================================
// Choice skill checks with visible risk (Requirement 7, W2). The LLM attaches
// an optional `skillCheck` to a choice; the engine resolves it deterministically
// at submission (BEFORE the next scene is generated) so the model narrates a
// result it cannot overrule. This is the pure resolver + the fixed outcome
// table (design §5 + §2.5). Diff/effect application happens in the server;
// this returns the pieces it applies.
// =============================================================================

/** Difficulty word on a checked choice (mirrors the llm.ts schema enum). */
export type ChoiceCheckDifficulty = "easy" | "risky" | "desperate";

/**
 * The engine-facing shape of an llm `skillCheck` (structurally compatible with
 * the zod-parsed proposal). Declared here (not imported from `llm.ts`) to keep
 * the module graph acyclic — `llm.ts` imports this resolver, not vice versa.
 */
export type ChoiceSkillCheck = {
  statId: string;
  difficulty: ChoiceCheckDifficulty;
  successNote?: string;
  failNote?: string;
};

export type ChoiceCheckOutcome = "success" | "partial" | "fail";
export type ChoiceCheckOdds = "likely" | "even" | "risky" | "desperate";

export type ChoiceCheckBreakdown = {
  statId: string;
  difficulty: ChoiceCheckDifficulty;
  /** Numeric target for the difficulty (easy 4 / risky 6 / desperate 8). */
  threshold: number;
  playerValue: number;
  companionBonus: number;
  itemBonus: number;
  /** stat + companionBonus + itemBonus (pre-roll). */
  score: number;
  /** Seeded 0..5 (design §5). */
  roll: number;
  /** score + roll. */
  total: number;
  /** total − threshold. */
  margin: number;
};

export type ChoiceCheckResult = {
  outcome: ChoiceCheckOutcome;
  /** The checked stat (mirrors `breakdown.statId`; surfaced for the server). */
  statId: string;
  margin: number;
  breakdown: ChoiceCheckBreakdown;
  /**
   * Engine-authored cost/boon effects for the outcome (design §2.5). Applied
   * by the server immediately at submission — NOT the choice's own effects.
   */
  engineEffects: Effect[];
  /**
   * Clock advance the outcome imposes (0 | 1 | 2). Separate from `engineEffects`
   * because the clock is not part of the `Effect` union; the server applies it
   * via `applyClockAdvance`. Only ever > 0 when the save has a clock.
   */
  clockAdvance: number;
  /**
   * Whether the CHOICE's own llm effects should be applied this turn. True only
   * on success (Requirement 7.3): the server threads this into
   * `applyLlmSceneToState({ applyChoiceEffects })`.
   */
  applyChoiceEffects: boolean;
  /** Ready-to-persist diff for the reader-visible echo/banner. */
  diff: EngineDiff;
};

/** @deprecated Prefer {@link ChoiceCheckResult}. Kept for one migration cycle. */
export type ChoiceCheckResolution = ChoiceCheckResult;

/** Difficulty → numeric threshold (design §5). */
const CHECK_THRESHOLD: Record<ChoiceCheckDifficulty, number> = {
  easy: 4,
  risky: 6,
  desperate: 8,
};

/**
 * Shift a check one band harder (Requirement 15.1, W3 hardcore): easy → risky →
 * desperate; desperate stays. Pure + total. Hardcore saves route every check
 * through this before resolving (via `resolveChoiceCheck({ hardcore: true })`),
 * so the reader faces stiffer thresholds without the choice author changing.
 */
export function bumpDifficulty(difficulty: ChoiceCheckDifficulty): ChoiceCheckDifficulty {
  if (difficulty === "easy") return "risky";
  if (difficulty === "risky") return "desperate";
  return "desperate";
}

/**
 * Apply the hardcore difficulty bump to a check when `hardcore` is set, else
 * return the check unchanged (default = current behavior, backward-compatible).
 */
function withHardcore(
  check: ChoiceSkillCheck,
  opts?: { hardcore?: boolean },
): ChoiceSkillCheck {
  if (opts?.hardcore !== true) return check;
  return { ...check, difficulty: bumpDifficulty(check.difficulty) };
}

/** Fail-cost knobs (design §2.5). */
const FAIL_VITALITY_COST = 1;
const FAIL_CURRENCY_COST = 10;
const FAIL_CLOCK_COST = 2;
const PARTIAL_CLOCK_COST = 1;
const PARTIAL_VITALITY_COST = 1;

/**
 * Resolve a checked choice (Requirement 7.2–7.3, design §5). Pure + seeded:
 * `score = stat + companionBonus + itemBonus`, `roll = seededRand(0..5)`,
 * `total = score + roll`; success when `total ≥ threshold`, partial when
 * `total ≥ threshold − 2`, else fail. Fail cost is afford-aware in the fixed
 * order vitality → currency → clock (design §2.5). Deterministic for a given
 * (state, check, rngSeed) so replay reproduces the outcome exactly.
 */
export function resolveChoiceCheck(
  state: PlayerState,
  rawCheck: ChoiceSkillCheck,
  rngSeed: string,
  opts?: { hardcore?: boolean },
): ChoiceCheckResult {
  const check = withHardcore(rawCheck, opts);
  const threshold = CHECK_THRESHOLD[check.difficulty];
  const base = resolveSkillCheck(state, {
    statId: check.statId,
    difficulty: threshold,
    includeCompanions: true,
  });
  const playerValue = base.playerValue;
  const companionBonus = base.companionContributions.reduce((sum, c) => sum + c.value, 0);
  const itemBonus = checkItemBonus(state, check);
  const score = playerValue + companionBonus + itemBonus;
  const roll = seededRoll(`${rngSeed}:${check.statId}:${check.difficulty}`);
  const total = score + roll;
  const margin = total - threshold;

  const outcome: ChoiceCheckOutcome =
    total >= threshold ? "success" : total >= threshold - 2 ? "partial" : "fail";

  const { engineEffects, clockAdvance } = outcomeCost(state, outcome);

  const breakdown: ChoiceCheckBreakdown = {
    statId: check.statId,
    difficulty: check.difficulty,
    threshold,
    playerValue,
    companionBonus,
    itemBonus,
    score,
    roll,
    total,
    margin,
  };

  return {
    outcome,
    statId: check.statId,
    margin,
    breakdown,
    engineEffects,
    clockAdvance,
    applyChoiceEffects: outcome === "success",
    diff: {
      kind: "check_resolved",
      target: check.statId,
      outcome,
      margin,
      visibility: "visible",
    },
  };
}

/**
 * The pre-roll odds phrase for the choice card (design §5, Requirement 7.4).
 * The client receives this phrase, never the math (BC10). Base band from the
 * effective score (0–1 desperate / 2 risky / 3 even / ≥4 likely), shifted one
 * band by difficulty (easy easier, desperate harder).
 */
export function choiceCheckOdds(
  state: PlayerState,
  rawCheck: ChoiceSkillCheck,
  opts?: { hardcore?: boolean },
): ChoiceCheckOdds {
  const check = withHardcore(rawCheck, opts);
  const base = resolveSkillCheck(state, {
    statId: check.statId,
    difficulty: CHECK_THRESHOLD[check.difficulty],
    includeCompanions: true,
  });
  const companionBonus = base.companionContributions.reduce((sum, c) => sum + c.value, 0);
  const score = base.playerValue + companionBonus + checkItemBonus(state, check);

  // Ladder, worst → best.
  const ladder: ChoiceCheckOdds[] = ["desperate", "risky", "even", "likely"];
  const baseIndex = score <= 1 ? 0 : score === 2 ? 1 : score === 3 ? 2 : 3;
  const shift = check.difficulty === "easy" ? 1 : check.difficulty === "desperate" ? -1 : 0;
  const index = Math.min(ladder.length - 1, Math.max(0, baseIndex + shift));
  return ladder[index] ?? "even";
}

/**
 * +1 when a carried item plausibly applies to the check (Requirement 10.3):
 * an inventory item whose id/label token-matches the check's statId or its
 * note text. Deliberately dumb + deterministic — a token overlap, nothing
 * semantic. Capped at +1 regardless of how many items match.
 */
function checkItemBonus(state: PlayerState, check: ChoiceSkillCheck): number {
  const needle = new Set<string>([
    ...tokenize(check.statId),
    ...tokenize(check.successNote ?? ""),
    ...tokenize(check.failNote ?? ""),
  ]);
  if (needle.size === 0) return 0;
  for (const item of state.inventory) {
    const haystack = [...tokenize(item.id), ...tokenize(item.label)];
    if (haystack.some((token) => needle.has(token))) return 1;
  }
  return 0;
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

/**
 * The fixed outcome cost table (design §2.5). success → nothing extra (the
 * boon is that the choice's own effects fully apply). partial → clock +1 when
 * the save has a clock, else −1 vitality. fail → afford-aware cost in order
 * vitality (−1, if it wouldn't kill) → currency (−10, if affordable) → clock
 * (+2). Returns engine-authored effects + a clock advance amount.
 */
function outcomeCost(
  state: PlayerState,
  outcome: ChoiceCheckOutcome,
): { engineEffects: Effect[]; clockAdvance: number } {
  if (outcome === "success") return { engineEffects: [], clockAdvance: 0 };

  if (outcome === "partial") {
    if (state.clock) return { engineEffects: [], clockAdvance: PARTIAL_CLOCK_COST };
    // A partial is a middling, non-failing result — it must never be lethal.
    // Afford-guard the vitality tax the same way the fail path does, and drop
    // it entirely when the reader can't absorb it (they keep the choice's own
    // effects; a partial simply costs nothing rather than killing).
    if (state.vitality > PARTIAL_VITALITY_COST) {
      return {
        engineEffects: [{ kind: "stat", statId: "vitality", delta: -PARTIAL_VITALITY_COST }],
        clockAdvance: 0,
      };
    }
    return { engineEffects: [], clockAdvance: 0 };
  }

  // fail — afford order: vitality → currency → clock.
  if (state.vitality > FAIL_VITALITY_COST) {
    return {
      engineEffects: [{ kind: "stat", statId: "vitality", delta: -FAIL_VITALITY_COST }],
      clockAdvance: 0,
    };
  }
  if (state.currency >= FAIL_CURRENCY_COST) {
    return {
      engineEffects: [{ kind: "currency", delta: -FAIL_CURRENCY_COST }],
      clockAdvance: 0,
    };
  }
  return { engineEffects: [], clockAdvance: FAIL_CLOCK_COST };
}

/**
 * Deterministic 0..5 roll from a seed string (design §5 `seededRand(0..5)`).
 * FNV-1a over the seed → mod 6. Pure + dependency-free so a per-turn seed
 * always reproduces the same roll (seeded-replay guarantee).
 */
function seededRoll(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    // FNV prime 16777619 via shifts, kept in 32-bit unsigned range.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 6;
}
