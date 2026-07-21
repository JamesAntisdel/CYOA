import { useWindowDimensions } from "react-native";

/**
 * Shared responsive breakpoint helper.
 *
 * Mobile reflow agents own different owned-file lists but need to make the
 * same kind of "stack columns under 520px" decision. Rather than each one
 * inlining its own `width < 520` threshold (and drifting apart over time),
 * every owned file imports `useBreakpoint()` from here.
 *
 * Breakpoints:
 *   - phone:   width <  520  — every 2-column or row-flex pattern stacks.
 *   - tablet:  520 ≤ width < 768 — 2-column patterns are still viable but
 *              hero / story-card images shrink. Pick whichever direction
 *              reads best for the surface.
 *   - desktop: width ≥ 768 — original side-by-side layouts.
 *
 * The `desktop` flag (≥ 768) is enough for a single wide column but NOT for
 * two facing pages. The open-book spread (OB2) therefore adds its own,
 * wider threshold — `SPREAD_MIN = 1024` — surfaced as `isWide`. `desktop`
 * is unchanged; `isWide` is a strictly-narrower slice of it.
 *
 * Use the convenience flags (`isPhone`, `isTabletOrLarger`, etc.) at call
 * sites — they keep render bodies readable and the inequality direction
 * consistent across files. The raw `width` is also returned for the rare
 * case a caller needs a fluid value (e.g. `maxWidth: Math.min(width, 540)`).
 */
export type Breakpoint = "phone" | "tablet" | "desktop";

export const BREAKPOINTS = {
  phone: 520,
  tablet: 768,
} as const;

/**
 * The open-book two-page spread thresholds (open-book spec, OB2).
 *
 *   - `SPREAD_MIN` (1024) — the minimum width at which the reader auto-selects
 *     the two-page `spread` layout. Deliberately WIDER than `isDesktop`'s 768:
 *     two facing pages need real horizontal room, not just a wide column.
 *   - `SPREAD_MAX` (1400) — the centered cap for the whole spread so it never
 *     stretches edge-to-edge on an ultrawide monitor (R2.2). Consumed by the
 *     Spread layout (Wave 2); exported here so the constant has a single home.
 */
export const SPREAD_MIN = 1024;
export const SPREAD_MAX = 1400;

export type BreakpointInfo = {
  breakpoint: Breakpoint;
  width: number;
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  /** True when the surface should fold 2-column layouts into a single column. */
  isPhoneOrTablet: boolean;
  /** True when the surface has the horizontal real estate for side-by-side rows. */
  isTabletOrLarger: boolean;
  /**
   * True when the viewport is wide enough for the open-book two-page spread
   * (width ≥ `SPREAD_MIN`). A strictly-narrower slice of `isDesktop`.
   */
  isWide: boolean;
};

export function breakpointFor(width: number): Breakpoint {
  if (width < BREAKPOINTS.phone) return "phone";
  if (width < BREAKPOINTS.tablet) return "tablet";
  return "desktop";
}

/** Whether the viewport can host the two-page spread (open-book OB2). */
export function isWideWidth(width: number): boolean {
  return width >= SPREAD_MIN;
}

/**
 * Pure reader-layout selection — the load-bearing wide/phone auto-override
 * extracted from ReaderScreen's `resolveActiveLayout` so the full selection
 * matrix (phone / 768–1023 / ≥1024 × explicit-override × stored layout) is
 * unit-testable without a DOM or localStorage. Free of side effects: the
 * caller reads the explicit-override flag from storage and passes it in,
 * along with the concrete `mobile`/`spread` variant names.
 *
 * Precedence (open-book R1.2–R1.4, mirroring today's phone→mobile override):
 *   1. An explicit reader pick ALWAYS wins, at any width.
 *   2. Otherwise phone → the mobile variant (applies FIRST — unchanged).
 *   3. Otherwise width ≥ SPREAD_MIN → the spread variant (NEW).
 *   4. Otherwise (tablet / 768–1023) → the stored layout, exactly as today.
 */
export function selectReaderLayout<T extends string>(params: {
  storedLayout: T;
  isPhone: boolean;
  width: number;
  hasExplicitOverride: boolean;
  mobileVariant: T;
  spreadVariant: T;
}): T {
  const { storedLayout, isPhone, width, hasExplicitOverride, mobileVariant, spreadVariant } = params;
  if (hasExplicitOverride) return storedLayout;
  if (isPhone) return mobileVariant;
  if (width >= SPREAD_MIN) return spreadVariant;
  return storedLayout;
}

export function useBreakpoint(): BreakpointInfo {
  const { width } = useWindowDimensions();
  const breakpoint = breakpointFor(width);
  return {
    breakpoint,
    width,
    isPhone: breakpoint === "phone",
    isTablet: breakpoint === "tablet",
    isDesktop: breakpoint === "desktop",
    isPhoneOrTablet: breakpoint !== "desktop",
    isTabletOrLarger: breakpoint !== "phone",
    isWide: width >= SPREAD_MIN,
  };
}
