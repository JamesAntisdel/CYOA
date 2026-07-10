import { z } from "zod";

export const modeSchema = z.enum(["story", "hardcore"]);
export type Mode = z.infer<typeof modeSchema>;

export const choiceVisibilitySchema = z.enum(["visible", "locked", "hidden"]);
export type ChoiceVisibility = z.infer<typeof choiceVisibilitySchema>;

export type AttributeVisibility = "visible" | "hidden";

export type SceneLength = "brief" | "standard" | "rich" | "chapter";

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

// =============================================================================
// NPCs and Companions (Requirement 31)
// =============================================================================

export type NpcRole = "companion" | "ally" | "rival" | "neutral" | "antagonist";

/**
 * Flag map shape for NPCs. Narrower than `FlagMap` (no string values) because
 * the design pins NPC flags to `boolean | number` only — string flags on NPCs
 * are reserved for future iteration and would inflate the per-turn prompt
 * surface without a use case in v0.
 */
export type NpcFlagMap = Record<string, boolean | number>;

export type NpcInventoryItem = {
  id: string;
  label: string;
};

export type NpcState = {
  id: string;
  name: string;
  role: NpcRole;
  /**
   * One-line description (Requirement 8.1, W2). Optional — authored NPCs and
   * legacy rosters may omit it; `npc_spawn` LLM effects populate it (≤160).
   * Surfaced by the prompt builder's NPC sheet; never a spoiler.
   */
  description?: string;
  /** Integer in [-100, 100]; clamped by the engine on every disposition_delta. */
  disposition: number;
  /** Optional node-id-like location tag. When set, the prompt builder surfaces this NPC only in matching scenes. */
  location?: string;
  /** Same shape as player attributes. */
  attributes: Record<string, AttributeState>;
  /** Same shape as player inventory. Optional — many NPCs carry nothing. */
  inventory?: NpcInventoryItem[];
  /** Short tags the LLM is told the NPC knows. The prompt builder surfaces the top 3 per turn. */
  knownFacts: string[];
  /** Optional cross-NPC disposition map. relationships[otherNpcId] = delta to apply when they interact. */
  relationships?: Record<string, number>;
  /** Same shape as player flags, restricted to boolean | number. */
  flags: NpcFlagMap;
  /** Optional reference to a generated portrait asset (the image-gen agent populates this). */
  portraitAssetId?: string;
};

export const NPC_DISPOSITION_MIN = -100;
export const NPC_DISPOSITION_MAX = 100;
/** Max characters retained when an `npc_learn_fact` effect appends a fact. */
export const NPC_FACT_MAX_LENGTH = 200;

export type Effect =
  | { kind: "stat"; statId: string; delta: number }
  | { kind: "currency"; delta: number }
  | { kind: "inventory_add"; item: InventoryItem }
  | { kind: "inventory_remove"; itemId: string }
  | { kind: "flag_set"; flag: string; value: boolean | number | string }
  | { kind: "flag_unset"; flag: string }
  | { kind: "delayed"; delayNodes: number; effects: Effect[] }
  | { kind: "npc_spawn"; npc: NpcState }
  | { kind: "npc_despawn"; npcId: string }
  | { kind: "npc_relocate"; npcId: string; location?: string }
  | { kind: "npc_disposition_delta"; npcId: string; delta: number }
  | { kind: "npc_attribute_delta"; npcId: string; attributeId: string; delta: number }
  | { kind: "npc_inventory_add"; npcId: string; item: NpcInventoryItem }
  | { kind: "npc_inventory_remove"; npcId: string; itemId: string }
  | { kind: "npc_flag_set"; npcId: string; flag: string; value: boolean | number }
  | { kind: "npc_learn_fact"; npcId: string; fact: string }
  /**
   * Declarative skill check (Requirement 31.5). The engine evaluates the
   * effective total — including companion contributions when
   * `includeCompanions` is set — but does not directly mutate state. The
   * resolution is surfaced via `resolveSkillCheck` so callers (LLM prompt
   * builder, narrator) can react. Authoring this as an effect kind keeps the
   * check declarative and discoverable from a choice's `effects` array.
   */
  | { kind: "skill_check"; statId: string; difficulty: number; includeCompanions?: boolean };

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
  /**
   * NPC id that must be present in the current scene for the choice to be
   * visible (Requirement 31.4). "Present" means
   * `state.npcs[requiresNpc]?.location === state.currentNodeId`. When the
   * NPC is missing from the roster or located elsewhere, the visibility
   * evaluator hides the choice before any condition evaluation runs.
   */
  requiresNpc?: string;
  /**
   * NPC id the LLM is told the choice acts on (Requirement 31.4). Purely
   * presentational — the engine performs no validation against the roster
   * because the prompt builder may surface this hint even when the NPC is
   * off-scene (e.g. "Send word to <targetNpc>").
   */
  targetNpc?: string;
};

export type StoryNode = {
  id: string;
  title?: string;
  seed?: string;
  sceneLength?: SceneLength;
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
  defaultSceneLength?: SceneLength;
  startNodeId: string;
  deathNodeId?: string;
  initialState: PlayerStateSeed;
  nodes: Record<string, StoryNode>;
  endings: Record<string, EndingDefinition>;
  /**
   * Optional initial NPC roster (Requirement 31.7). Authored stories MAY
   * declare a starting cast that `createInitialState` merges into
   * `PlayerState.npcs`. Reader-typed open-premise seeds leave this undefined
   * and let the LLM introduce NPCs organically via subsequent `npc_spawn`
   * effects.
   */
  initialNpcs?: Record<string, NpcState>;
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
  /**
   * Chekhov-thread foreshadow line (Requirement 3). Optional — authored
   * delayed effects leave it undefined; LLM-scheduled threads carry the
   * one-line callback text so the client can surface "an earlier choice
   * echoes" when the thread fires. Spoiler-adjacent: the projection exposes
   * the note ONLY once the thread has fired (see BC10).
   */
  note?: string;
};

// =============================================================================
// Story Arc (Requirement 1) — the "spine" every llm-driven save is playing
// toward. All fields ride inside the opaque `saves.state` blob, so there is no
// convex schema change. Legacy saves lack `arc` entirely and branch to legacy
// behavior everywhere (BC9).
// =============================================================================

export type ArcBeatKind = "inciting" | "midpoint" | "dark_night" | "climax" | "custom";
export type ArcPriorityHint = "early" | "mid" | "late";
export type ArcBeatStatus = "pending" | "fired";

export type ArcBeat = {
  id: string;
  label: string;
  kind: ArcBeatKind;
  priorityHint: ArcPriorityHint;
  requiredBeforeEnding: boolean;
  status: ArcBeatStatus;
  firedAtTurn?: number;
};

export type CandidateEnding = {
  id: string;
  label: string;
  hint: string;
};

export type StoryArcSource = "llm" | "synthesized" | "daily";

export type StoryArc = {
  dramaticQuestion: string; // 8–160
  protagonistWant: string; // 8–120
  stakes: string; // 8–160
  act: 1 | 2 | 3;
  actLabel?: string; // generated on act advance
  beats: ArcBeat[]; // 3–5
  candidateEndings: CandidateEnding[]; // 2–4
  antagonistNpcId?: string; // W2
  clockLabel?: string; // W2
  source: StoryArcSource;
};

export type StoryClock = {
  label: string;
  value: number;
  max: number;
  expired: boolean;
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
  /**
   * Roster of named NPCs in this save (Requirement 31). Always present —
   * legacy snapshots that lack the field are upgraded by `migrateEngineState`
   * to `npcs: {}` so downstream code never has to defensive-default.
   */
  npcs: Record<string, NpcState>;
  /**
   * Story arc (Requirement 1). Optional — present only on llm-driven saves
   * created after story-engagement W1 shipped. Absent on legacy saves, which
   * keep playing under legacy terminal/gate behavior (BC9). Chekhov threads
   * ride inside `delayed` (each `ScheduledEffect.note`), NOT a parallel store.
   */
  arc?: StoryArc;
  /** Doom clock (Requirement 9, W2). Optional; legacy + arc-less saves omit it. */
  clock?: StoryClock;
  /**
   * Turn at which each string-valued `flag_set` last landed (Requirement 11,
   * W2 — the Codex). Optional + sparse: only string flags applied via the llm
   * path get an entry, written in `llm.ts` at flag-set time (the cheap
   * record-at-set-time choice from design §1.2 / tasks W2-E5, avoiding a
   * diff-replay). `deriveCodex` reads it to order/timestamp codex entries;
   * absent entries default to turn 0. Legacy saves omit it entirely (BC9).
   */
  flagSetTurns?: Record<string, number>;
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
  | { kind: "ending"; target: string; delta: 1 }
  | { kind: "npc_spawn"; target: string; delta: 1 }
  | { kind: "npc_despawn"; target: string; delta: -1 }
  | { kind: "npc_relocate"; target: string; delta: null; before?: string; after?: string }
  | { kind: "npc_disposition"; target: string; delta: number; before: number; after: number }
  | { kind: "npc_attribute"; target: string; attributeId: string; delta: number; before: number; after: number }
  | { kind: "npc_inventory_add"; target: string; itemId: string; delta: 1 }
  | { kind: "npc_inventory_remove"; target: string; itemId: string; delta: -1 }
  | { kind: "npc_flag_set"; target: string; flag: string; delta: boolean | number; before?: boolean | number; after: boolean | number }
  | { kind: "npc_learn_fact"; target: string; fact: string; delta: 1 }
  // -- Story-engagement W1 additions (Requirements 1, 3, 5). Each is an
  //    additive union member tagged with a projection `visibility` tier so the
  //    server's diff-persistence step can filter to the reader-visible set
  //    (BC10). Existing diff consumers switch on `kind` and ignore these.
  | { kind: "thread_set"; target: string; note: string | null; visibility: "visible" }
  | { kind: "thread_fired"; target: string; note: string | null; visibility: "visible" }
  | { kind: "beat_fired"; target: string; label: string; visibility: "visible" }
  | { kind: "act_advanced"; target: string; act: number; visibility: "visible" }
  // -- Story-engagement W2 additions (Requirements 7, 8, 9). Additive, all
  //    reader-visible tier. Existing consumers switch on `kind` and ignore
  //    these; the server's diff-persistence filters on `visibility`.
  | { kind: "clock_advanced"; target: "clock"; amount: number; reason: string | null; visibility: "visible" }
  | { kind: "clock_expired"; target: "clock"; visibility: "visible" }
  | { kind: "disposition_shift"; target: string; prevDisposition: number; delta: number; visibility: "visible" }
  | { kind: "fact_learned"; target: string; visibility: "visible" }
  | { kind: "check_resolved"; target: string; outcome: "success" | "partial" | "fail"; margin: number; visibility: "visible" };

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
