import type { JSX } from "react";
import { useEffect, useMemo, useRef } from "react";

import { useAppTheme } from "../../theme";
import { PATRON_TIERS_BY_ID, type PatronTier } from "../../lib/billingConfig";
import { Brutal } from "./variants/Brutal";
import { Bookish } from "./variants/Bookish";
import { Cinematic } from "./variants/Cinematic";
import { selectDeathVariant } from "./selectVariant";
import type {
  DeathVariantKind,
  DeathVariantProps,
  EndingProjection,
  EndingTone,
} from "./types";

type EndingPanelProps = {
  ending: EndingProjection;
  /** Resolved patron tier. Defaults to Wanderer (no cinematic). */
  tier?: PatronTier | undefined;
  /**
   * Story tonal hint. Tonal manuscript stories (Bone Cathedral) render
   * Bookish; the default is Brutal.
   */
  storyTone?: EndingTone | undefined;
  /**
   * Whether this is the first time the current account has seen this
   * ending. The dispatcher will only fire Cinematic on a true value
   * and will fall back to Brutal otherwise — preventing a re-play of
   * an already-seen Veo death.
   */
  isFirstFind?: boolean | undefined;
  /** Veo asset URI. When absent, Cinematic falls back to Brutal. */
  cinematicUri?: string | undefined;
  /**
   * Variant override. Tests and storybook surfaces can force a specific
   * variant regardless of selection logic.
   */
  forceVariant?: DeathVariantKind | undefined;
  turnNumber?: number | undefined;
  choicesMade?: number | undefined;
  endingNumber?: number | undefined;
  endingsTotal?: number | undefined;
  hardcore?: boolean | undefined;
  reducedMotion?: boolean | undefined;
  onBeginAgain?: (() => void) | undefined;
  onSeeMap?: (() => void) | undefined;
  onShareEnding?: (() => void) | undefined;
  /** Notification when Cinematic has actually been rendered to a viewer. */
  onCinematicSeen?: ((endingId: string) => void) | undefined;
  /** Legacy close handler used by older callers; rendered as "Begin again". */
  onClose?: (() => void) | undefined;
};

const VARIANTS: Record<
  DeathVariantKind,
  (props: DeathVariantProps) => JSX.Element
> = {
  brutal: Brutal,
  bookish: Bookish,
  cinematic: Cinematic,
};

export function EndingPanel({
  ending,
  tier = PATRON_TIERS_BY_ID.wanderer,
  storyTone,
  isFirstFind = false,
  cinematicUri,
  forceVariant,
  turnNumber,
  choicesMade,
  endingNumber,
  endingsTotal,
  hardcore,
  reducedMotion,
  onBeginAgain,
  onSeeMap,
  onShareEnding,
  onCinematicSeen,
  onClose,
}: EndingPanelProps) {
  const { reduceMotion } = useAppTheme();

  const variant: DeathVariantKind = useMemo(() => {
    if (forceVariant) return forceVariant;
    return selectDeathVariant({
      tier,
      isFirstFind,
      cinematicAvailable: typeof cinematicUri === "string" && cinematicUri.length > 0,
      storyTone,
      endingKind: ending.kind,
    });
  }, [
    cinematicUri,
    ending.kind,
    forceVariant,
    isFirstFind,
    storyTone,
    tier,
  ]);

  // Once Cinematic has actually rendered for an ending, surface the
  // event upward so the caller can mark this ending as "seen" and
  // avoid replaying the Veo cinematic next time.
  const seenRef = useRef<string | null>(null);
  useEffect(() => {
    if (variant !== "cinematic") return;
    if (seenRef.current === ending.title) return;
    seenRef.current = ending.title;
    onCinematicSeen?.(ending.title);
  }, [ending.title, onCinematicSeen, variant]);

  const Variant = VARIANTS[variant];

  const beginAgain = onBeginAgain ?? onClose;
  const variantProps: DeathVariantProps = {
    ending,
    reducedMotion: reducedMotion ?? reduceMotion,
    ...(cinematicUri !== undefined ? { cinematicUri } : {}),
    ...(turnNumber !== undefined ? { turnNumber } : {}),
    ...(choicesMade !== undefined ? { choicesMade } : {}),
    ...(endingNumber !== undefined ? { endingNumber } : {}),
    ...(endingsTotal !== undefined ? { endingsTotal } : {}),
    ...(hardcore !== undefined ? { hardcore } : {}),
    ...(beginAgain !== undefined ? { onBeginAgain: beginAgain } : {}),
    ...(onSeeMap !== undefined ? { onSeeMap } : {}),
    ...(onShareEnding !== undefined ? { onShareEnding } : {}),
  };

  return <Variant {...variantProps} />;
}
