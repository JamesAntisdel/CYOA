// Pure motion helpers for the stat-pip "receipt" mark.
//
// Lifted from CYOA Wireframes (§ Stats_Contextual):
//   "↳ pip fades after 3s. tap ≡ to see all."
//
// Kept in a standalone module (no React Native imports) so the timeline and
// accessibility label can be unit-tested without a renderer.

export const PIP_DEFAULT_HOLD_MS = 3000;
export const PIP_FADE_IN_MS = 180;
export const PIP_FADE_OUT_MS = 480;

export type StatPipTimeline = {
  fadeInMs: number;
  holdMs: number;
  fadeOutMs: number;
  totalMs: number;
};

/**
 * Resolve the timeline a StatPip will follow given the current
 * reduced-motion preference. With reduced motion we collapse the fade-in /
 * fade-out animations to zero and keep only the hold window so the receipt
 * still self-dismisses cleanly without an animated transition.
 */
export function resolveStatPipTimeline(input: {
  holdMs?: number;
  reducedMotion: boolean;
}): StatPipTimeline {
  const hold = input.holdMs ?? PIP_DEFAULT_HOLD_MS;
  if (input.reducedMotion) {
    return { fadeInMs: 0, holdMs: hold, fadeOutMs: 0, totalMs: hold };
  }
  const holdSlice = Math.max(0, hold - PIP_FADE_OUT_MS);
  return {
    fadeInMs: PIP_FADE_IN_MS,
    holdMs: holdSlice,
    fadeOutMs: PIP_FADE_OUT_MS,
    totalMs: PIP_FADE_IN_MS + holdSlice + PIP_FADE_OUT_MS,
  };
}

/**
 * Compose the receipt label as it should appear to assistive tech. The
 * label is rendered with `accessibilityLiveRegion="polite"` on the pip so
 * screen readers announce the change without interrupting the player.
 */
export function formatStatPipAccessibilityLabel(input: {
  label: string;
  delta: number;
  value?: number | undefined;
}): string {
  const direction = input.delta < 0 ? "decreased" : "increased";
  const magnitude = Math.abs(input.delta);
  const valueSuffix = typeof input.value === "number" ? ` (now ${input.value})` : "";
  return `${input.label} ${direction} by ${magnitude}${valueSuffix}`;
}
