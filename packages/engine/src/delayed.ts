import type { Effect, EngineDiff, EngineEvent, PlayerState, ScheduledEffect } from "./types";

export function scheduleDelayedEffect(
  state: PlayerState,
  delayNodes: number,
  effects: Effect[],
  diffs: EngineDiff[],
): void {
  const id = `delayed_${state.turnNumber}_${state.delayed.length + 1}`;
  state.delayed.push({ id, remainingNodes: delayNodes, effects });
  diffs.push({ kind: "delayed_scheduled", target: id, delta: delayNodes });
}

export function popDueDelayedEffects(
  state: PlayerState,
  events: EngineEvent[],
): ScheduledEffect[] {
  const due: ScheduledEffect[] = [];
  const pending: ScheduledEffect[] = [];

  for (const scheduled of state.delayed) {
    const next = { ...scheduled, remainingNodes: scheduled.remainingNodes - 1 };
    if (next.remainingNodes <= 0) {
      due.push(next);
      events.push({ kind: "delayed_fired", scheduledEffectId: next.id });
    } else {
      pending.push(next);
    }
  }

  state.delayed = pending;
  return due;
}
