import { Platform } from "react-native";

import type { NpcState, Story } from "@cyoa/engine";

import { convexClient, convexSiteUrl } from "./convex";
import {
  convexHttp as callConvexHttp,
  convexHttpWithError as callConvexHttpWithError,
} from "./convexHttp";

type AgeSelection = "13-17" | "18+" | "under_13";
type Mode = "story" | "hardcore";

export type RemoteAccount = {
  accountId: string;
  kind: "guest" | "user";
  ageBand: "13-17" | "18+";
  matureContentEnabled: boolean;
};

export type RemoteLibraryItem = {
  saveId: string;
  storyId: string;
  title: string;
  mode: Mode;
  status: "active" | "dead" | "ended" | "ended_safely";
  currentNodeId: string;
  turnNumber: number;
  updatedAt: number;
};

export type RemoteCreatorSeedItem = {
  seedId: string;
  storyId: string;
  title: string;
  status: "published";
  opening: string;
  updatedAt: number;
};

export type RemoteChoice = {
  choice: { id: string; label: string };
  visibility: "visible" | "locked" | "hidden";
  /**
   * Story-engagement Wave 1 (design §7): the server projects each choice's
   * gated render-state as `state: "visible" | "locked"` computed from the
   * choice's `conditions` against current state (R4.3). This is additive to
   * the legacy `visibility` field — the adapter (`adaptRemoteChoice`) prefers
   * `state` when present and falls back to `visibility` for older projections.
   *
   * NOTE (integrator reconcile): design §7 names this field `state`, while the
   * pre-existing projection uses `visibility` (which also carries "hidden").
   * The SERVER agent (W1-S4) emits `state`; keeping both keeps a mixed-version
   * rollout safe. Server emits null-for-absent → optional here (BC2/BC4).
   */
  state?: "visible" | "locked" | null;
  lockedHint?: string | null;
  /**
   * Near-miss BAND on a locked numeric (stat/currency) gate — "near" when the
   * reader almost clears the threshold. A phrase only; the server never emits
   * the value or threshold (BC10). Absent on binary gates, visible choices,
   * and older projections (BC2/BC4).
   */
  nearness?: "near" | "far" | null;
  /**
   * Story-engagement Wave 2 (design §7 / R7.4): when a choice carries a
   * skill check, the server projects the pre-computed ODDS PHRASE only —
   * never the raw threshold/roll math (BC10). The client renders a CheckChip
   * (`⚄ Nerve — risky`) from `label` + `odds`. Server emits null-for-absent →
   * optional here (BC2/BC4). Mutually exclusive with a locked `state` on the
   * server side (conditions win, per W2-E1) but the client tolerates either.
   */
  check?: RemoteCheck | null;
};

/**
 * Story-engagement Wave 2 skill-check descriptor projected onto a choice
 * (design §7). `odds` is the server-computed phrase (BC10 — the client is
 * NEVER given the stat total, roll, or threshold). `difficulty` is surfaced
 * for the a11y label / future styling; `label` is the human stat name.
 */
export type OddsPhrase = "likely" | "even" | "risky" | "desperate";
export type RemoteCheck = {
  statId: string;
  label: string;
  difficulty: "easy" | "risky" | "desperate";
  odds: OddsPhrase;
};

/**
 * Story-engagement Wave 1 reader-visible arc summary (design §7). COUNT-ONLY
 * beat progress — pending beat labels and candidate endings are spoilers and
 * NEVER reach the client (R1.5 / BC10). Server emits `actLabel: null` for
 * absent; the adapter maps null→optional (BC2/BC4).
 *
 * The first block is the exact §7 wire contract. The second block
 * (`protagonistWant` / `stakes` / `firedBeats`) is required by the QuestLine
 * peek-drawer panel per design §4.1 (question/want/stakes/act/fired-beat list
 * with turns) but is NOT enumerated in §7 — see the integrator flag in the
 * deliverable. All optional so the one-line strip works with the minimal §7
 * shape and the drawer degrades gracefully when the richer fields are absent.
 */
export type RemoteArc = {
  dramaticQuestion: string;
  // Server emits `act: number` (convex/saves.ts ProjectionArc), not the
  // narrowed `1|2|3` design §7 hints — matched here so the WS `liveScene`
  // type assigns cleanly (BC2). `romanAct` handles any positive integer.
  act: number;
  actLabel?: string | null;
  beatsFired: number;
  beatsTotal: number;
  threadsPending: number;
  /** W2 doom-clock summary — forward-compat; absent on Wave-1 saves. */
  clock?: { label: string; value: number; max: number } | null;
  // --- drawer-only enrichment (design §4.1; not in §7 — flagged) ---
  protagonistWant?: string | null;
  stakes?: string | null;
  firedBeats?: Array<{ label: string; turnNumber: number }> | null;
};

/**
 * Story-engagement Wave 1 signed diff record (design §7 `recentDiffs`). The
 * server persists visible-tier redacted diffs on the turn and projects them
 * here; the client echo derives signed chips from this union (R5.2). Hidden
 * stats are dropped server-side (BC10), so this array only ever carries
 * visible-tier records. W2/W3 kinds (`clock`/`npc`/`check`) are included so
 * the union matches the full §7 contract; they are inert on Wave-1 saves.
 */
export type RemoteRecentDiff =
  | { kind: "stat"; statId: string; label: string; delta: number }
  | { kind: "currency"; delta: number }
  | { kind: "item"; op: "add" | "remove"; label: string }
  | { kind: "thread"; op: "set" | "fired"; note: string | null }
  | { kind: "beat"; label: string }
  | { kind: "act"; act: number }
  // --- W2 (design §7); shapes match convex/saves.ts VisibleDiff exactly ---
  // NOTE (SERVER-reconciled): the server types `clock.reason` as string|null
  // (null on a reason-less advance) and `npc.deltaBand` as OPTIONAL (absent on
  // a fact-only diff). Matched here so `liveScene` (SceneProjection) assigns to
  // RemoteScene cleanly (BC2). `fact` is string|null (null on a pure shift).
  | { kind: "clock"; amount: number; reason: string | null }
  | { kind: "npc"; npcId: string; name: string; deltaBand?: "up" | "down"; fact: string | null }
  | { kind: "check"; outcome: "success" | "partial" | "fail"; statId: string; margin: number };

/**
 * Story-engagement Wave 2 codex entry (design §7 / R11.2). Each is a
 * string-valued flag the LLM set as a recorded "truth", surfaced newest-first
 * in the Codex tab. `turnNumber` is when the truth was recorded. Server emits
 * `codex: null` for absent (legacy / arc-less saves) → optional client-side.
 */
export type RemoteCodexEntry = { flag: string; text: string; turnNumber: number };

/**
 * Story-engagement Wave 3 keepsake (design §7 / R12). Granted on an ending
 * unlock (account-scoped, dedup by id) and carriable into a new run. Surfaced
 * in the profile keepsakes shelf and the new-story KeepsakePicker. Server emits
 * these on the widened profile projection; the adapter (`adaptKeepsakes`) maps
 * a null/absent array to an empty list (BC2/BC4).
 */
export type RemoteKeepsake = { id: string; label: string; description: string };

/**
 * Story-engagement Wave 3 Librarian Rank (design §7 / R12.3). Display-only,
 * server-computed from lifetime (endings, beats, tales). The client never
 * computes the tier — it renders `label` + the counts. Server emits it on the
 * widened profile projection (null-for-absent on fresh accounts).
 */
export type RemoteLibrarianRank = {
  tier: string;
  label: string;
  endings: number;
  beats: number;
  tales: number;
};

/**
 * Story-engagement Wave 3 what-might-have-been candidate (design §7 / R14).
 * One UNREACHED candidate ending surfaced (label + hint only — never a full
 * spoiler) on the terminal ending panel + as a fogged ghost on the endings map.
 * The server projects these ONLY post-terminal (BC10); pre-terminal saves never
 * carry them.
 */
export type RemoteWhatMightHaveBeen = { label: string; hint: string };

export type RemoteScene = {
  saveId?: string;
  storyId: string;
  nodeId: string;
  turnNumber: number;
  /**
   * Reader-authored title from the Seed-an-Adventure flow when present
   * (Requirement 22.7). The reader screen prefers this over the engine
   * story.title so seeded saves display the user's title instead of
   * the open-canvas shell's "Open Canvas" placeholder. Optional for
   * legacy starters and saves predating the seed-flow.
   */
  seedTitle?: string;
  prose: string;
  streamStatus: "pending" | "streaming" | "complete" | "failed" | "blocked";
  choices: RemoteChoice[];
  visibleStats: Array<{ statId: string; label: string; value: number }>;
  /**
   * Top-level vitality value from save.state.vitality (0–10). The HUD now
   * reads this directly so vitality doesn't get clamped to the 5-pip attribute
   * ceiling and works even when `visibleStats` is empty (the LLM hasn't
   * introduced any visible attribute stats yet).
   *
   * Optional for backwards compatibility with older server projections that
   * don't yet include the field.
   */
  vitality?: number;
  inventoryCount: number;
  /**
   * Full inventory items pulled from save.state.inventory. Replaces the
   * fabricated dummy-label list the client used to build off `inventoryCount`.
   * Optional for the same backwards-compat reason as `vitality`.
   */
  inventory?: Array<{
    id: string;
    label: string;
    /**
     * Story-engagement Wave 3 (R12.2): item tags. A carried keepsake is
     * injected as an inventory item tagged `keepsake`; the client renders a
     * small badge on it in the inventory list. Optional — legacy items and
     * older projections omit tags (BC9).
     */
    tags?: string[];
  }>;
  /**
   * NPC roster mirrored from `PlayerState.npcs` (Requirement 31). Optional
   * for backwards compatibility — servers that haven't yet plumbed
   * `state.npcs` through `projectCurrentScene` / `projectLlmDrivenScene` omit
   * the field, and the client renders no roster section.
   *
   * NOTE (cross-agent coordination): the prompt-builder agent is adding the
   * server-side projection of this field; the duplicate declaration here is
   * intentional and shape-compatible.
   */
  npcs?: Record<string, NpcState>;
  /**
   * Deterministic-fallback sentinel mirrored from `scene.isFallback`. The
   * server only sets this when the LLM router fell through to the
   * deterministic provider (every real provider failed / was ineligible).
   * The reader UI renders the FallbackTurnPanel ("the page is blank for a
   * moment — try again") in place of the deterministic placeholder prose
   * + choices when this is true. Absent on every real-provider scene; the
   * client treats absent as `false`.
   */
  isFallback?: boolean;
  terminal?: { endingId: string; kind: "success" | "death" | "safe" | "other" } | null;
  /**
   * Story-engagement Wave 1 reader-visible arc summary (design §7). Present
   * only on arc-bearing (new) saves; legacy saves omit it (server emits null →
   * absent here) and the QuestLine / ThreadsPill render nothing (R1.6 / BC9).
   */
  arc?: RemoteArc | null;
  /**
   * Story-engagement Wave 1 signed diffs for the turn that produced THIS scene
   * (design §7). Drives the signed echo (R5.2). Absent (null/undefined) on old
   * turns predating diff persistence → the echo falls back to a stat snapshot.
   */
  recentDiffs?: RemoteRecentDiff[] | null;
  /**
   * Story-engagement Wave 2 codex (design §7). The reader-visible list of
   * recorded truths, surfaced in the Codex tab. Absent (null/undefined) on
   * legacy saves and turns predating codex projection → the tab hides (BC9).
   */
  codex?: RemoteCodexEntry[] | null;
  /**
   * Story-engagement Wave 3 ending reflection (design §7 / R14). Present ONLY
   * on a terminal (arc) save; carries 1–2 UNREACHED candidate endings
   * (label + hint) for the What-Might-Have-Been cards and the fogged endings-map
   * ghosts. Server emits `null` pre-terminal / on legacy saves (BC9/BC10) → the
   * surfaces render nothing.
   */
  ending?: { whatMightHaveBeen?: RemoteWhatMightHaveBeen[] | null } | null;
  /**
   * Daily Killcam (daily-killcam R3.3, DK): the Daily Tale this save belongs to.
   * A reader-known fact (they tapped the Daily card) — spoiler-neutral under
   * BC10. Present ONLY on Daily saves; `projectLlmDrivenScene` emits it via
   * conditional spread and legacy / non-daily projections omit it (BC9/BC4), so
   * the client treats absent as "not a Daily" and the pulse chip stays dark.
   */
  dailyId?: string;
  /**
   * Reading modes R4 (novel mode): the save's content axis when it is a novel
   * read. A reader-known fact (they chose novel at create) — spoiler-neutral
   * under BC10. Present ONLY on novel saves; `projectLlmDrivenScene` emits it
   * via conditional spread and branching / legacy projections omit it (BC9/BC4),
   * so the client treats absent as "branching" and renders the normal choice row.
   */
  readingMode?: "novel";
};

export function hasRemoteGameApi() {
  return convexClient !== null;
}

export async function createRemoteGuestAccount(input: {
  ageSelection: AgeSelection;
  guestTokenHash: string;
}): Promise<{ account: RemoteAccount; created: boolean } | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("mutation", "game:createGuestAccount", input as unknown as Record<string, unknown>) as any;
}

export async function listRemoteLibrary(input: {
  accountId: string;
  guestTokenHash?: string;
}): Promise<RemoteLibraryItem[] | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("query", "game:listLibrary", input as unknown as Record<string, unknown>) as any;
}

export async function createRemoteSave(input: {
  accountId: string;
  guestTokenHash?: string;
  storyId: string;
  mode: Mode;
  /**
   * Story-engagement Wave 3 (R12.2, BC3): the single owned keepsake the reader
   * chose to carry into this new run. The server validates ownership and
   * injects it as an inventory item tagged `keepsake` + an opening prompt line.
   * Omitted when the reader carries nothing. `createSave` args go through an
   * untyped `callConvexHttp<any>` input so this rides along without waiting on
   * the server arg-widening (BC3) — the server drops it until it widens.
   */
  keepsakeId?: string;
  /**
   * Story-engagement Wave 3 (R13.2, BC3): the Daily Tale this run belongs to.
   * When set the server injects the daily's fixed arc (`source:"daily"`, turn-1
   * arc generation skipped) and records a `daily_results` row on terminal.
   * Normally the reader starts a Daily via `dailyFunctions:startDaily`; this is
   * threaded for completeness of the create path.
   */
  dailyId?: string;
  /**
   * Reading-modes R4 — start this save in Novel mode (linear reading via a
   * single synthetic "turn the page" choice). Server re-gates through
   * `resolveReadingMode` (posture A). Absent ⇒ branching (byte-identical).
   */
  readingMode?: "branching" | "novel";
  /**
   * Narrator voice id chosen by the reader on the cover screen. Sent at save
   * creation only — the backend persists it on the save record so subsequent
   * `completeSceneStream` calls can read it server-side without resending per
   * turn. Format: `"voice.ash" | "voice.lark" | ...` (see useNarratorVoice).
   */
  voiceId?: string;
  // Seed-flow inputs from creator's "Seed an adventure" UI. The backend
  // validates seedPremise via evaluateTextPolicy(publishing surface) and
  // throws seed_premise_blocked on block.
  seedPremise?: string;
  seedTitle?: string;
  seedTone?: string;
  /**
   * Optional 0–4 NPC cast authored during the Seed flow. The backend
   * runs the publishing-surface classifier on each `description` and
   * throws `seed_npc_blocked` on rejection; otherwise it threads the
   * entries into `Story.initialNpcs` for the new save so the roster +
   * portrait pipeline have data from turn 0. Names must match the
   * server allowlist regex `/^[\p{L}\p{N} '\-]{1,40}$/u`; descriptions
   * are 8–200 chars.
   */
  seedNpcs?: Array<{
    name: string;
    role: "companion" | "ally" | "rival" | "neutral" | "antagonist";
    description: string;
  }>;
}): Promise<{ saveId: string; sceneId: string; scene: RemoteScene } | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("mutation", "game:createSave", input as unknown as Record<string, unknown>) as any;
}

export async function getRemoteCurrentScene(input: {
  accountId: string;
  guestTokenHash?: string;
  saveId: string;
}): Promise<RemoteScene | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("query", "game:getCurrentScene", input as unknown as Record<string, unknown>) as any;
}

/**
 * "Begin again" via PANEL-SERVER's `game:restartRun` (panel-review-2 ranked
 * idea 5 / Dana's HIGH restart critique). The server loads the ENDED save,
 * copies its `storyId` + every seed field (seedPremise/seedTitle/seedTone/
 * seedNpcs/voiceId) onto a FRESH save, and returns the new save + opening
 * scene — the same shape as `createSave`. This is what the ending panel's
 * "Begin again" should call: it fixes both failure modes the old client
 * restart hit (community `authored_seed:<id>` runs threw `story_not_found`,
 * and SeedStoryFlow premise runs restarted the blank open-canvas shell) by
 * copying the seed identity server-side instead of re-deriving it from the
 * client starter catalog.
 *
 * DEPENDENCY (PANEL-SERVER): `game:restartRun` is owned by PANEL-SERVER. Until
 * it is deployed, `convexHttp` maps the "function not found" server error to
 * `null` (same as any transport failure), so the caller falls back to the
 * cover-screen `createSave` path. Coded here to the documented wire shape.
 */
export async function restartRemoteRun(input: {
  accountId: string;
  guestTokenHash?: string;
  saveId: string;
}): Promise<{ saveId: string; sceneId?: string; scene?: RemoteScene } | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>(
    "mutation",
    "game:restartRun",
    input as unknown as Record<string, unknown>,
  ) as any;
}

/**
 * Result of switching a save's content Axis 1 (reading-modes cleanup). Mirrors
 * the `readingModeFunctions:setReadingMode` mutation union exactly: switching to
 * `"novel"` is Pro-gated (`needs_pro`), switching to `"branching"` is always
 * allowed. `null` is the transport/no-backend sentinel every gameApi binding
 * returns — it is NOT one of the server's `reason` codes.
 */
export type SetReadingModeResult =
  | { ok: true; mode: "branching" | "novel" }
  | { ok: false; reason: "needs_pro" | "not_found" | "unauthorized" };

/**
 * Switch an existing save between Branching and Novel via
 * `readingModeFunctions:setReadingMode`. Auth is threaded as the mutation's
 * nested `auth: { accountId, guestTokenHash? }` (the server re-gates novel
 * through `resolveReadingMode`). The reader drawer calls this on a mode change;
 * the create flow sets the mode at `createSave` time instead and never needs it.
 */
export async function setReadingMode(input: {
  saveId: string;
  mode: "branching" | "novel";
  auth?: { accountId: string; guestTokenHash?: string };
}): Promise<SetReadingModeResult | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>(
    "mutation",
    "readingModeFunctions:setReadingMode",
    input as unknown as Record<string, unknown>,
  ) as any;
}

/**
 * One doors-journal row (DOORS-JOURNAL — the reader-facing half of the
 * story-bible fetch-quest loop). The server projects ONLY doors the reader has
 * already seen rendered locked on screen (BC10): `label` is the lock as the
 * reader met it, `hint` the tease that rendered with it (may be empty), and
 * `state` tracks the loop — "teased" (key still out there), "key-in-hand"
 * (the promised key has since landed in inventory), "opened". Nothing else —
 * no ids, bands, turns, or unfired plan entries — ever crosses the wire.
 */
export type RemoteDoorsJournalEntry = {
  label: string;
  hint: string;
  state: "teased" | "key-in-hand" | "opened";
};

/**
 * Fetch the save's doors journal from `llm/storyBible:getDoorsJournal`.
 * Empty array = no teased doors yet (the DoorsJournal surface renders
 * nothing); null = no remote backend / transport failure.
 */
export async function getRemoteDoorsJournal(input: {
  accountId: string;
  guestTokenHash?: string;
  saveId: string;
}): Promise<RemoteDoorsJournalEntry[] | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>(
    "query",
    "llm/storyBible:getDoorsJournal",
    input as unknown as Record<string, unknown>,
  ) as any;
}

/**
 * One past turn surfaced by `getRunHistory`. The shape mirrors the server
 * projection in `convex/game.ts:getRunHistory` — keep them in sync when
 * either side changes a field.
 *
 * Fields:
 * - `turnNumber`: the turn number the reader landed on (0 = opening).
 * - `nodeId`: engine nodeId for that turn (authored stories surface a
 *   meaningful id; llm-driven scenes carry a synthetic `…:llm:<n>` id
 *   that the UI hides behind the "Turn N" fallback in `sceneTitle`).
 * - `sceneTitle`: author-supplied `node.title` when present, otherwise a
 *   "Turn N" fallback. Never the synthetic llm node id verbatim.
 * - `prose`: the LLM-elaborated scene text persisted on `scenes.prose`.
 * - `streamStatus`: lets the archive UI suppress empty / blocked cards.
 * - `choice`: the choice the reader picked that LED INTO this scene. The
 *   opening turn has no inbound choice and may omit this entirely (we
 *   currently always include it because the cursor advance writes a
 *   `turn_history` row even for the opening, but downstream UIs treat
 *   the field as optional defensively).
 * - `media`: ready-only Pro asset URIs. Any combination of the three
 *   URIs (image/video/narrator) may be absent — past scenes that
 *   were never queued for media, or whose Pro job failed, surface
 *   without that slot.
 */
export type RemoteRunHistoryTurn = {
  turnNumber: number;
  sceneId: string | null;
  nodeId: string;
  sceneTitle: string;
  prose: string;
  streamStatus: "pending" | "streaming" | "complete" | "failed" | "blocked";
  completedAt: number | null;
  choice?: { choiceId: string; choiceLabel: string };
  media?: {
    imageUri?: string;
    videoUri?: string;
    narratorUri?: string;
    narratorVoiceId?: string;
  };
};

export type RemoteRunHistory = {
  saveId: string;
  storyId: string;
  storyTitle: string;
  currentTurnNumber: number;
  turns: RemoteRunHistoryTurn[];
  hasMore: boolean;
};

export async function getRemoteRunHistory(input: {
  accountId: string;
  saveId: string;
  guestTokenHash?: string;
}): Promise<RemoteRunHistory | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>(
    "query",
    "game:getRunHistory",
    input as unknown as Record<string, unknown>,
  ) as any;
}

/**
 * Drop the last `dropTurns` turns of a save and roll the cursor back to
 * the most recent kept turn. Cascade-deletes scene records + their
 * media assets and turn_history rows. Used by the "Rewind" affordance
 * on /read/[saveId]/history so readers can recover from polluted runs
 * (e.g. the deterministic-fallback premise echo) without starting a
 * new save.
 *
 * Returns the server's audit summary on success; null when no remote
 * backend is wired.
 */
export async function rewindRemoteSaveTurns(input: {
  accountId: string;
  saveId: string;
  guestTokenHash?: string;
  dropTurns: number;
}): Promise<{
  saveId: string;
  droppedTurnCount: number;
  droppedSceneCount: number;
  newTopTurnNumber: number;
  currentNodeId: string;
  currentSceneId: string | null;
} | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>(
    "mutation",
    "game:rewindSaveTurns",
    input as unknown as Record<string, unknown>,
  ) as any;
}

export type RemoteSceneMedia = {
  status: "idle" | "queued" | "generating" | "ready" | "blocked" | "failed";
  kind: "image" | "video" | "audio";
  /**
   * Engine nodeId of the scene this media belongs to. Surfaced by the server
   * so the client can detect when polling has advanced to a newer scene
   * (the server's `save.currentSceneId` flips on `beginStreamingChoice`)
   * while the local `projection.scene` hasn't caught up yet. Without this
   * gate, the narrator clip for scene N+1 plays over scene N's on-screen
   * prose for the brief window between the choice mutation landing and
   * the SSE stream resolving the canonical projection.
   *
   * Optional for backwards compatibility with older server projections.
   */
  nodeId?: string;
  uri?: string;
  alt: string;
  durationMs?: number;
  /**
   * Library ambient loop attached to this scene (priority-4 audio layer).
   * Surfaced by the Convex projection when the save's chapter/room has a
   * ride-along ambient track.
   */
  ambient?: {
    id: string;
    uri: string;
    label: string;
    tags: string[];
    volume: number;
  };
  /**
   * Narrator TTS clip for this scene's prose (priority-1 audio layer).
   * Populated server-side once Google Cloud TTS finishes for the save's
   * pinned voiceId; absent until the asset is ready or when TTS is disabled.
   */
  narrator?: {
    id: string;
    uri: string;
    voiceId: string;
  };
  /**
   * True when a Veo job is queued/generating in parallel with the image
   * plate. The image is already showing; the UI uses this to display a
   * "video on the way" pip during Veo's 30-90s tail.
   */
  videoPending?: boolean;
  /**
   * Ready image URI for the scene. Surfaced independently of the legacy
   * `uri` so the split UI can anchor the top plate even when video is
   * the ranked primary asset.
   */
  imageUri?: string;
  /** Ready video URI for the scene. */
  videoUri?: string;
};

export async function getRemoteSceneMedia(input: {
  accountId: string;
  saveId: string;
  guestTokenHash?: string;
  sceneId?: string;
}): Promise<RemoteSceneMedia | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("query", "media/sceneMedia:getSceneMedia", input as unknown as Record<string, unknown>) as any;
}

export async function submitRemoteChoice(input: {
  accountId: string;
  guestTokenHash?: string;
  saveId: string;
  choiceId: string;
  requestId: string;
}): Promise<{ saveId: string; sceneId: string; scene: RemoteScene; prose: string } | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("mutation", "game:submitChoice", input as unknown as Record<string, unknown>) as any;
}

/**
 * Begin a streaming turn for a tapped A/B/C choice. Returns a
 * discriminated-union result (same shape as {@link beginRemoteFreeformChoice})
 * so the reader UI can tell a genuine server rejection (e.g.
 * `daily_turns_exhausted`, `turn_in_progress`) apart from a transport failure
 * (`null`) and render an accurate message instead of always blaming the daily
 * allowance. `game:beginStreamingChoice` is the same mutation the freeform
 * sibling calls.
 */
export async function beginRemoteStreamingChoice(input: {
  accountId: string;
  guestTokenHash?: string;
  saveId: string;
  choiceId: string;
  requestId: string;
}): Promise<
  | { ok: true; saveId: string; sceneId: string; scene: RemoteScene; stream: boolean }
  | { ok: false; errorCode: string; errorMessage: string }
  | null
> {
  if (!convexClient) return null;
  return callConvexHttpWithError<{ saveId: string; sceneId: string; scene: RemoteScene; stream: boolean }>(
    "mutation",
    "game:beginStreamingChoice",
    input as unknown as Record<string, unknown>,
  );
}

/**
 * Reset the save's current scene back to a `pending` stream state and clear
 * any deterministic-fallback content. Called by the FallbackTurnPanel "Try
 * again" button BEFORE opening a fresh SSE stream — otherwise the server
 * rejects `/llm/scene-stream` with HTTP 403 because the prior fallback
 * scene was persisted as `streamStatus: "complete"`.
 *
 * The mutation also stamps a fresh `requestId` onto `save.activeTurnRequestId`
 * so the subsequent stream open passes `getAuthorizedSceneStreamRequest`'s
 * dedup guard. Server-side terminal scenes (death / safe / success endings)
 * are NOT retryable — the server refuses with `scene_terminal_not_retryable`.
 */
export async function retryRemoteCurrentScene(input: {
  accountId: string;
  guestTokenHash?: string;
  saveId: string;
  requestId: string;
}): Promise<{ ok: true } | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>(
    "mutation",
    "game:retryCurrentScene",
    input as unknown as Record<string, unknown>,
  ) as any;
}

/**
 * Sibling of `beginRemoteStreamingChoice` for the free-form ("Option D")
 * path. Same Convex mutation under the hood, but it surfaces server error
 * codes through a discriminated-union return so the UI can render the
 * specific block reason (length / safety / unsupported story mode) instead
 * of a generic "something went wrong" — the regular-choice path doesn't
 * need that detail.
 *
 * Server error codes:
 *   - `freeform_not_supported_for_story` — scripted/local-engine story
 *   - `freeform_text_empty` / `freeform_text_too_long` — length gate
 *   - `freeform_text_blocked` — safety classifier rejected the text
 */
export async function beginRemoteFreeformChoice(input: {
  accountId: string;
  guestTokenHash?: string;
  saveId: string;
  choiceId: string;
  requestId: string;
  userText: string;
}): Promise<
  | { ok: true; saveId: string; sceneId: string; scene: RemoteScene; stream: boolean }
  | { ok: false; errorCode: string; errorMessage: string }
  | null
> {
  if (!convexClient) return null;
  return callConvexHttpWithError<{ saveId: string; sceneId: string; scene: RemoteScene; stream: boolean }>(
    "mutation",
    "game:beginStreamingChoice",
    input as unknown as Record<string, unknown>,
  );
}

export async function streamRemoteScene(input: {
  accountId: string;
  guestTokenHash?: string;
  saveId: string;
  onToken: (text: string) => void;
}): Promise<boolean> {
  if (!convexSiteUrl) return false;
  try {
    // NATIVE: React Native's global `fetch` (whatwg-fetch / XHR-backed) does
    // NOT expose a streaming `response.body` — `getReader()` below would be
    // undefined and every native reader would fall through to the poll
    // fallback. `expo/fetch` is a native streaming fetch whose FetchResponse
    // implements `Response` with a real ReadableStream body, so token
    // streaming works on device. WEB keeps the global `fetch` (its body
    // streams natively in the browser and the live tunnel depends on it).
    const streamingFetch: typeof fetch =
      Platform.OS === "web"
        ? fetch
        : // eslint-disable-next-line @typescript-eslint/no-var-requires
          (require("expo/fetch").fetch as typeof fetch);
    const response = await streamingFetch(`${convexSiteUrl.replace(/\/$/u, "")}/llm/scene-stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      // Send Cloudflare Access session cookie on cross-origin requests
      // when the tunnel is gated by Access. No-op when running locally.
      credentials: "include",
    });
    if (!response.ok || !response.body) return false;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        const parsed = parseSseEvent(event);
        if (parsed.event === "token" && typeof parsed.data.text === "string") {
          input.onToken(parsed.data.text);
        }
        if (parsed.event === "error") return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function getRemoteProfile(input: {
  accountId: string;
  guestTokenHash?: string;
}): Promise<{
  accountId?: string;
  kind: "guest" | "user";
  ageBand: "13-17" | "18+";
  matureContentEnabled: boolean;
  dailyAllowance: number | "unlimited";
  entitlementTier: "free" | "unlimited" | "pro";
  entitlementStatus: "active" | "grace" | "expired" | "revoked";
  /**
   * Per-account media-generation gates surfaced from the `accounts` row's
   * `mediaPrefs` field (server-side default: all true when absent). The
   * client reconciles these with localStorage on hydrate so a reader who
   * toggled "Play scene cinematics" off on one device sees the same gate
   * after a fresh load on another.
   */
  mediaPrefs: {
    imagesEnabled: boolean;
    audioEnabled: boolean;
    videoEnabled: boolean;
  };
  /**
   * Story-engagement Wave 3 (design §7 / R12.3): the widened profile projection
   * adds the Librarian Rank (display-only, server-computed) and the account's
   * owned keepsakes. Both are optional here — the server emits null-for-absent
   * (fresh accounts), and the profile lib may run against a pre-W3 server that
   * doesn't project them yet (BC2/BC4). Consumers adapt via `adaptKeepsakes` /
   * `adaptLibrarianRank` in `storyEngagementW3.ts`.
   */
  librarianRank?: RemoteLibrarianRank | null;
  keepsakes?: RemoteKeepsake[] | null;
} | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("query", "accountFunctions:getProfile", input as unknown as Record<string, unknown>) as any;
}

export async function claimRemoteGuest(input: {
  accountId: string;
  guestTokenHash?: string;
  userId: string;
}): Promise<{ accountId: string; userId: string } | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("mutation", "accountFunctions:claimGuest", input as unknown as Record<string, unknown>) as any;
}

export async function setRemoteMatureContent(input: {
  accountId: string;
  guestTokenHash?: string;
  enabled: boolean;
}): Promise<{ accountId: string; matureContentEnabled: boolean } | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("mutation", "accountFunctions:setMatureContent", input as unknown as Record<string, unknown>) as any;
}

/**
 * Push per-modality media gates to the server. Mirrors the auth shape of
 * `setRemoteMatureContent`. The server validates ownership via the same
 * `assertAccountSessionAccess` guard, writes `accounts.mediaPrefs`, and
 * returns the fresh profile projection so the client can swap in the new
 * values without re-fetching `getProfile`.
 *
 * Best-effort: localStorage is the authoritative client cache. Callers
 * should not block the UI on this round-trip — wrap with a swallowed
 * catch and let the cache carry the user's choice until next hydrate.
 */
export async function setRemoteMediaPrefs(input: {
  accountId: string;
  guestTokenHash?: string;
  imagesEnabled: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
}): Promise<
  | (NonNullable<Awaited<ReturnType<typeof getRemoteProfile>>>)
  | null
> {
  if (!convexClient) return null;
  return callConvexHttp<any>(
    "mutation",
    "accountFunctions:setMediaPrefs",
    input as unknown as Record<string, unknown>,
  ) as any;
}

export async function exportRemoteAccount(input: {
  accountId: string;
  guestTokenHash?: string;
}): Promise<Record<string, unknown> | null> {
  if (!convexClient) return null;
  return remoteOrNull(callConvexHttp<any>("query", "accountFunctions:exportAccount", input as unknown as Record<string, unknown>), 5000);
}

export async function deleteRemoteAccount(input: {
  accountId: string;
  guestTokenHash?: string;
  confirm: "DELETE";
}): Promise<{
  accountId: string;
  savesDeleted: number;
  scenesDeleted: number;
  turnHistoryDeleted: number;
  endingsDeleted: number;
  entitlementsDeleted: number;
  usageMetersDeleted: number;
  dailyCountersDeleted: number;
  analyticsDeleted: number;
  assetsDeleted: number;
  taleReadsDeleted: number;
  taleForksDeleted: number;
  authoredSeedsArchived: number;
  publishedTalesRevoked: number;
} | null> {
  if (!convexClient) return null;
  return remoteOrNull(callConvexHttp<any>("mutation", "accountFunctions:deleteAccount", input as unknown as Record<string, unknown>), 5000);
}

export async function previewRemotePlan(input: {
  currentTier: "free" | "unlimited" | "pro";
  targetTier: "free" | "unlimited" | "pro";
  unusedCreditCents?: number;
}): Promise<{ immediateChargeCents: number; creditAppliedCents: number } | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("query", "billingFunctions:previewPlan", input as unknown as Record<string, unknown>) as any;
}

export async function createRemoteCheckoutSession(input: {
  accountId: string;
  targetTier: "unlimited" | "pro";
  interval: "monthly" | "annual";
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; clientReferenceId: string } | null> {
  if (!convexClient) return null;
  return remoteOrNull(callConvexHttp<any>("action", "billingFunctions:createCheckoutSession", input as unknown as Record<string, unknown>), 5000);
}

/**
 * Opens a Stripe Billing Portal session so an existing paid subscriber can
 * cancel, change plans, or update their payment method. The portal URL is
 * single-use; navigate to it immediately (e.g. `window.location.href = url`).
 *
 * Returns `null` when Convex is unavailable, when the account has no
 * Stripe customer on file (no completed checkout yet), or when the returnUrl
 * fails the https guard server-side.
 */
export async function createRemoteCustomerPortalSession(input: {
  accountId: string;
  returnUrl: string;
}): Promise<{ url: string } | null> {
  if (!convexClient) return null;
  return remoteOrNull(
    callConvexHttp<any>(
      "action",
      "billingFunctions:createCustomerPortalSession",
      input as unknown as Record<string, unknown>,
    ),
    5000,
  );
}

export async function createRemoteCreatorDraft(input: {
  accountId: string;
  guestTokenHash?: string;
  title: string;
  story: Story;
}): Promise<{ seedId: string; seed: { status: "draft" | "published" | "archived" } } | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("mutation", "creatorFunctions:createDraft", input as unknown as Record<string, unknown>) as any;
}

export async function publishRemoteCreatorSeed(input: {
  accountId: string;
  guestTokenHash?: string;
  seedId: string;
  /**
   * Creator-arc publish-step metadata (Req 22.6 / product feature 13),
   * collected in the creator route's publish panel. All optional — the server
   * defaults a metadata-less publish to `visibility:"unlisted"` so nothing
   * reaches the community shelf without an explicit choice. Synopsis is
   * capped at 200 chars server-side (`seed_synopsis_too_long`) and gated by
   * the publishing-surface classifier (`seed_synopsis_blocked`).
   */
  synopsis?: string;
  tone?: string;
  visibility?: "public" | "unlisted";
  forkPolicy?: "allowed" | "disabled";
}): Promise<{ seedId: string; seed: { status: "draft" | "published" | "archived" } } | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("mutation", "creatorFunctions:publish", input as unknown as Record<string, unknown>) as any;
}

export async function listRemotePublishedCreatorSeeds(input: {
  accountId: string;
  guestTokenHash?: string;
}): Promise<RemoteCreatorSeedItem[] | null> {
  if (!convexClient) return null;
  return callConvexHttp<any>("query", "creatorFunctions:listPublishedMine", input as unknown as Record<string, unknown>) as any;
}

async function remoteOrNull<T>(operation: Promise<T>, timeoutMs = 8000): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      operation,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[gameApi] remote call timed out after ${timeoutMs}ms`);
          resolve(null);
        }, timeoutMs);
      }),
    ]);
    return result;
  } catch (err) {
    // Surface the rejection so devs can see WHY Convex bailed instead of
    // silently rendering the local engine fallback. Prod can swap this
    // back to a silent return when telemetry is wired.
    console.error("[gameApi] remote call rejected:", err);
    return null;
  } finally {
    // Clear the race timer so a call that already resolved doesn't later log
    // a bogus "timed out" warning (the timer fired ~timeoutMs after every
    // successful call before this).
    if (timer) clearTimeout(timer);
  }
}

function parseSseEvent(raw: string): { event: string; data: Record<string, unknown> } {
  const lines = raw.split("\n");
  const event = lines.find((line) => line.startsWith("event:"))?.slice("event:".length).trim() ?? "message";
  const dataLine = lines.find((line) => line.startsWith("data:"))?.slice("data:".length).trim() ?? "{}";
  try {
    const data = JSON.parse(dataLine) as Record<string, unknown>;
    return { event, data };
  } catch {
    return { event, data: {} };
  }
}
