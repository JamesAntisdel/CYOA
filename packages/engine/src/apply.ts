import { resolveDeath } from "./death";
import { popDueDelayedEffects, scheduleDelayedEffect } from "./delayed";
import { unlockCurrentEnding } from "./endings";
import { setFlag, unsetFlag } from "./flags";
import { addItem, removeItem } from "./inventory";
import { cloneState } from "./state";
import { applyStatDelta } from "./stats";
import { evaluateConditions } from "./visibility";
import type { Choice, Effect, EngineContext, EngineDiff, EngineEvent, EngineResult, PlayerState, Story } from "./types";

export function applyChoice(
  state: PlayerState,
  story: Story,
  choiceId: string,
  _ctx: EngineContext,
): EngineResult {
  const next = cloneState(state);
  const node = story.nodes[next.currentNodeId];
  if (!node) throw new Error(`node_not_found:${next.currentNodeId}`);

  const choice = node.choices.find((item) => item.id === choiceId);
  if (!choice) throw new Error(`choice_not_found:${choiceId}`);

  const evaluation = evaluateConditions(next, choice);
  if (evaluation.visibility !== "visible") throw new Error("choice_not_visible");

  const diffs: EngineDiff[] = [];
  const events: EngineEvent[] = [{ kind: "choice_applied", choiceId }];
  applyEffects(next, choice.effects ?? [], diffs);
  next.turnNumber += 1;
  next.currentNodeId = choice.targetNodeId;
  next.path.push(choice.targetNodeId);
  diffs.push({ kind: "node", target: choice.targetNodeId, delta: 1 });

  resolveDeath(next, story, diffs, events);
  return { state: next, diffs, events };
}

export function enterNode(
  state: PlayerState,
  story: Story,
  nodeId: string,
  _ctx: EngineContext,
): EngineResult {
  const next = cloneState(state);
  const node = story.nodes[nodeId];
  if (!node) throw new Error(`node_not_found:${nodeId}`);

  const diffs: EngineDiff[] = [];
  const events: EngineEvent[] = [{ kind: "node_entered", nodeId }];
  const dueEffects = popDueDelayedEffects(next, events);
  for (const scheduled of dueEffects) {
    applyEffects(next, scheduled.effects, diffs);
  }
  applyEffects(next, node.effectsOnEnter ?? [], diffs);

  resolveDeath(next, story, diffs, events);
  unlockCurrentEnding(next, story, diffs, events);
  return { state: next, diffs, events };
}

export function applyChoiceAndEnterNode(
  state: PlayerState,
  story: Story,
  choiceId: string,
  ctx: EngineContext,
): EngineResult {
  const applied = applyChoice(state, story, choiceId, ctx);
  const entered = enterNode(applied.state, story, applied.state.currentNodeId, ctx);
  return {
    state: entered.state,
    diffs: [...applied.diffs, ...entered.diffs],
    events: [...applied.events, ...entered.events],
  };
}

function applyEffects(state: PlayerState, effects: Effect[], diffs: EngineDiff[]): void {
  for (const effect of effects) {
    applyEffect(state, effect, diffs);
  }
}

function applyEffect(state: PlayerState, effect: Effect, diffs: EngineDiff[]): void {
  switch (effect.kind) {
    case "stat":
      applyStatDelta(state, effect.statId, effect.delta, diffs);
      return;
    case "currency": {
      const before = state.currency;
      state.currency = Math.max(0, before + effect.delta);
      diffs.push({
        kind: "currency",
        target: "currency",
        delta: effect.delta,
        before,
        after: state.currency,
      });
      return;
    }
    case "inventory_add":
      addItem(state, effect.item, diffs);
      return;
    case "inventory_remove":
      removeItem(state, effect.itemId, diffs);
      return;
    case "flag_set":
      setFlag(state, effect.flag, effect.value, diffs);
      return;
    case "flag_unset":
      unsetFlag(state, effect.flag, diffs);
      return;
    case "delayed":
      scheduleDelayedEffect(state, effect.delayNodes, effect.effects, diffs);
      return;
  }
}

export type { Choice };
