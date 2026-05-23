import type { ReaderHudMode } from "../shared";
import type { ReaderProjection } from "../../../hooks/useTurn";
import type { ChoiceProjection } from "../../../hooks/useTurn";
import type { PatronTier } from "../../../lib/billingConfig";

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
   * User-facing media-gate sliders (settings → "Show illustrations" etc.).
   * Each defaults to true at the SceneMedia / SceneCinematic level, so
   * omitting the prop preserves the previous always-on behavior. Layouts
   * forward these straight through to the scene-media components.
   */
  imagesEnabled?: boolean;
  audioEnabled?: boolean;
  videoEnabled?: boolean;
};

type Nav = (() => void) | undefined;

/**
 * Builds the EndingPanel prop bag from the layout's optional navigation
 * callbacks. EndingPanel speaks a different vocabulary than the layout shell
 * (Begin again / See map / Share / Close vs. Return home / Open endings /
 * Open library), so the layout-side names are mapped onto EndingPanel's
 * names here:
 *
 *   layout `onReturnHome`   → EndingPanel `onBeginAgain`
 *   layout `onOpenEndings`  → EndingPanel `onSeeMap`
 *   layout `onOpenLibrary`  → EndingPanel `onClose`
 *
 * `onShareEnding` has no current layout source — the share flow lives in a
 * later wave. Required because the panel's prop types live under
 * `exactOptionalPropertyTypes:true`, so we must omit keys whose value would
 * otherwise be `undefined`.
 */
export function endingPanelHandlers(props: {
  onOpenEndings?: Nav;
  onOpenLibrary?: Nav;
  onReturnHome?: Nav;
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
  if (props.onReturnHome) handlers.onBeginAgain = props.onReturnHome;
  if (props.onOpenEndings) handlers.onSeeMap = props.onOpenEndings;
  if (props.onOpenLibrary) handlers.onClose = props.onOpenLibrary;
  return handlers;
}

/**
 * Build the death-variant prop bag (tier, tone, first-find, cinematic URI)
 * from the layout's projection + the ReaderScreen-resolved props. Keeps
 * `exactOptionalPropertyTypes:true` happy by omitting absent keys rather
 * than passing `undefined`.
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
} {
  const out: {
    tier?: NonNullable<ReaderLayoutProps["endingTier"]>;
    storyTone?: NonNullable<ReaderLayoutProps["projection"]["storyTone"]>;
    cinematicUri?: string;
    isFirstFind?: boolean;
  } = {};
  if (input.tier) out.tier = input.tier;
  if (input.projection.storyTone) out.storyTone = input.projection.storyTone;
  if (input.cinematicUri) out.cinematicUri = input.cinematicUri;
  // TODO(wave-e): replace with a real lookup against `endings_unlocked`.
  // Until then, treat every ending as a first-find so Cinematic remains
  // reachable for eligible tier+asset combinations during Wave C QA.
  if (input.isFirstFind !== undefined) out.isFirstFind = input.isFirstFind;
  return out;
}
