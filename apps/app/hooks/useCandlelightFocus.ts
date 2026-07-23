/**
 * "Candlelight Focus" immersion mode (phase-2 idea, quick-win slice).
 *
 * After IDLE_MS (~4s) of NO user input while actively reading, the reader's
 * CHROME — the ReaderTopBar + StoryRibbon — fades to opacity 0 so the prose
 * sits alone in the light. ANY input (pointer move / touch / key / scroll /
 * wheel) restores it INSTANTLY. The prose and the choice row NEVER fade — only
 * the chrome. This is a lean-back companion to the auto-narrator: nothing is
 * hidden that a single touch doesn't bring straight back.
 *
 * DESIGN
 *   - The decision — "given idle + the guards, should the chrome be faded?" —
 *     is the PURE, exported `computeChromeFaded`, unit-tested as a matrix. The
 *     React shell below only owns the idle timer, the DOM input listeners, and
 *     the Animated opacity value; it defers every gating call to the pure fn.
 *   - GUARDS (the chrome NEVER fades while any is active): a sheet/drawer is
 *     open, a chapter boundary or ending is showing, the candle gutter or the
 *     soft-signup ribbon is up, or a turn is streaming in. When a guard flips
 *     on we restore the chrome and disarm; when it clears we re-arm the idle
 *     countdown fresh. All are ReaderScreen facts already in scope.
 *   - REDUCED MOTION (R): no fade ANIMATION. The fade-out SNAPS opacity to 0
 *     instead of tweening; the restore is instant either way. Honors the
 *     reader's `reduceMotion` (theme OR settings).
 *   - RESTORE IS INSTANT (mini-spec): activity always snaps opacity back to 1,
 *     never tweens in — only the fade-OUT is the slow candlelight dim.
 *
 * PLATFORM
 *   Input detection is DOM-only (web reader): we attach CAPTURE-phase listeners
 *   on `window` so even non-bubbling `scroll` events on the inner ScrollView
 *   reach us. Without a DOM event target (native), the feature is INERT — we
 *   never fade, because there is no global input signal to restore from. The
 *   reader is web-first, so this is the pragmatic quick-win surface.
 *
 * This hook adds NO server function, NO schema, NO save field — it is pure
 * client chrome. Session-independent: it reads the persisted `focusMode`
 * setting and the live guards, nothing else.
 */
import { useEffect, useRef, useState } from "react";
import { Animated } from "react-native";

/** Idle threshold before the chrome fades (mini-spec ~4000ms). */
export const FOCUS_IDLE_MS = 4000;
/** Slow candlelight fade-OUT duration (the dim). Restore is always instant. */
export const FOCUS_FADE_OUT_MS = 600;

/**
 * The guards under which the chrome must STAY lit (never fade). Each maps to a
 * ReaderScreen-derived fact:
 *   - `anySheetOpen`        — the Tome sheet, settings drawer, or report picker
 *                             is open (tomeOpen || drawerOpen || flagOpen).
 *   - `atChapterBoundary`   — a chapter interstitial is showing (chapterBoundary).
 *   - `atEnding`            — the scene is terminal (projection.ending).
 *   - `candleGutterShown`   — the daily candle-gutter interstitial is up.
 *   - `softSignupShown`     — the turn-3 soft-signup ribbon is showing.
 *   - `isStreaming`         — a turn's prose is still streaming in.
 */
export type FocusGuards = {
  anySheetOpen: boolean;
  atChapterBoundary: boolean;
  atEnding: boolean;
  candleGutterShown: boolean;
  softSignupShown: boolean;
  isStreaming: boolean;
};

/** True when ANY guard is active — the chrome must stay lit. Pure + total. */
export function focusGuardActive(guards: FocusGuards): boolean {
  return (
    guards.anySheetOpen ||
    guards.atChapterBoundary ||
    guards.atEnding ||
    guards.candleGutterShown ||
    guards.softSignupShown ||
    guards.isStreaming
  );
}

/**
 * The ONE decision: should the chrome be faded to 0 right now? Pure + total.
 *   - focusMode OFF                    → false (feature disabled; chrome lit).
 *   - any guard active                 → false (chrome stays lit).
 *   - otherwise                        → mirror `idle` (faded iff idle elapsed).
 * Motion-agnostic: reduced-motion changes HOW we reach opacity 0 (snap vs.
 * tween), never WHETHER — so the matrix is identical for both.
 */
export function computeChromeFaded(input: {
  focusMode: boolean;
  idle: boolean;
  guards: FocusGuards;
}): boolean {
  if (!input.focusMode) return false;
  if (focusGuardActive(input.guards)) return false;
  return input.idle;
}

/** The DOM inputs that count as "the reader is here" and restore the chrome. */
const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
] as const;

type DomTarget = {
  addEventListener: (t: string, l: () => void, o?: unknown) => void;
  removeEventListener: (t: string, l: () => void, o?: unknown) => void;
};

/**
 * The global DOM event target (web `window`), or null on native / SSR. When
 * null the feature is inert — there is no input signal to restore from, so we
 * never fade.
 */
function getEventTarget(): DomTarget | null {
  const g = globalThis as { window?: unknown };
  const w = g.window as DomTarget | undefined;
  if (w && typeof w.addEventListener === "function" && typeof w.removeEventListener === "function") {
    return w;
  }
  return null;
}

export type UseCandlelightFocusParams = {
  /** The persisted `focusMode` setting — the master on/off. */
  enabled: boolean;
  /** Reduced-motion (theme OR settings) — snaps the fade instead of tweening. */
  reducedMotion: boolean;
  /** The live guards from ReaderScreen. */
  guards: FocusGuards;
  /** Idle threshold override (tests). Defaults to `FOCUS_IDLE_MS`. */
  idleMs?: number;
};

export type UseCandlelightFocusResult = {
  /** Animated opacity for the chrome wrapper (1 = lit, 0 = faded). */
  chromeOpacity: Animated.Value;
  /**
   * Whether the chrome is currently faded out. Drives `pointerEvents` on the
   * wrapper so an INVISIBLE control never eats a tap — the tap passes through
   * to the prose and the same gesture restores the chrome.
   */
  faded: boolean;
};

/**
 * Candlelight-focus session hook. Owns the idle timer, the DOM input listeners,
 * and the Animated opacity; every gating call defers to `computeChromeFaded`.
 */
export function useCandlelightFocus({
  enabled,
  reducedMotion,
  guards,
  idleMs = FOCUS_IDLE_MS,
}: UseCandlelightFocusParams): UseCandlelightFocusResult {
  // Eligible = the feature is on AND no guard is holding the chrome lit. All
  // idle machinery lives ONLY while eligible; a guard flip tears it down.
  const eligible = enabled && !focusGuardActive(guards);

  const [faded, setFaded] = useState(false);
  const fadedRef = useRef(false);
  fadedRef.current = faded;

  // One Animated value for the life of the hook; opacity follows `faded`.
  const opacityRef = useRef<Animated.Value | null>(null);
  if (opacityRef.current === null) opacityRef.current = new Animated.Value(1);
  const opacity = opacityRef.current;

  // Idle machinery: attach input listeners + arm the countdown WHILE eligible.
  // Re-runs when eligibility flips (guard on/off) or the threshold changes.
  useEffect(() => {
    if (!eligible) {
      setFaded(false);
      return;
    }
    const target = getEventTarget();
    // Native / SSR — no global input to restore from, so never fade (inert).
    if (!target) {
      setFaded(false);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setFaded(true), idleMs);
    };
    const onActivity = () => {
      // Instant restore, then re-arm the idle countdown from zero.
      if (fadedRef.current) setFaded(false);
      schedule();
    };

    schedule();
    for (const ev of ACTIVITY_EVENTS) {
      target.addEventListener(ev, onActivity, { capture: true, passive: true });
    }
    return () => {
      if (timer) clearTimeout(timer);
      for (const ev of ACTIVITY_EVENTS) {
        target.removeEventListener(ev, onActivity, { capture: true });
      }
    };
  }, [eligible, idleMs]);

  // Opacity follows `faded`. Restore is ALWAYS instant (only the dim is slow);
  // reduced-motion snaps the dim too (no animation).
  useEffect(() => {
    if (!faded) {
      opacity.setValue(1);
      return;
    }
    if (reducedMotion) {
      opacity.setValue(0);
      return;
    }
    const animation = Animated.timing(opacity, {
      toValue: 0,
      duration: FOCUS_FADE_OUT_MS,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [faded, reducedMotion, opacity]);

  return { chromeOpacity: opacity, faded };
}
