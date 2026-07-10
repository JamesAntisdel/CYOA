import type { AttributeState, EngineDiff, NpcState, PlayerState } from "./types";

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
      const contribution = companionVisibleStat(npc, input.statId);
      if (contribution === undefined) continue;
      companionContributions.push({ npcId: npc.id, value: contribution });
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
