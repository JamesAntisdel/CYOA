import {
  createInitialState,
  evaluateNodeChoices,
  migrateEngineState,
  resolveTerminal,
  type ChoiceEvaluation,
  type PlayerState,
  type Story,
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
  inventoryCount: number;
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
  if (!node) throw new AppError("node_not_found", save.currentNodeId);
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
    visibleStats: Object.values(save.state.attributes)
      .filter((stat) => stat.visibility === "visible")
      .map((stat) => ({ statId: stat.id, label: stat.label, value: stat.value })),
    inventoryCount: save.state.inventory.length,
    terminal: resolveTerminal(save.state, story),
  };
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
