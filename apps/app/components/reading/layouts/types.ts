import type { ReaderHudMode } from "../shared";
import type { ChoiceHistoryEntry, ReaderProjection } from "../../../hooks/useTurn";
import type { ChoiceProjection } from "../../../hooks/useTurn";
import type { PatronTier } from "../../../lib/billingConfig";
import type { RemoteCinematicView } from "../../../lib/cinematicApi";
import type { RemoteWhatMightHaveBeen } from "../../../lib/gameApi";

/**
 * Every reading layout consumes the same projection + streaming state and
 * differs only in typography, gutter, chrome, and media affordance. Layout
 * components do not own scene state — the reader pipeline upstream does.
 */
export type ReaderLayoutProps = {
  projection: ReaderProjection;
  streamedProse: string;
  isStreaming: boolean;
  pendingChoiceId: string | null;
  onChoose: (choice: ChoiceProjection) => void;
  hudMode: ReaderHudMode;
  reducedMotion: boolean;
  onOpenLibrary?: () => void;
  onOpenEndings?: () => void;
  onReturnHome?: () => void;
  /**
   * Terminal-panel promises (core-read-loop Req 8.3 / story-engagement R14.2).
   * ReaderScreen wires these to what the copy actually says:
   *
   *   onBeginAgain — create a FRESH save of the same story and open its reader
   *                  (falls back to the cover on guest/limit errors).
   *   onSeeMap     — the per-save path map `/map/[saveId]`.
   *   onFork       — the run-history fork surface `/read/[saveId]/history`.
   *
   * All optional: legacy hosts that only wire onReturnHome/onOpenEndings keep
   * the previous (home / trophy-crypt) behavior via the builder fallbacks
   * below.
   */
  onBeginAgain?: () => void;
  onSeeMap?: () => void;
  onFork?: () => void;
  /**
   * "Share this ending" — the peak-emotion publish/share affordance on the
   * terminal ending panel (panel-review-2 ranked idea 5). ReaderScreen wires
   * it to the publish flow `/publish/[saveId]`. Optional: legacy hosts that
   * don't supply it keep the panel's share slot hidden (the slot only renders
   * when the handler is present).
   */
  onShareEnding?: () => void;
  /**
   * The run's visible-choice history from `useTurn`, newest last. Drives the
   * ConsequenceReel ("your choices echoed") on the terminal ending panel.
   * Optional — layouts render no reel when absent or empty, so scripted /
   * freshly-remounted saves (whose history is client-session state) simply
   * skip it.
   */
  choiceHistory?: ChoiceHistoryEntry[];
  /**
   * Resolved patron tier for the active reader, forwarded to the death-variant
   * dispatcher (gates Cinematic). When omitted, EndingPanel defaults to
   * Wanderer which never qualifies for Cinematic.
   */
  endingTier?: PatronTier;
  /**
   * Whether the active scene has a Pro Veo cinematic asset ready to play.
   * Forwarded to EndingPanel as `cinematicUri` — Cinematic falls back to
   * Brutal when this is absent.
   */
  cinematicUri?: string;
  /**
   * Whether this is the first time the account has hit the current ending.
   * Wave C ships a `true` placeholder; the real wire from `endings_unlocked`
   * lands in Wave E.
   */
  endingIsFirstFind?: boolean;
  /**
   * Endpoint (Omni) ending cinematic for this save, when one exists
   * (omni-cinematics Req 7.2). When present the layout renders a full-bleed
   * `<CinematicMoment>` above the ending panel — the "movie of your
   * playthrough" — and the panel's existing still remains the fallback.
   * Absent for scripted / non-Pro saves; the ending renders as before.
   */
  endingCinematic?: RemoteCinematicView;
  /**
   * Reader mute preference. Forwarded to `<CinematicMoment>` so the
   * cinematic's native audio track plays silent when the reader has muted.
   */
  muted?: boolean;
  /**
   * User-facing media-gate sliders (settings → "Show illustrations" etc.).
   * Each defaults to true at the SceneMedia / SceneCinematic level, so
   * omitting the prop preserves the previous always-on behavior. Layouts
   * forward these straight through to the scene-media components.
   */
  imagesEnabled?: boolean;
  audioEnabled?: boolean;
  videoEnabled?: boolean;
  /**
   * Narrator TTS playback speed (e.g. 0.75, 1, 1.25, 1.5). Forwarded to
   * SceneMedia → useNarratorPlayback so the audio element honors it, and
   * to NarratorControl so the inline four-pill picker reflects the
   * current value. Defaults to 1 at the layout boundary; ReaderScreen
   * supplies it from useReaderSettings.
   */
  narratorPlaybackRate?: number;
  /**
   * Speed-picker change handler. Wired to useReaderSettings.updateSettings
   * so picks persist across scenes and sessions. Omit on layouts that
   * don't render SceneMedia (Journal).
   */
  onNarratorPlaybackRateChange?: (rate: number) => void;
  /**
   * Free-form ("Option D") affordance. When `onFreeformSubmit` is provided
   * the layout's ChoiceList renders a 4th row that expands into a typed-
   * action input. Layouts forward these straight through; ReaderScreen
   * supplies them only for remote LLM-driven saves (scripted saves omit
   * the callback entirely so the affordance never appears).
   */
  onFreeformSubmit?: (text: string) => void;
  freeformPending?: boolean;
  freeformError?: string | null;
  /**
   * When true (default), scene prose is parsed at render time and
   * dialog lines render as distinct indented `<DialogLine>` blocks.
   * When false, the prose renders verbatim in a single `<Text>` block
   * (the pre-feature behavior). Layouts forward this straight through
   * to `<ProseRenderer>`; ReaderScreen supplies it from
   * `useReaderSettings`.
   */
  dialogBlocksEnabled?: boolean;
  /**
   * Account identifier for the active reader. Forwarded to `<StatsHud>` →
   * `<FullSheetMode>` → `<NpcRoster>` so per-NPC portrait queries
   * (`media/npcMedia:getNpcPortraitUrl`) can authenticate. Optional —
   * local-only / training-room saves render with no live portrait lookup,
   * which is correct: those saves never queue NPC assets.
   */
  accountId?: string;
  /**
   * Most-recent visible choice the reader made — i.e. what brought them to
   * the current scene. Surfaced inline as the `<EffectBadge>` so the reader
   * can connect the dot between their pick and the stat / inventory change
   * that just happened. Omitted on the first turn (no prior choice) and on
   * layouts that the parent intentionally doesn't wire (currently all five
   * receive it). Layouts treat a missing prop the same as null: no badge.
   */
  recentChoiceEcho?: ChoiceHistoryEntry | null;
  /**
   * Retry callback for the deterministic-fallback sentinel
   * (`projection.scene.isFallback === true`). When set and the scene is a
   * fallback, layouts render `<FallbackTurnPanel onRetry={onRetry} />` in
   * place of the prose surface + ChoiceList so the deterministic
   * placeholder text never reaches the reader. ReaderScreen wires this to
   * `useTurn.retryCurrentTurn`. Omitted on local-only / scripted saves
   * (the deterministic provider never serves there) and on layouts that
   * don't render the fallback panel.
   */
  onRetryCurrentTurn?: () => void | Promise<void>;
  /**
   * Save id + reader session auth for the reader-facing "Illuminate this page"
   * candle (Iris proposal). Threaded to `<IlluminateButton>`, which self-hides
   * on any page that can't be illuminated (unresolved prose, no session, local
   * save). Both optional — layouts render no candle when either is absent, so
   * scripted / local / guest-less saves keep the previous chrome exactly.
   */
  saveId?: string;
  illuminateAuth?: { accountId: string; guestTokenHash?: string };
};

type Nav = (() => void) | undefined;

/**
 * Builds the EndingPanel prop bag from the layout's optional navigation
 * callbacks. EndingPanel speaks a different vocabulary than the layout shell
 * (Begin again / See map / Share / Close vs. Return home / Open endings /
 * Open library), so the layout-side names are mapped onto EndingPanel's
 * names here:
 *
 *   layout `onBeginAgain` (fallback `onReturnHome`) → EndingPanel `onBeginAgain`
 *   layout `onSeeMap`     (fallback `onOpenEndings`) → EndingPanel `onSeeMap`
 *   layout `onOpenLibrary`                           → EndingPanel `onClose`
 *
 * The dedicated `onBeginAgain` / `onSeeMap` wires exist because the panel's
 * copy makes promises the old fallbacks broke: "Begin again" must start a
 * fresh run of the SAME story (Req 8.3), and "See the map" must open the
 * per-save path map — not the home screen / global trophy crypt. The
 * fallbacks remain so hosts that only wire the legacy navigation keep
 * working buttons.
 *
 * `onShareEnding` is now wired: ReaderScreen supplies it (→ `/publish/
 * [saveId]`), and it flows straight through here. Kept optional because the
 * panel's prop types live under `exactOptionalPropertyTypes:true`, so we omit
 * the key (rather than pass `undefined`) when no host supplies it — legacy
 * hosts keep the share slot hidden.
 */
export function endingPanelHandlers(props: {
  onOpenEndings?: Nav;
  onOpenLibrary?: Nav;
  onReturnHome?: Nav;
  onBeginAgain?: Nav;
  onSeeMap?: Nav;
  onShareEnding?: Nav;
}): {
  onBeginAgain?: () => void;
  onSeeMap?: () => void;
  onShareEnding?: () => void;
  onClose?: () => void;
} {
  const handlers: {
    onBeginAgain?: () => void;
    onSeeMap?: () => void;
    onShareEnding?: () => void;
    onClose?: () => void;
  } = {};
  const beginAgain = props.onBeginAgain ?? props.onReturnHome;
  const seeMap = props.onSeeMap ?? props.onOpenEndings;
  if (beginAgain) handlers.onBeginAgain = beginAgain;
  if (seeMap) handlers.onSeeMap = seeMap;
  if (props.onShareEnding) handlers.onShareEnding = props.onShareEnding;
  if (props.onOpenLibrary) handlers.onClose = props.onOpenLibrary;
  return handlers;
}

/**
 * Build the death-variant prop bag (tier, tone, first-find, cinematic URI,
 * run facts) from the layout's projection + the ReaderScreen-resolved props.
 * Keeps `exactOptionalPropertyTypes:true` happy by omitting absent keys
 * rather than passing `undefined`.
 *
 * The run facts (turnNumber + endingNumber/endingsTotal) come straight off
 * the projection — they feed the variants' "Ending #X of Y · turn N" line,
 * which renders only when both catalog facts are present (Brutal.tsx).
 */
export function endingVariantProps(input: {
  projection: ReaderLayoutProps["projection"];
  tier?: ReaderLayoutProps["endingTier"];
  cinematicUri?: ReaderLayoutProps["cinematicUri"];
  isFirstFind?: ReaderLayoutProps["endingIsFirstFind"];
}): {
  tier?: NonNullable<ReaderLayoutProps["endingTier"]>;
  storyTone?: NonNullable<ReaderLayoutProps["projection"]["storyTone"]>;
  cinematicUri?: string;
  isFirstFind?: boolean;
  turnNumber?: number;
  endingNumber?: number;
  endingsTotal?: number;
} {
  const out: {
    tier?: NonNullable<ReaderLayoutProps["endingTier"]>;
    storyTone?: NonNullable<ReaderLayoutProps["projection"]["storyTone"]>;
    cinematicUri?: string;
    isFirstFind?: boolean;
    turnNumber?: number;
    endingNumber?: number;
    endingsTotal?: number;
  } = {};
  if (input.tier) out.tier = input.tier;
  if (input.projection.storyTone) out.storyTone = input.projection.storyTone;
  if (input.cinematicUri) out.cinematicUri = input.cinematicUri;
  // TODO(wave-e): replace with a real lookup against `endings_unlocked`.
  // Until then, treat every ending as a first-find so Cinematic remains
  // reachable for eligible tier+asset combinations during Wave C QA.
  if (input.isFirstFind !== undefined) out.isFirstFind = input.isFirstFind;
  if (input.projection.turnNumber !== undefined) out.turnNumber = input.projection.turnNumber;
  const ending = input.projection.ending;
  if (ending?.endingNumber !== undefined) out.endingNumber = ending.endingNumber;
  if (ending?.endingsTotal !== undefined) out.endingsTotal = ending.endingsTotal;
  return out;
}

/**
 * Build the `<WhatMightHaveBeen>` prop bag for the terminal ending panel
 * (story-engagement Wave 3, R14):
 *
 *   "Begin again"          → layout `onBeginAgain` (fresh run of the same
 *                            story, Req 8.3; falls back to `onReturnHome`)
 *   "Fork from a decision" → layout `onFork` (the run-history fork surface
 *                            `/read/[saveId]/history`, R14.2; falls back to
 *                            `onOpenEndings` for legacy hosts)
 *
 * The component self-gates: it renders nothing unless the save is terminal AND
 * carries unreached candidates (BC9/BC10), so the no-op fallbacks below are
 * only ever reached on a render that returns null. `terminal` is derived from
 * `projection.ending` (present only on a terminal projection) so the fogged
 * cards never appear on a live / legacy save.
 */
export function whatMightHaveBeenProps(input: {
  projection: ReaderLayoutProps["projection"];
  onOpenEndings?: Nav;
  onReturnHome?: Nav;
  onBeginAgain?: Nav;
  onFork?: Nav;
}): {
  candidates: RemoteWhatMightHaveBeen[] | undefined;
  terminal: boolean;
  onFork: () => void;
  onBeginAgain: () => void;
} {
  const noop = () => undefined;
  return {
    candidates: input.projection.whatMightHaveBeen,
    terminal: Boolean(input.projection.ending),
    onFork: input.onFork ?? input.onOpenEndings ?? noop,
    onBeginAgain: input.onBeginAgain ?? input.onReturnHome ?? noop,
  };
}
