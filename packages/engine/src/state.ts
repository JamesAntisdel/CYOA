import type { Mode, PlayerState, Story } from "./types";

export const ENGINE_SCHEMA_VERSION = 1;

export function createInitialState(
  story: Story,
  mode: Mode,
  _now: number,
  _rngSeed: string,
): PlayerState {
  return {
    storyId: story.id,
    mode,
    vitality: story.initialState.vitality,
    currency: story.initialState.currency,
    attributes: cloneAttributes(story.initialState.attributes ?? {}),
    inventory: [...(story.initialState.inventory ?? [])],
    flags: { ...(story.initialState.flags ?? {}) },
    currentNodeId: story.startNodeId,
    turnNumber: 0,
    path: [story.startNodeId],
    delayed: [],
    endingsUnlocked: {},
    schemaVersion: ENGINE_SCHEMA_VERSION,
  };
}

export function cloneState(state: PlayerState): PlayerState {
  return {
    ...state,
    attributes: cloneAttributes(state.attributes),
    inventory: state.inventory.map((item) => ({ ...item })),
    flags: { ...state.flags },
    path: [...state.path],
    delayed: state.delayed.map((item) => ({
      ...item,
      effects: item.effects.map((effect) => ({ ...effect })),
    })),
    endingsUnlocked: Object.fromEntries(
      Object.entries(state.endingsUnlocked).map(([key, ending]) => [
        key,
        { ...ending, path: [...ending.path] },
      ]),
    ),
  };
}

function cloneAttributes(
  attributes: PlayerState["attributes"],
): PlayerState["attributes"] {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, attribute]) => [key, { ...attribute }]),
  );
}
