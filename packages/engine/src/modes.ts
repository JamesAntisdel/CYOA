import type { Mode, PlayerState } from "./types";

export function canSwitchMode(state: PlayerState, targetMode: Mode): boolean {
  if (state.mode === targetMode) return true;
  if (targetMode === "story") return true;
  return state.turnNumber === 0;
}

export function switchMode(state: PlayerState, targetMode: Mode): PlayerState {
  if (!canSwitchMode(state, targetMode)) {
    throw new Error("mode_switch_not_allowed");
  }
  return { ...state, mode: targetMode };
}

export function shouldPurgeOnDeath(state: PlayerState): boolean {
  return state.mode === "hardcore" && state.vitality <= 0;
}
