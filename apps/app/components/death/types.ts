import type { ReaderProjection } from "../../hooks/useTurn";
import type { PatronTier } from "../../lib/billingConfig";

export type EndingTone = "brutal" | "bookish";

export type DeathVariantKind = "brutal" | "bookish" | "cinematic";

/**
 * Ending shape consumed by death variants. Mirrors the
 * `ReaderProjection.ending` projection from the read loop.
 */
export type EndingProjection = NonNullable<ReaderProjection["ending"]>;

/**
 * Common props every death variant accepts. Most are optional so
 * callers that only have a minimal ending payload (the current
 * `useTurn` projection) keep working.
 */
export type DeathVariantProps = {
  ending: EndingProjection;
  /** Turn the ending fired on, when available. */
  turnNumber?: number | undefined;
  /** Number of player choices made in the run, for Bookish footer. */
  choicesMade?: number | undefined;
  /** 1-indexed position of this ending in the crypt, when known. */
  endingNumber?: number | undefined;
  /** Total number of endings authored for the story, when known. */
  endingsTotal?: number | undefined;
  /** Whether the save was a hardcore-mode run. */
  hardcore?: boolean | undefined;
  /** Veo cinematic asset URI for `Cinematic`. */
  cinematicUri?: string | undefined;
  /** Honour reader's reduced-motion preference. */
  reducedMotion?: boolean | undefined;
  onBeginAgain?: (() => void) | undefined;
  onSeeMap?: (() => void) | undefined;
  onShareEnding?: (() => void) | undefined;
};

/**
 * Inputs that drive `selectDeathVariant`.
 */
export type DeathVariantSelectionInput = {
  /** Resolved tier for the account. */
  tier: Pick<PatronTier, "canPlayCinematicDeath">;
  /** Whether this is the first time *this account* has hit this ending. */
  isFirstFind: boolean;
  /** Whether a Veo cinematic asset is actually ready to play. */
  cinematicAvailable: boolean;
  /** Story-author tonal hint. Bone Cathedral / Iron Court → bookish. */
  storyTone?: EndingTone | undefined;
  /** Engine ending kind. Only `death` is eligible for Cinematic. */
  endingKind: EndingProjection["kind"];
};
