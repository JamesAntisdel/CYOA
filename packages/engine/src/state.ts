import type { Mode, NpcState, PlayerState, Story, StoryArc } from "./types";

/**
 * Bumped to 2 alongside Requirement 31 (NPCs and Companions). The migration
 * step in `migrateEngineState` upgrades v1 snapshots that lack the new
 * `npcs` field by inserting an empty record, leaving every other field
 * untouched.
 */
export const ENGINE_SCHEMA_VERSION = 2;

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
    npcs: cloneNpcRoster(story.initialNpcs ?? {}),
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
    npcs: cloneNpcRoster(state.npcs),
    // Optional story-arc fields (Requirement 1). Deep-clone so mutations on the
    // returned state never leak back to the previous turn's snapshot. Absent on
    // legacy saves — the conditional spread keeps them absent (BC4/BC9).
    ...(state.arc !== undefined ? { arc: cloneArc(state.arc) } : {}),
    ...(state.clock !== undefined ? { clock: { ...state.clock } } : {}),
    // itemsEverGranted ledger (story-bible R4.1): optional, copied so appends
    // on the new turn never leak into the previous snapshot. Legacy saves
    // omit it — the conditional spread keeps it absent (BC4/BC9).
    ...(state.itemsEverGranted !== undefined
      ? { itemsEverGranted: [...state.itemsEverGranted] }
      : {}),
  };
}

function cloneArc(arc: StoryArc): StoryArc {
  return {
    ...arc,
    beats: arc.beats.map((beat) => ({ ...beat })),
    candidateEndings: arc.candidateEndings.map((candidate) => ({ ...candidate })),
  };
}

function cloneAttributes(
  attributes: PlayerState["attributes"],
): PlayerState["attributes"] {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, attribute]) => [key, { ...attribute }]),
  );
}

/**
 * Deep-clones an NPC roster. Each NPC's nested attributes, inventory,
 * knownFacts, relationships, and flags are copied so mutations on the
 * returned roster never leak back to the source state (the engine relies on
 * `cloneState` -> apply -> swap semantics; aliasing the optional collections
 * here would silently mutate the previous turn's snapshot).
 */
export function cloneNpcRoster(
  roster: Record<string, NpcState>,
): Record<string, NpcState> {
  return Object.fromEntries(
    Object.entries(roster).map(([id, npc]) => [id, cloneNpc(npc)]),
  );
}

export function cloneNpc(npc: NpcState): NpcState {
  return {
    ...npc,
    ...(npc.location !== undefined ? { location: npc.location } : {}),
    attributes: Object.fromEntries(
      Object.entries(npc.attributes).map(([key, attribute]) => [key, { ...attribute }]),
    ),
    ...(npc.inventory !== undefined ? { inventory: npc.inventory.map((item) => ({ ...item })) } : {}),
    knownFacts: [...npc.knownFacts],
    ...(npc.relationships !== undefined ? { relationships: { ...npc.relationships } } : {}),
    flags: { ...npc.flags },
    ...(npc.portraitAssetId !== undefined ? { portraitAssetId: npc.portraitAssetId } : {}),
  };
}
