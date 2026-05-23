import {
  createInitialState,
  evaluateNodeChoices,
  llmSceneOutputSchema,
  migrateEngineState,
  resolveTerminal,
  type ChoiceEvaluation,
  type LlmSceneProposal,
  type PlayerState,
  type Story,
  type TerminalResult,
} from "@cyoa/engine";

import { AppError } from "./lib/errors";

export type SaveRecord = {
  _id?: string;
  accountId: string;
  storyId: string;
  mode: "story" | "hardcore";
  status: "active" | "dead" | "ended" | "ended_safely";
  engineVersion: number;
  storyVersion: number;
  state: PlayerState;
  currentNodeId: string;
  currentSceneId?: string;
  turnNumber: number;
  activeTurnRequestId?: string;
  // Narrator voice id pinned to this save (see apps/app/hooks/useNarratorVoice.ts).
  // Drives Google Cloud TTS voice selection in convex/media/sceneMedia.ts.
  // Optional for backwards compatibility with saves created before narration.
  voiceId?: string;
  createdAt: number;
  updatedAt: number;
};

export type SceneProjection = {
  saveId?: string;
  storyId: string;
  nodeId: string;
  turnNumber: number;
  prose: string;
  streamStatus: "pending" | "streaming" | "complete" | "failed" | "blocked";
  choices: ChoiceEvaluation[];
  visibleStats: Array<{ statId: string; label: string; value: number }>;
  /**
   * Top-level vitality value pulled off `state.vitality`. The HUD reads this
   * directly rather than searching `visibleStats` so vitality survives the
   * "no attributes were declared visible" case (every llm-driven stub) and
   * keeps its 0–10 bound — vitality is not clamped to the 5-pip ceiling that
   * the visible attribute stats use.
   */
  vitality: number;
  inventoryCount: number;
  /**
   * Full inventory items (id + label). Bug fix: previously only
   * `inventoryCount` was sent, so the client fabricated dummy labels and
   * the LLM-proposed item names (e.g. "Black ledger") never reached the HUD.
   * The description is intentionally omitted from the projection — it's only
   * useful inside the LLM prompt's player-state summary.
   */
  inventory: Array<{ id: string; label: string }>;
  terminal: ReturnType<typeof resolveTerminal>;
};

export type SaveMigrationPlan = {
  migrated: boolean;
  save: SaveRecord;
};

export function createSaveRecord(input: {
  accountId: string;
  story: Story;
  mode: "story" | "hardcore";
  now: number;
  rngSeed: string;
}): SaveRecord {
  const state = createInitialState(input.story, input.mode, input.now, input.rngSeed);
  return {
    accountId: input.accountId,
    storyId: input.story.id,
    mode: input.mode,
    status: "active",
    engineVersion: state.schemaVersion,
    storyVersion: input.story.version,
    state,
    currentNodeId: state.currentNodeId,
    turnNumber: state.turnNumber,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function migrateSaveIfNeeded(save: SaveRecord): SaveMigrationPlan {
  const migration = migrateEngineState(save.state);
  if (!migration.migrated) return { migrated: false, save };
  return {
    migrated: true,
    save: {
      ...save,
      state: migration.state,
      engineVersion: migration.state.schemaVersion,
    },
  };
}

export function projectCurrentScene(save: SaveRecord, story: Story): SceneProjection {
  assertStoryMatchesSave(save, story);
  const node = story.nodes[save.currentNodeId];
  if (!node) {
    // LLM-driven scenes have synthetic node ids (`<storyId>:llm:<turn>`) that
    // do not exist in the authored graph. Return a stable shell projection so
    // callers can still read save metadata; the actual prose/choices come
    // from the persisted SceneRecord via projectSceneRecord.
    return {
      ...(save._id === undefined ? {} : { saveId: save._id }),
      storyId: save.storyId,
      nodeId: save.currentNodeId,
      turnNumber: save.turnNumber,
      prose: "",
      streamStatus: "pending",
      choices: [],
      visibleStats: visibleStatsFromState(save.state),
      vitality: save.state.vitality,
      inventoryCount: save.state.inventory.length,
      inventory: inventoryFromState(save.state),
      terminal: null,
    };
  }
  return {
    ...(save._id === undefined ? {} : { saveId: save._id }),
    storyId: save.storyId,
    nodeId: save.currentNodeId,
    turnNumber: save.turnNumber,
    prose: node.seed ?? "",
    streamStatus: node.endingId ? "complete" : "pending",
    choices: evaluateNodeChoices(save.state, node.choices).filter(
      (choice) => choice.visibility !== "hidden",
    ),
    visibleStats: visibleStatsFromState(save.state),
    vitality: save.state.vitality,
    inventoryCount: save.state.inventory.length,
    inventory: inventoryFromState(save.state),
    terminal: resolveTerminal(save.state, story),
  };
}

function visibleStatsFromState(state: PlayerState): SceneProjection["visibleStats"] {
  return Object.values(state.attributes)
    .filter((stat) => stat.visibility === "visible")
    .map((stat) => ({ statId: stat.id, label: stat.label, value: stat.value }));
}

function inventoryFromState(state: PlayerState): SceneProjection["inventory"] {
  return state.inventory.map((item) => ({ id: item.id, label: item.label }));
}

/**
 * Project an LLM-driven scene record (with its persisted proposal) onto the
 * SceneProjection shape that the reader and HTTP layer consume. The engine
 * has already validated the proposal — we only translate it into the
 * authored-shape `ChoiceEvaluation[]` so the client doesn't need a parallel
 * render path for llm-driven choices.
 */
export function projectLlmDrivenScene(input: {
  save: SaveRecord;
  proposal: LlmSceneProposal | null;
  prose: string;
  streamStatus: SceneProjection["streamStatus"];
  terminal?: TerminalResult | null;
}): SceneProjection {
  // The reader doesn't render effects on choices — they exist only for the
  // engine's per-turn validation. Strip them from the projection so the
  // ChoiceEvaluation shape matches the authored contract cleanly.
  const choices: ChoiceEvaluation[] = (input.proposal?.choices ?? []).map((choice) => ({
    choice: {
      id: choice.id,
      label: choice.label,
      // synthetic — there is no authored target node for an llm-driven choice;
      // the engine fabricates `<storyId>:llm:<turn>` on the next turn instead.
      targetNodeId: `${input.save.storyId}:llm:next`,
    },
    visibility: "visible" as const,
  }));

  return {
    ...(input.save._id === undefined ? {} : { saveId: input.save._id }),
    storyId: input.save.storyId,
    nodeId: input.save.currentNodeId,
    turnNumber: input.save.turnNumber,
    prose: input.prose,
    streamStatus: input.streamStatus,
    choices,
    visibleStats: visibleStatsFromState(input.save.state),
    vitality: input.save.state.vitality,
    inventoryCount: input.save.state.inventory.length,
    inventory: inventoryFromState(input.save.state),
    terminal: input.terminal ?? null,
  };
}

/**
 * Coerce a persisted proposal payload back into a typed proposal. Returns
 * null when the persisted value is missing or no longer schema-valid.
 */
export function readPersistedProposal(value: unknown): LlmSceneProposal | null {
  if (!value || typeof value !== "object") return null;
  const parsed = llmSceneOutputSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function applySaveState(save: SaveRecord, state: PlayerState, now: number): SaveRecord {
  const terminalStatus = state.vitality <= 0 ? "dead" : save.status;
  return {
    ...save,
    state,
    status: terminalStatus,
    engineVersion: state.schemaVersion,
    currentNodeId: state.currentNodeId,
    turnNumber: state.turnNumber,
    updatedAt: now,
  };
}

export function assertCanAccessSave(accountId: string, save: SaveRecord): void {
  if (save.accountId !== accountId) {
    throw new AppError("save_forbidden");
  }
}

function assertStoryMatchesSave(save: SaveRecord, story: Story): void {
  if (save.storyId !== story.id) {
    throw new AppError("story_mismatch");
  }
}
