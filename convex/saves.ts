import {
  choiceCheckOdds,
  createInitialState,
  deriveCodex,
  evaluateNodeChoices,
  llmSceneOutputSchema,
  migrateEngineState,
  resolveSkillCheck,
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
  // story-engagement W3: the Daily Tale this save plays (R13.2) and the
  // keepsake id carried in from a prior ending (R12.2). Both optional.
  dailyId?: string;
  keepsakeCarried?: string;
  // reading-modes R4 (novel mode): the content axis this save was created
  // under. OPTIONAL and resolved at `createSave` (posture A) — absent reads
  // back as "branching", so every legacy save keeps today's exact path
  // (RM4). Mirrors the reserved `saves.readingMode` schema field.
  readingMode?: "branching" | "novel";
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
  choices: ProjectedChoice[];
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
  inventory: Array<{ id: string; label: string; tags?: string[] }>;
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
  /**
   * Reader-visible Codex (R11.1 / W2-S6): string-valued `flag_set` effects are
   * durable world-truths the tome recorded. Newest-first, cap 40, derived
   * server-side via engine `deriveCodex`. Boolean / numeric flags stay hidden
   * mechanics. Absent on legacy saves + turns with no string flags.
   */
  codex?: CodexEntry[];
  /**
   * Post-terminal replay bait (R14 / design §7). On an arc save that has
   * REACHED a terminal, 1–2 UNREACHED candidate endings (label + hint only) for
   * the What-Might-Have-Been cards. POST-TERMINAL ONLY — absent while the save
   * is still live (BC10: candidate endings are spoilers pre-terminal). Legacy /
   * arc-less saves omit it entirely.
   */
  ending?: { whatMightHaveBeen: Array<{ label: string; hint: string }> };
  /**
   * The Daily Tale this save plays (daily-killcam R3.3). A reader-KNOWN fact —
   * they tapped the Daily card — so it is spoiler-neutral under BC10 and drives
   * the client's killcam surfaces (DailyPulseChip / OpeningForks). Present on
   * Daily saves only; legacy / non-daily projections omit it (BC9,
   * conditional-spread per BC4).
   */
  dailyId?: string;
  /**
   * reading-modes R4 (novel mode) — present ONLY on a novel save so a Novel
   * layout can render the single "Turn the page" affordance instead of the
   * branching choice row. A reader-KNOWN fact (they chose novel at create),
   * so spoiler-neutral under BC10. Emitted via conditional spread; absent on
   * every branching / legacy projection so those stay byte-identical (BC9/BC4).
   */
  readingMode?: "novel";
  terminal: ReturnType<typeof resolveTerminal>;
};

/**
 * Skill-check summary rendered on a choice card BEFORE the reader picks
 * (R7.4). The `odds` phrase is precomputed server-side — the client NEVER sees
 * the raw roll math (BC10). `difficulty` is the LLM-authored band; `label` is
 * the resolved stat label.
 */
export type ProjectionCheck = {
  statId: string;
  label: string;
  difficulty: "easy" | "risky" | "desperate";
  odds: "likely" | "even" | "risky" | "desperate";
  /**
   * Companion-support PHRASE ("Mira stands with you") when visible companion
   * attributes would add to this check — the same contributions
   * `resolveChoiceCheck` folds into its breakdown. Words only, never the bonus
   * number (BC10). Absent when no companion helps (legacy shape unchanged).
   */
  companion?: string;
};

/**
 * A projected choice: the engine's `ChoiceEvaluation` (choice + visibility +
 * lockedHint) plus the optional W2 skill-check summary. `check` is present only
 * on choices the LLM gated behind a `skillCheck`; mutually exclusive with a
 * locked state (R7.5). `nearness` is the near-miss BAND on a locked numeric
 * gate — a phrase, never the value/threshold (BC10, same discipline as the
 * check odds phrase).
 */
export type ProjectedChoice = ChoiceEvaluation & {
  check?: ProjectionCheck;
  nearness?: "near" | "far";
};

/** One Codex row (design §7). `turnNumber` is when the truth was recorded. */
export type CodexEntry = { flag: string; text: string; turnNumber: number };

/**
 * Reader-visible arc summary (R1.5 wire shape, design §7). Beat progress is a
 * COUNT — never the pending beat labels or candidate endings (BC10). The W1
 * polish adds the reader's OWN quest fields (`protagonistWant`, `stakes`) and
 * the already-fired beat list (`firedBeats`) — these are NOT spoilers (the
 * reader lived them). W2 adds the doom clock.
 */
export type ProjectionArc = {
  dramaticQuestion: string;
  protagonistWant: string;
  stakes: string;
  act: number;
  actLabel: string | null;
  beatsFired: number;
  beatsTotal: number;
  /** Labels + turns of beats already fired (reader lived them — safe). */
  firedBeats: Array<{ label: string; turnNumber: number }>;
  threadsPending: number;
  /** Doom clock (R9.4 / W2-S6). Absent until the arc seeds one. */
  clock?: { label: string; value: number; max: number };
};

/**
 * A single signed change surfaced to the reader's echo (design §7
 * `recentDiffs`). Redacted + label-resolved server-side. W2 adds `clock`,
 * `npc`, and `check` kinds.
 */
export type VisibleDiff =
  | { kind: "stat"; statId: string; label: string; delta: number }
  | { kind: "currency"; delta: number }
  | { kind: "item"; op: "add" | "remove"; label: string }
  | { kind: "thread"; op: "set" | "fired"; note: string | null }
  | { kind: "beat"; label: string }
  | { kind: "act"; act: number }
  | { kind: "clock"; amount: number; reason: string | null }
  | { kind: "npc"; npcId: string; name: string; deltaBand?: "up" | "down"; fact: string | null }
  | { kind: "check"; outcome: "success" | "partial" | "fail"; statId: string; margin: number };

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
  protagonistWant?: unknown;
  stakes?: unknown;
  act?: unknown;
  actLabel?: unknown;
  beats?: Array<{ label?: unknown; status?: unknown; firedAtTurn?: unknown }>;
};

/** Structural view of `state.clock` (engine adds the typed `PlayerState.clock`). */
type ClockStateLike = {
  label?: unknown;
  value?: unknown;
  max?: unknown;
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
  return state.inventory.map((item) => ({
    id: item.id,
    label: item.label,
    // Surface keepsake/provenance tags so the reader's inventory can badge a
    // carried keepsake (story-engagement W3). Omitted when the item has none.
    ...(item.tags && item.tags.length > 0 ? { tags: item.tags } : {}),
  }));
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
      case "clock_advanced":
        // The `reason` was already run through evaluateTextPolicy upstream
        // (game.ts) before it reached the persisted diff — safe to surface.
        out.push({
          kind: "clock",
          amount: typeof diff.amount === "number" ? diff.amount : 1,
          reason: typeof diff.reason === "string" ? diff.reason : null,
        });
        break;
      case "disposition_shift": {
        const npc = state.npcs?.[target];
        const delta = typeof diff.delta === "number" ? diff.delta : 0;
        out.push({
          kind: "npc",
          npcId: target,
          name: npc?.name ?? target,
          deltaBand: delta >= 0 ? "up" : "down",
          fact: null,
        });
        break;
      }
      case "fact_learned": {
        const npc = state.npcs?.[target];
        // The engine's `fact_learned` diff carries no fact text; pull the
        // just-appended fact off the NPC's knownFacts (FIFO cap) so the echo
        // reads "Mira will remember <fact>". Not a spoiler — it's about the
        // reader's own actions.
        const lastFact =
          npc && Array.isArray(npc.knownFacts) && npc.knownFacts.length > 0
            ? npc.knownFacts[npc.knownFacts.length - 1] ?? null
            : null;
        out.push({
          kind: "npc",
          npcId: target,
          name: npc?.name ?? target,
          fact: lastFact,
        });
        break;
      }
      case "check_resolved":
        out.push({
          kind: "check",
          outcome:
            diff.outcome === "success" || diff.outcome === "partial" || diff.outcome === "fail"
              ? diff.outcome
              : "partial",
          statId: target,
          margin: typeof diff.margin === "number" ? diff.margin : 0,
        });
        break;
      default:
        // flag_set/flag_unset (surfaced via the Codex, not the echo), node,
        // ending, raw npc_* → not a reader-visible echo. Skip.
        break;
    }
  }
  return out;
}

/**
 * True when a turn produced a state mutation but NONE of it was reader-visible
 * (W1 polish B / R5.2). The caller persists an empty `recentDiffs: []` sentinel
 * on such turns so the client's "something shifted…" echo fires; turns whose
 * only diff is bookkeeping (node advance, ending unlock, choice applied)
 * return false so the echo stays silent. Called only when `buildVisibleDiffs`
 * returned empty.
 */
const ECHO_BOOKKEEPING_KINDS = new Set([
  "node",
  "ending",
  "choice_applied",
  "delayed_scheduled",
]);
export function hasHiddenStateShift(
  diffs: ReadonlyArray<RawDiff>,
): boolean {
  return diffs.some(
    (diff) =>
      typeof diff.kind === "string" && !ECHO_BOOKKEEPING_KINDS.has(diff.kind),
  );
}

/**
 * Precompute the odds phrase for a choice's skill check (design §2.5 / §5,
 * BC10 — the client gets the PHRASE, never the roll math). Delegates to the
 * engine's `choiceCheckOdds` so the card's odds stay consistent with the actual
 * resolution bands. Tolerant: a shape the engine rejects falls back to "risky".
 */
export function deriveCheckOdds(
  state: PlayerState,
  check: { statId: string; difficulty: "easy" | "risky" | "desperate" },
): ProjectionCheck["odds"] {
  try {
    return choiceCheckOdds(state, check);
  } catch {
    return "risky";
  }
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
  // W1 polish A: the reader's OWN fired beats (label + turn) — NOT a spoiler,
  // they are milestones the reader lived through. Pending beat labels are still
  // withheld (BC10).
  const firedBeats = beats
    .filter((b) => b?.status === "fired")
    .map((b) => ({
      label: typeof b?.label === "string" ? b.label : "",
      turnNumber: typeof b?.firedAtTurn === "number" ? b.firedAtTurn : 0,
    }))
    .filter((b) => b.label.length > 0);
  // Threads pending = scheduled delayed effects not yet fired. Prefer a
  // dedicated `threads` array when the engine adds one; fall back to `delayed`.
  const threads = (state as unknown as { threads?: unknown[] }).threads;
  const threadsPending = Array.isArray(threads)
    ? threads.length
    : Array.isArray(state.delayed)
      ? state.delayed.length
      : 0;
  // W2-S6: the doom clock, when the arc has seeded one. Value/max only —
  // `expired` is an internal flag the prompt reacts to, not a reader field.
  const clockLike = (state as unknown as { clock?: ClockStateLike }).clock;
  const clock =
    clockLike && typeof clockLike === "object" && typeof clockLike.label === "string"
      ? {
          label: clockLike.label,
          value: typeof clockLike.value === "number" ? clockLike.value : 0,
          max: typeof clockLike.max === "number" ? clockLike.max : 0,
        }
      : undefined;
  return {
    dramaticQuestion: question,
    protagonistWant: typeof arc.protagonistWant === "string" ? arc.protagonistWant : "",
    stakes: typeof arc.stakes === "string" ? arc.stakes : "",
    act: typeof arc.act === "number" ? arc.act : 1,
    actLabel: typeof arc.actLabel === "string" ? arc.actLabel : null,
    beatsFired,
    beatsTotal: beats.length,
    firedBeats,
    threadsPending,
    ...(clock ? { clock } : {}),
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
    /** Engine near-miss band on a locked numeric gate (optional — legacy callers omit it). */
    nearness?: "near" | "far";
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
  const choices: ProjectedChoice[] = (input.proposal?.choices ?? []).map((choice) => {
    const evaluated = visibilityById.get(choice.id);
    const visibility = evaluated?.visibility ?? "visible";
    // W2-S6: surface the skill-check summary on the card. Read the field
    // defensively so this projection stays green whether or not W2-ENGINE's
    // `skillCheck` schema addition has landed yet. Locked choices never carry a
    // check (R7.5 mutual exclusivity); we still attach it when present — the
    // engine already dropped the check when conditions won.
    const rawCheck = (choice as { skillCheck?: RawSkillCheck }).skillCheck;
    const check = projectChoiceCheck(rawCheck, input.save.state);
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
      // Near-miss band (BC10): the PHRASE only — value/threshold never leave
      // the server (see the `deriveCheckOdds` odds-phrase precedent). Gated on
      // `locked` because the engine's scene invariants can flip a result back
      // to visible (unlock) without scrubbing a stale band.
      ...(visibility === "locked" && evaluated?.nearness
        ? { nearness: evaluated.nearness }
        : {}),
      ...(check ? { check } : {}),
    };
  });

  const arc = projectArcSummary(input.save.state);
  // W2-S6: the Codex — string-valued flags as recorded world-truths (R11.1).
  const codex = projectCodex(input.save.state);

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
    ...(codex.length > 0 ? { codex } : {}),
    // W1 polish B (R5.2): emit `recentDiffs` whenever the caller passes an
    // array — INCLUDING an empty one. An empty array is the "something
    // shifted…" sentinel for a hidden-only turn; `undefined` (not passed, or a
    // legacy turn with no diff record) omits the field entirely.
    ...(input.recentDiffs !== undefined ? { recentDiffs: input.recentDiffs } : {}),
    // R14 (W3): post-terminal What-Might-Have-Been. Empty pre-terminal (BC10),
    // so the key is only emitted once the save has actually ended.
    ...(() => {
      const whatMightHaveBeen = projectWhatMightHaveBeen(input.save.state, input.terminal ?? null);
      return whatMightHaveBeen.length > 0 ? { ending: { whatMightHaveBeen } } : {};
    })(),
    // daily-killcam R3.3: forward the reader-known Daily id so the client can
    // mount the killcam surfaces. Conditional-spread (BC4) — absent on every
    // non-daily save so legacy projections stay byte-identical (BC9).
    ...(input.save.dailyId ? { dailyId: input.save.dailyId } : {}),
    // reading-modes R4 (novel mode): carry the reader-known content axis so the
    // Novel layout renders the "Turn the page" affordance. Conditional-spread
    // (BC4) — present ONLY for a novel save so branching / legacy projections
    // stay byte-identical (BC9). BC10-clean: the reader chose novel at create.
    ...(input.save.readingMode === "novel" ? { readingMode: "novel" as const } : {}),
    terminal: input.terminal ?? null,
  };
}

/** Structural view of `state.arc.candidateEndings` (engine adds the typed arc). */
type CandidateEndingLike = { id?: unknown; label?: unknown; hint?: unknown };

/**
 * Derive the post-terminal What-Might-Have-Been cards (R14 / design §7): 1–2
 * UNREACHED candidate endings (label + hint only) from the save's arc, MINUS
 * the ending actually reached. POST-TERMINAL ONLY — returns `[]` when `terminal`
 * is null (the save is still live), so candidate endings never leak
 * pre-terminal (BC10). Also `[]` for arc-less / legacy saves.
 */
export function projectWhatMightHaveBeen(
  state: PlayerState,
  terminal: TerminalResult | null,
): Array<{ label: string; hint: string }> {
  if (!terminal) return [];
  const candidates = (state as { arc?: { candidateEndings?: unknown } }).arc?.candidateEndings;
  if (!Array.isArray(candidates)) return [];
  const reached = terminal.endingId;
  const unreached: Array<{ label: string; hint: string }> = [];
  for (const raw of candidates as CandidateEndingLike[]) {
    if (unreached.length >= 2) break;
    if (!raw || typeof raw !== "object") continue;
    const id = typeof raw.id === "string" ? raw.id : "";
    const label = typeof raw.label === "string" ? raw.label : "";
    if (label.length === 0) continue;
    // Skip the ending the reader actually reached (terminal.endingId is already
    // normalized to a candidate id by the engine gate).
    if (id.length > 0 && id === reached) continue;
    unreached.push({ label, hint: typeof raw.hint === "string" ? raw.hint : "" });
  }
  return unreached;
}

/**
 * Raw skill-check shape as the LLM proposes it (W2-E1 adds it to
 * `llmChoiceSchema`). Read structurally so the projection tolerates the field
 * before/after the engine schema lands.
 */
type RawSkillCheck = {
  statId?: unknown;
  difficulty?: unknown;
  successNote?: unknown;
  failNote?: unknown;
};

/** Project a choice's skill check into the reader-facing card summary. */
function projectChoiceCheck(
  raw: RawSkillCheck | undefined,
  state: PlayerState,
): ProjectionCheck | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const statId = typeof raw.statId === "string" ? raw.statId : "";
  if (statId.length === 0) return undefined;
  const difficulty =
    raw.difficulty === "easy" || raw.difficulty === "risky" || raw.difficulty === "desperate"
      ? raw.difficulty
      : "risky";
  const companion = deriveCheckCompanionPhrase(state, statId);
  return {
    statId,
    label: state.attributes?.[statId]?.label ?? statId,
    difficulty,
    odds: deriveCheckOdds(state, { statId, difficulty }),
    ...(companion !== undefined ? { companion } : {}),
  };
}

/**
 * Companion-support phrase for the check chip: WHO stands with the reader when
 * visible companion attributes would add to the check — the same
 * `companionContributions` that `resolveChoiceCheck` folds into its score. A
 * PHRASE only; the bonus value never leaves the server (BC10, same discipline
 * as the odds phrase). Tolerant: an engine rejection or a name-less roster
 * yields no phrase, never a turn failure. Exported for the projection tests.
 */
export function deriveCheckCompanionPhrase(
  state: PlayerState,
  statId: string,
): string | undefined {
  try {
    // The numeric difficulty only affects pass/fail, not the contributions —
    // any value works for reading WHO helps.
    const breakdown = resolveSkillCheck(state, { statId, difficulty: 0, includeCompanions: true });
    const roster = Object.values(state.npcs ?? {});
    const names = breakdown.companionContributions
      .filter((entry) => entry.value > 0)
      .map((entry) => roster.find((npc) => npc?.id === entry.npcId)?.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0);
    if (names.length === 0) return undefined;
    if (names.length === 1) return `${names[0]} stands with you`;
    if (names.length === 2) return `${names[0]} and ${names[1]} stand with you`;
    return `${names[0]}, ${names[1]}, and others stand with you`;
  } catch {
    return undefined;
  }
}

/**
 * Project the Codex (R11.1 / W2-S6): string-valued flags newest-first, cap 40,
 * via the engine's `deriveCodex`. Returns [] on legacy saves / no string flags.
 * Tolerant — a shape the engine version predates yields an empty codex rather
 * than throwing inside the projection choke point.
 */
function projectCodex(state: PlayerState): CodexEntry[] {
  try {
    const entries = deriveCodex(state);
    if (!Array.isArray(entries)) return [];
    return entries
      .filter(
        (e): e is CodexEntry =>
          !!e &&
          typeof (e as CodexEntry).flag === "string" &&
          typeof (e as CodexEntry).text === "string" &&
          typeof (e as CodexEntry).turnNumber === "number",
      )
      .map((e) => ({ flag: e.flag, text: e.text, turnNumber: e.turnNumber }));
  } catch {
    return [];
  }
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
