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

/**
 * Schedule a Chekhov thread (Requirement 3): a delayed effect that carries a
 * foreshadow `note`. Shares the delayed store with authored delayed effects
 * (NO parallel store — BC / design §1.1); the only additions are the `note`
 * field on the record and a `thread_set` diff (vs `delayed_scheduled`) so the
 * signed-echo surface can distinguish a thread being planted. `note` may be
 * null (the LLM omitted the foreshadow line) — the thread still schedules.
 */
export function scheduleThread(
  state: PlayerState,
  delayNodes: number,
  effects: Effect[],
  note: string | null,
  diffs: EngineDiff[],
): void {
  const id = `delayed_${state.turnNumber}_${state.delayed.length + 1}`;
  state.delayed.push({
    id,
    remainingNodes: delayNodes,
    effects,
    ...(note !== null ? { note } : {}),
  });
  diffs.push({ kind: "thread_set", target: id, note, visibility: "visible" });
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
