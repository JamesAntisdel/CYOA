import type {
  DeathVariantKind,
  DeathVariantSelectionInput,
} from "./types";

/**
 * Decide which death variant to render.
 *
 * Rules:
 * 1. Cinematic is reserved for death endings (`endingKind === "death"`),
 *    first-find, with a ready Veo asset, on a tier that allows cinematic
 *    playback (Magus / Pro).
 * 2. Bookish — quiet manuscript-style close — is chosen when the story
 *    tone is marked bookish, OR when the engine ending is anything other
 *    than `death` (success / safe / other). Non-death endings must never
 *    render the danger-painted Brutal "You died" surface per the Ember
 *    Rule + product principle "safe closure is available."
 * 3. Brutal is the explicit choice ONLY for `endingKind === "death"`
 *    endings whose story tone isn't bookish — it's the canonical death
 *    surface.
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
  if (input.endingKind !== "death") return "bookish";
  return "brutal";
}
