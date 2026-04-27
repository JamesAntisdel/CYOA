import type { EngineDiff, FlagMap, PlayerState } from "./types";

export function getFlag(state: PlayerState, flag: string): FlagMap[string] | undefined {
  return state.flags[flag];
}

export function hasFlag(state: PlayerState, flag: string): boolean {
  return state.flags[flag] !== undefined;
}

export function setFlag(
  state: PlayerState,
  flag: string,
  value: boolean | number | string,
  diffs: EngineDiff[],
): void {
  const before = state.flags[flag];
  state.flags[flag] = value;
  diffs.push({
    kind: "flag_set",
    target: flag,
    delta: value,
    ...(before === undefined ? {} : { before }),
    after: value,
  });
}

export function unsetFlag(state: PlayerState, flag: string, diffs: EngineDiff[]): void {
  const before = state.flags[flag];
  delete state.flags[flag];
  diffs.push({
    kind: "flag_unset",
    target: flag,
    delta: null,
    ...(before === undefined ? {} : { before }),
  });
}
