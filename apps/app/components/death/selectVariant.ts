import type {
  DeathVariantKind,
  DeathVariantSelectionInput,
} from "./types";

/**
 * Decide which death variant to render.
 *
 * Rules:
 * 1. Cinematic is reserved for death endings, first-find, with a ready
 *    Veo asset, on a tier that allows cinematic playback (Magus / Pro).
 * 2. Otherwise, tonal stories render Bookish.
 * 3. Brutal is the default fallback (and the explicit choice for death
 *    endings where the story tone isn't marked bookish).
 *
 * Pure function. Selection logic lives here so it can be unit-tested
 * without rendering React Native.
 */
export function selectDeathVariant(input: DeathVariantSelectionInput): DeathVariantKind {
  const cinematicEligible =
    input.endingKind === "death" &&
    input.isFirstFind &&
    input.cinematicAvailable &&
    input.tier.canPlayCinematicDeath;

  if (cinematicEligible) return "cinematic";
  if (input.storyTone === "bookish") return "bookish";
  return "brutal";
}
