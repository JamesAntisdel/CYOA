/**
 * Open-book spread (R6) — the decorative page-turn driver.
 *
 * Two exports:
 *  - `shouldAnimatePageTurn(reducedMotion)` — a PURE, TOTAL predicate: under
 *    reduced-motion the turn is an INSTANT swap (R6.2 — no partial or alternate
 *    motion). No React/React Native, so the layout that uses the driver and the
 *    `.test.mjs` that pins the matrix import the SAME source of truth.
 *  - `usePageTurnDriver(reducedMotion)` — a small Animated curl/slide the Spread
 *    binds to the turning recto/verso. It is DECORATIVE: the caller submits the
 *    turn FIRST, then calls `animate()` purely for paint, so the transition
 *    never blocks or delays the actual turn submission (R6.3). Under
 *    reduced-motion `animate()` is a no-op and the swap is instant.
 *
 * Mirrors the `pageTurn.ts` discipline: the pure predicate stands alone so the
 * behavior is testable without a renderer.
 */
import { useCallback, useRef } from "react";
import { Animated, Easing } from "react-native";

/** Curl/slide duration for the decorative page-turn (ms). */
export const PAGE_TURN_DURATION_MS = 420;

/**
 * Whether the page-turn should animate. Reduced-motion returns false so the
 * caller performs an instant swap (R6.2). PURE + TOTAL — never throws.
 */
export function shouldAnimatePageTurn(reducedMotion: boolean): boolean {
  return !reducedMotion;
}

export type PageTurnDriver = {
  /**
   * Animated style to spread onto the turning page (`<Animated.View>`). A
   * gentle rightward curl (rotateY) + inward slide + a dip in opacity, all
   * driven by one Animated value on the native driver.
   */
  readonly style: {
    readonly transform: ReadonlyArray<Record<string, Animated.AnimatedInterpolation<string | number>>>;
    readonly opacity: Animated.AnimatedInterpolation<number>;
  };
  /**
   * Kick the decorative curl/slide. NEVER blocks the turn: the caller submits
   * the choice first, then calls this purely for paint (R6.3). Under
   * reduced-motion it is a no-op (the swap is instant — R6.2).
   */
  readonly animate: () => void;
};

/**
 * The Animated page-turn driver. Returns a style to bind to the turning page
 * and an `animate()` that curls-and-settles a single Animated value. The value
 * returns to 0 after the curl so the next scene (swapped in underneath by the
 * turn) reads flat — the motion is a flourish over the existing streaming turn,
 * not a gate on it.
 */
export function usePageTurnDriver(reducedMotion: boolean): PageTurnDriver {
  const progress = useRef(new Animated.Value(0)).current;

  const animate = useCallback(() => {
    // Reduced-motion: instant swap, no partial motion (R6.2).
    if (!shouldAnimatePageTurn(reducedMotion)) return;
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: PAGE_TURN_DURATION_MS,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      // Settle flat so the freshly-swapped scene isn't left mid-curl.
      progress.setValue(0);
    });
  }, [progress, reducedMotion]);

  const style = {
    transform: [
      {
        perspective: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [900, 900],
        }),
      },
      {
        rotateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: ["0deg", "-16deg"],
        }),
      },
      {
        translateX: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -20],
        }),
      },
    ],
    opacity: progress.interpolate({
      inputRange: [0, 0.6, 1],
      outputRange: [1, 0.86, 1],
    }),
  };

  return { style, animate };
}
