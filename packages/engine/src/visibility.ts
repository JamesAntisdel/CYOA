import { getFlag } from "./flags";
import { hasItem } from "./inventory";
import { getStat } from "./stats";
import type { Choice, ChoiceEvaluation, Condition, PlayerState } from "./types";

export function evaluateConditions(state: PlayerState, choice: Choice): ChoiceEvaluation {
  const configuredVisibility = choice.visibility ?? "visible";
  if (configuredVisibility === "hidden") {
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
