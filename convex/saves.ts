import {
  createInitialState,
  evaluateNodeChoices,
  llmSceneOutputSchema,
  migrateEngineState,
  resolveTerminal,
  type ChoiceEvaluation,
  type LlmSceneProposal,
  type NpcState,
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
  // Seed-flow inputs (creator: "Seed an adventure"). When the reader
  // authored a custom premise/title/tone, these override the starter
  // story's hardcoded seed text in the LLM scene pipeline.
  seedPremise?: string;
  seedTitle?: string;
  seedTone?: string;
  // Running "story so far" summary, maintained by `convex/llm/summarizer.ts`
  // after each successful turn. Capped at ~500 chars; surfaced to the next
  // scene prompt as canonical context so the LLM doesn't re-propose actions
  // the reader already took. Absent until the first turn completes.
  storySummary?: string;
  // Reference-image carry-over for scene illustrations. Asset ids of the
  // protagonist + setting anchor images generated on turn 1 of an
  // llm-driven save (see `convex/media/geminiImageClient.ts`). Subsequent
  // scene-image calls fetch the underlying storage bytes via
  // `convex/media/sceneMedia.ts:runImagenJob` and pass them as inline
  // references to Gemini Flash Image so character + setting stay
  // visually consistent across scenes.
  anchorProtagonistAssetId?: string;
  anchorSettingAssetId?: string;
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
  /**
   * NPC roster currently in player state. Empty `{}` when no NPCs have been
   * spawned. Surfaced to the reader's character sheet (NpcRoster). Mirrors
   * `PlayerState.npcs` (Requirement 31) — projecting it here is what powers
   * the FullSheet "Companions and Cast" section for remote LLM-driven saves.
   */
  npcs: Record<string, NpcState>;
  /**
   * Reader-authored title from the Seed-an-Adventure flow (Requirement 22.7).
   * When present, the reader UI prefers this over the engine `story.title`
   * so seeded saves show the user's title instead of "Open Canvas".
   * Optional — legacy starters and pre-seed-flow saves omit it.
   */
  seedTitle?: string;
  /**
   * True when the scene record carries the deterministic-fallback sentinel
   * (`scene.isFallback === true`). Surfaced on the projection so the reader
   * UI can render the FallbackTurnPanel ("the page is blank for a moment —
   * try again") instead of the deterministic placeholder prose + choices.
   * Absent on every real-provider scene; clients treat absent as `false`.
   */
  isFallback?: boolean;
  /**
   * Reader-visible story-arc summary (R1.5). Present on arc saves only; legacy
   * saves omit it and the client hides the QuestLine. Beat progress is COUNT
   * ONLY — pending beat labels and candidate endings are spoilers and NEVER
   * projected (BC10).
   */
  arc?: ProjectionArc;
  /**
   * Signed visible-tier changes from the just-completed turn (R5.1), already
   * redacted (hidden stats dropped) and label-resolved server-side. The client
   * echo renders these as signed chips. Absent on turns with no visible change
   * and on legacy pre-diff saves.
   */
  recentDiffs?: VisibleDiff[];
  terminal: ReturnType<typeof resolveTerminal>;
};

/**
 * Reader-visible arc summary (R1.5 wire shape, design §7). Beat progress is a
 * COUNT — never the pending beat labels or candidate endings (BC10).
 */
export type ProjectionArc = {
  dramaticQuestion: string;
  act: number;
  actLabel: string | null;
  beatsFired: number;
  beatsTotal: number;
  threadsPending: number;
  // clock?: { label: string; value: number; max: number };  // W2
};

/**
 * A single signed change surfaced to the reader's echo (design §7
 * `recentDiffs`). Redacted + label-resolved server-side; W2 adds `clock`,
 * `npc`, and `check` kinds.
 */
export type VisibleDiff =
  | { kind: "stat"; statId: string; label: string; delta: number }
  | { kind: "currency"; delta: number }
  | { kind: "item"; op: "add" | "remove"; label: string }
  | { kind: "thread"; op: "set" | "fired"; note: string | null }
  | { kind: "beat"; label: string }
  | { kind: "act"; act: number };

/** Max visible diffs surfaced per turn (design §2.3). */
export const MAX_VISIBLE_DIFFS_PER_TURN = 12;

/**
 * Structural, engine-version-tolerant view of an EngineDiff. The engine's
 * `EngineDiff` union is assignable to this; reading fields structurally lets
 * the redaction below tolerate diff kinds this file predates (W1-ENGINE adds
 * `thread_set` / `thread_fired` / `beat_fired` / `act_advanced` in parallel).
 */
type RawDiff = { kind: string } & Record<string, unknown>;

/** Structural view of `state.arc` (engine adds the typed `PlayerState.arc`). */
type ArcStateLike = {
  dramaticQuestion?: unknown;
  act?: unknown;
  actLabel?: unknown;
  beats?: Array<{ status?: unknown }>;
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
      // Defensive default: pre-migration saves snuck through before
      // `state.npcs` was always initialized would otherwise crash the
      // projection. Empty roster → UI suppresses the section.
      npcs: save.state.npcs ?? {},
      ...(save.seedTitle ? { seedTitle: save.seedTitle } : {}),
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
    npcs: save.state.npcs ?? {},
    ...(save.seedTitle ? { seedTitle: save.seedTitle } : {}),
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
 * Redact + translate engine diffs into the reader-visible `recentDiffs` wire
 * shape (R5.1, design §7). Hidden-tier changes are DROPPED (BC10): a diff is
 * hidden when it carries `visibility: "hidden"` or (for stat diffs) targets a
 * non-visible attribute. Labels are resolved from `state` at write time so the
 * persisted `turn_history.visibleDiffs` is already client-ready. Capped at
 * `MAX_VISIBLE_DIFFS_PER_TURN`. Unmappable kinds (flags/nodes/npc/W2) are
 * silently skipped — the union only grows additively.
 */
export function buildVisibleDiffs(
  diffs: ReadonlyArray<RawDiff>,
  state: PlayerState,
  cap: number = MAX_VISIBLE_DIFFS_PER_TURN,
): VisibleDiff[] {
  const out: VisibleDiff[] = [];
  for (const diff of diffs) {
    if (out.length >= cap) break;
    // Explicit hidden tag always wins (W1-ENGINE tags hidden-stat diffs).
    if (diff.visibility === "hidden") continue;
    const target = typeof diff.target === "string" ? diff.target : "";
    switch (diff.kind) {
      case "stat": {
        const attr = state.attributes[target];
        // Redact hidden stats: no explicit tag AND the attribute is not
        // visible → drop (the reader was never shown this stat).
        if (attr && attr.visibility !== "visible") continue;
        out.push({
          kind: "stat",
          statId: target,
          label: attr?.label ?? target,
          delta: typeof diff.delta === "number" ? diff.delta : 0,
        });
        break;
      }
      case "currency":
        out.push({
          kind: "currency",
          delta: typeof diff.delta === "number" ? diff.delta : 0,
        });
        break;
      case "inventory_add":
        out.push({
          kind: "item",
          op: "add",
          label: state.inventory.find((i) => i.id === target)?.label ?? target,
        });
        break;
      case "inventory_remove":
        // The item is already gone from state on a remove, so fall back to the
        // target id for the label (the echo shows "− <id>").
        out.push({ kind: "item", op: "remove", label: target });
        break;
      case "thread_set":
      case "delayed_scheduled":
        // A thread was planted — note is spoiler-adjacent, withheld until it
        // fires (design §7: note null until fired).
        out.push({ kind: "thread", op: "set", note: null });
        break;
      case "thread_fired":
        out.push({
          kind: "thread",
          op: "fired",
          note: typeof diff.note === "string" ? diff.note : null,
        });
        break;
      case "beat_fired":
        out.push({
          kind: "beat",
          label: typeof diff.label === "string" ? diff.label : target,
        });
        break;
      case "act_advanced":
        out.push({
          kind: "act",
          act: typeof diff.act === "number" ? diff.act : 0,
        });
        break;
      default:
        // flag_set/flag_unset (codex is W2), node, ending, npc_* → not a
        // W1 reader-visible echo. Skip.
        break;
    }
  }
  return out;
}

/**
 * Project `state.arc` down to the reader-visible arc summary (R1.5). Returns
 * null for legacy arc-less saves (the client hides the QuestLine). Beat
 * progress is a COUNT only — pending beat labels and candidate endings are
 * spoilers and are NOT included (BC10).
 */
export function projectArcSummary(state: PlayerState): ProjectionArc | null {
  const arc = (state as unknown as { arc?: ArcStateLike }).arc;
  if (!arc || typeof arc !== "object") return null;
  const question =
    typeof arc.dramaticQuestion === "string" ? arc.dramaticQuestion : "";
  if (question.length === 0) return null;
  const beats = Array.isArray(arc.beats) ? arc.beats : [];
  const beatsFired = beats.filter((b) => b?.status === "fired").length;
  // Threads pending = scheduled delayed effects not yet fired. Prefer a
  // dedicated `threads` array when the engine adds one; fall back to `delayed`.
  const threads = (state as unknown as { threads?: unknown[] }).threads;
  const threadsPending = Array.isArray(threads)
    ? threads.length
    : Array.isArray(state.delayed)
      ? state.delayed.length
      : 0;
  return {
    dramaticQuestion: question,
    act: typeof arc.act === "number" ? arc.act : 1,
    actLabel: typeof arc.actLabel === "string" ? arc.actLabel : null,
    beatsFired,
    beatsTotal: beats.length,
    threadsPending,
  };
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
  /**
   * Deterministic-fallback sentinel from the scene record. Forwarded
   * onto the projection so the reader UI can render the FallbackTurnPanel
   * instead of the deterministic placeholder prose + choices.
   */
  isFallback?: boolean;
  /**
   * Signed visible-tier changes from the just-completed turn, already redacted
   * + label-resolved (R5.1). Callers pass the freshly-built diffs (completion
   * path) or the persisted `turn_history.visibleDiffs` (read path). Omitted →
   * no echo this turn.
   */
  recentDiffs?: VisibleDiff[];
  /**
   * Per-choice visibility results (R4.3), precomputed by the caller via engine
   * `evaluateLlmSceneChoices` (which enforces the ≤1-locked / ≥2-visible scene
   * invariants). Passed in — rather than imported here — so `convex/saves.ts`
   * stays free of the engine value-imports W1-ENGINE builds in parallel.
   * Matched to choices by `choiceId`; a choice with no entry projects visible
   * (legacy behaviour / arc-less saves).
   */
  choiceVisibilities?: ReadonlyArray<{
    choiceId: string;
    visibility: "visible" | "locked";
    lockedHint?: string;
  }>;
}): SceneProjection {
  // The reader doesn't render effects on choices — they exist only for the
  // engine's per-turn validation. Strip them from the projection so the
  // ChoiceEvaluation shape matches the authored contract cleanly. Each choice's
  // visibility is recomputed server-side against current state (R4.3): a locked
  // choice carries its `lockedHint` and renders with the 🔒 affordance.
  const visibilityById = new Map(
    (input.choiceVisibilities ?? []).map((entry) => [entry.choiceId, entry]),
  );
  const choices: ChoiceEvaluation[] = (input.proposal?.choices ?? []).map((choice) => {
    const evaluated = visibilityById.get(choice.id);
    const visibility = evaluated?.visibility ?? "visible";
    return {
      choice: {
        id: choice.id,
        label: choice.label,
        // synthetic — there is no authored target node for an llm-driven
        // choice; the engine fabricates `<storyId>:llm:<turn>` next turn.
        targetNodeId: `${input.save.storyId}:llm:next`,
      },
      visibility,
      ...(evaluated?.lockedHint ? { lockedHint: evaluated.lockedHint } : {}),
    };
  });

  const arc = projectArcSummary(input.save.state);

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
    npcs: input.save.state.npcs ?? {},
    ...(input.save.seedTitle ? { seedTitle: input.save.seedTitle } : {}),
    // Surface the deterministic-fallback sentinel only when actually true —
    // omitting the key on real-provider scenes keeps the projection wire
    // shape stable for clients that don't yet read `isFallback`.
    ...(input.isFallback === true ? { isFallback: true } : {}),
    ...(arc ? { arc } : {}),
    ...(input.recentDiffs && input.recentDiffs.length > 0
      ? { recentDiffs: input.recentDiffs }
      : {}),
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
