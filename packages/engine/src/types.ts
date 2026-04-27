import { z } from "zod";

export const modeSchema = z.enum(["story", "hardcore"]);
export type Mode = z.infer<typeof modeSchema>;

export const choiceVisibilitySchema = z.enum(["visible", "locked", "hidden"]);
export type ChoiceVisibility = z.infer<typeof choiceVisibilitySchema>;

export type AttributeVisibility = "visible" | "hidden";

export type AttributeState = {
  id: string;
  label: string;
  value: number;
  visibility: AttributeVisibility;
  min?: number;
  max?: number;
};

export type InventoryItem = {
  id: string;
  label: string;
  description?: string;
};

export type FlagMap = Record<string, boolean | number | string>;

export type Effect =
  | { kind: "stat"; statId: string; delta: number }
  | { kind: "currency"; delta: number }
  | { kind: "inventory_add"; item: InventoryItem }
  | { kind: "inventory_remove"; itemId: string }
  | { kind: "flag_set"; flag: string; value: boolean | number | string }
  | { kind: "flag_unset"; flag: string }
  | { kind: "delayed"; delayNodes: number; effects: Effect[] };

export type Condition =
  | { kind: "always" }
  | { kind: "stat_at_least"; statId: string; value: number; hint?: string }
  | { kind: "stat_at_most"; statId: string; value: number; hint?: string }
  | { kind: "has_item"; itemId: string; hint?: string }
  | { kind: "missing_item"; itemId: string; hint?: string }
  | { kind: "flag_equals"; flag: string; value: boolean | number | string; hint?: string }
  | { kind: "mode_is"; mode: Mode; hint?: string };

export type Choice = {
  id: string;
  label: string;
  targetNodeId: string;
  visibility?: "visible" | "locked" | "hidden";
  conditions?: Condition[];
  effects?: Effect[];
};

export type StoryNode = {
  id: string;
  title?: string;
  seed?: string;
  choices: Choice[];
  effectsOnEnter?: Effect[];
  endingId?: string;
  isDeath?: boolean;
};

export type EndingDefinition = {
  id: string;
  label: string;
  kind: "success" | "death" | "safe" | "other";
};

export type Story = {
  id: string;
  version: number;
  title: string;
  startNodeId: string;
  deathNodeId?: string;
  initialState: PlayerStateSeed;
  nodes: Record<string, StoryNode>;
  endings: Record<string, EndingDefinition>;
};

export type PlayerStateSeed = {
  vitality: number;
  currency: number;
  attributes?: Record<string, AttributeState>;
  inventory?: InventoryItem[];
  flags?: FlagMap;
};

export type ScheduledEffect = {
  id: string;
  remainingNodes: number;
  effects: Effect[];
};

export type UnlockedEnding = {
  storyId: string;
  endingId: string;
  firstSeenTurn: number;
  mode: Mode;
  path: string[];
};

export type PlayerState = {
  storyId: string;
  mode: Mode;
  vitality: number;
  currency: number;
  attributes: Record<string, AttributeState>;
  inventory: InventoryItem[];
  flags: FlagMap;
  currentNodeId: string;
  turnNumber: number;
  path: string[];
  delayed: ScheduledEffect[];
  endingsUnlocked: Record<string, UnlockedEnding>;
  schemaVersion: number;
};

export type EngineContext = {
  now: number;
  rngSeed: string;
};

export type EngineDiff =
  | { kind: "stat"; target: string; delta: number; before: number; after: number }
  | { kind: "currency"; target: "currency"; delta: number; before: number; after: number }
  | { kind: "inventory_add"; target: string; delta: 1 }
  | { kind: "inventory_remove"; target: string; delta: -1 }
  | { kind: "flag_set"; target: string; delta: boolean | number | string | null; before?: boolean | number | string; after?: boolean | number | string }
  | { kind: "flag_unset"; target: string; delta: null; before?: boolean | number | string }
  | { kind: "delayed_scheduled"; target: string; delta: number }
  | { kind: "node"; target: string; delta: 1 }
  | { kind: "ending"; target: string; delta: 1 };

export type EngineEvent =
  | { kind: "choice_applied"; choiceId: string }
  | { kind: "node_entered"; nodeId: string }
  | { kind: "death_triggered"; nodeId: string }
  | { kind: "ending_unlocked"; endingId: string }
  | { kind: "delayed_fired"; scheduledEffectId: string };

export type EngineResult = {
  state: PlayerState;
  diffs: EngineDiff[];
  events: EngineEvent[];
};

export type ChoiceEvaluation = {
  choice: Choice;
  visibility: ChoiceVisibility;
  lockedHint?: string;
};

export type TerminalResult = {
  endingId: string;
  kind: EndingDefinition["kind"];
};
