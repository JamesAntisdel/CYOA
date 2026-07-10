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
};

export function breakpointFor(width: number): Breakpoint {
  if (width < BREAKPOINTS.phone) return "phone";
  if (width < BREAKPOINTS.tablet) return "tablet";
  return "desktop";
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
  };
}
