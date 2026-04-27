import type { AttributeState, EngineDiff, PlayerState } from "./types";

export function getStat(state: PlayerState, statId: string): AttributeState | undefined {
  if (statId === "vitality") {
    return {
      id: "vitality",
      label: "Vitality",
      value: state.vitality,
      visibility: "visible",
      min: 0,
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
    state.vitality = clamp(before + delta, 0);
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
