import { getFlag } from "./flags";
import { hasItem } from "./inventory";
import { getStat } from "./stats";
import type { Choice, ChoiceEvaluation, Condition, PlayerState } from "./types";

export function evaluateConditions(state: PlayerState, choice: Choice): ChoiceEvaluation {
  const configuredVisibility = choice.visibility ?? "visible";
  if (configuredVisibility === "hidden") {
    return { choice, visibility: "hidden" };
  }

  // Requirement 31.4: `requiresNpc` gates the choice on whether the named NPC
  // is co-located with the player in the current scene. Evaluated BEFORE the
  // condition loop because a missing NPC short-circuits the choice to
  // `hidden` (not `locked`) — locked-with-hint is for state-resource gating
  // ("not enough resolve"); requiresNpc is for narrative presence and should
  // disappear from the UI entirely when the NPC isn't around.
  if (choice.requiresNpc !== undefined && !isNpcInCurrentScene(state, choice.requiresNpc)) {
    return { choice, visibility: "hidden" };
  }

  for (const condition of choice.conditions ?? []) {
    if (!conditionPasses(state, condition)) {
      const lockedHint = conditionHint(condition) ?? defaultHint(condition);
      return {
        choice,
        visibility: "locked",
        ...(lockedHint === undefined ? {} : { lockedHint }),
      };
    }
  }

  return { choice, visibility: "visible" };
}

function isNpcInCurrentScene(state: PlayerState, npcId: string): boolean {
  // Defensive against legacy/in-flight saves: a v1 snapshot that hasn't been
  // round-tripped through `migrateEngineState` will lack `npcs` entirely.
  // Treat the roster as empty rather than crashing on undefined.
  const roster = state.npcs;
  if (!roster) return false;
  const npc = roster[npcId];
  if (!npc) return false;
  return npc.location !== undefined && npc.location === state.currentNodeId;
}

function conditionHint(condition: Condition): string | undefined {
  return "hint" in condition ? condition.hint : undefined;
}

export function evaluateNodeChoices(state: PlayerState, choices: Choice[]): ChoiceEvaluation[] {
  return choices.map((choice) => evaluateConditions(state, choice));
}

function conditionPasses(state: PlayerState, condition: Condition): boolean {
  switch (condition.kind) {
    case "always":
      return true;
    case "stat_at_least":
      return (getStat(state, condition.statId)?.value ?? 0) >= condition.value;
    case "stat_at_most":
      return (getStat(state, condition.statId)?.value ?? 0) <= condition.value;
    case "has_item":
      return hasItem(state, condition.itemId);
    case "missing_item":
      return !hasItem(state, condition.itemId);
    case "flag_equals":
      return getFlag(state, condition.flag) === condition.value;
    case "mode_is":
      return state.mode === condition.mode;
  }
}

function defaultHint(condition: Condition): string | undefined {
  switch (condition.kind) {
    case "has_item":
      return `Needs ${condition.itemId}`;
    case "missing_item":
      return `Requires missing ${condition.itemId}`;
    case "stat_at_least":
    case "stat_at_most":
      return "You do not have the resolve";
    case "flag_equals":
    case "mode_is":
    case "always":
      return undefined;
  }
}
