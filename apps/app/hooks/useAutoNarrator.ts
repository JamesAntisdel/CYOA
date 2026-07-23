/**
 * Reading-modes Wave 1 — Auto-narrator ("the tome reads itself") session hook
 * (R1.1, R1.2, R1.4, R1.6, R1.7).
 *
 * This hook is the ONE client integration point that turns a settled scene into
 * a hands-free page-turn. It rides the EXISTING turn path verbatim — the
 * `submitChoice` a manual tap uses — so every auto-advance is a real, metered
 * `daily_turn_counter` turn (R1.7) and re-entrancy is safe with ZERO change to
 * `useTurn`: `submitChoice` self-guards on `pendingChoiceId` and empties
 * `projection.choices` during flight, and clears `pendingChoiceId` in its
 * `finally` (RM10 / R1.4). We add NO server function, NO schema, NO save field.
 *
 * Session state ONLY (R1.6): `autoOn` defaults OFF and lives in React state on
 * the reader, so it resets to OFF the moment the reader closes (the component
 * unmounts). It is NEVER routed through `useReaderSettings`, which persists to
 * localStorage and round-trips `mediaPrefs` to the server — the auto flag must
 * do neither.
 *
 * The pick policy + pacing constants live in the pure, tested module
 * `components/reading/autoNarrator.ts` (RM-POLICY, task 1.1); this hook only
 * schedules the timer and gates it on the halt guards. The guard/decision logic
 * is factored into the pure, exported `resolveAutoAdvance` so it is unit-tested
 * for real (the React shell around it is a thin timer wrapper).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  autoDelayMs,
  AUTO_SESSION_ADVANCE_CAP,
  pickAutoChoice,
  type AutoNarratorChoice,
} from "../components/reading/autoNarrator";
import { recordUiEvent } from "../lib/uiAnalytics";

/**
 * The halt guards (R1.2). WHEN any is active, auto SHALL NOT fire and control
 * SHALL return to the reader. Each maps to a ReaderScreen-derived fact:
 *   - `isStreaming`       — a turn's prose is still streaming in.
 *   - `pendingChoiceId`   — a choice submission is in flight (`useTurn`).
 *   - `hasEnding`         — the scene is terminal (`projection.ending`).
 *   - `atChapterBoundary` — a chapter interstitial is showing (`chapterBoundary`).
 *   - `candleGuttered`    — the daily candle has guttered (`showCandleGutter`).
 *   - `hasError`          — a turn error is surfaced (`freeformError`), incl. the
 *                           `daily_turns_exhausted` budget rejection (R1.7).
 */
export type AutoAdvanceGuards = {
  isStreaming: boolean;
  pendingChoiceId: string | null;
  hasEnding: boolean;
  atChapterBoundary: boolean;
  candleGuttered: boolean;
  hasError: boolean;
  /**
   * The TTS narration for this scene is currently playing. WHILE it plays, auto
   * SHALL NOT advance — otherwise it skips the page before the reader has heard
   * the narration (the "auto skips the narrator" bug). When narration finishes
   * (`isPlaying` flips false) the guard clears and the normal inter-page pause
   * schedules the advance. Always false when audio is off / no narration clip /
   * on native (narration is web-only), so silent auto-reading keeps the timer.
   */
  isNarrating: boolean;
};

/**
 * The pure decision for one settled render. Total — never throws.
 *   - `off`      — auto is disabled (default).
 *   - `blocked`  — a halt guard is active (R1.2); control stays with the reader.
 *   - `capped`   — the per-session advance cap is reached (R1.9); auto halts.
 *   - `stall`    — every offered choice is locked, so `pickAutoChoice` returned
 *                  `null` (R1.3); auto stalls and hands control back.
 *   - `advance`  — schedule `submitChoice(choice)` after `delayMs`.
 */
export type AutoAdvanceDecision<T> =
  | { kind: "off" }
  | { kind: "blocked" }
  | { kind: "capped" }
  | { kind: "stall" }
  | { kind: "advance"; choice: T; delayMs: number };

/**
 * Resolve whether — and what — auto-narrator should advance this render. Pure
 * and total: no React, no timers, no side effects. The check ORDER matters:
 * `off` and the halt guards short-circuit BEFORE the pick so a locked-out or
 * terminal scene never even runs the policy.
 */
export function resolveAutoAdvance<T extends AutoNarratorChoice>(input: {
  autoOn: boolean;
  choices: readonly T[] | null | undefined;
  guards: AutoAdvanceGuards;
  reducedMotion: boolean;
  advancesThisSession: number;
}): AutoAdvanceDecision<T> {
  if (!input.autoOn) return { kind: "off" };

  const g = input.guards;
  // Any halt guard returns control to the reader (R1.2). `pendingChoiceId`
  // covers the re-entrancy case: a double-fired effect finds a submission in
  // flight and no-ops here (belt) exactly as `submitChoice` no-ops (braces).
  if (
    g.isStreaming ||
    g.pendingChoiceId != null ||
    g.hasEnding ||
    g.atChapterBoundary ||
    g.candleGuttered ||
    g.hasError ||
    g.isNarrating
  ) {
    return { kind: "blocked" };
  }

  // Soft per-session cap so one lean-back session can't silently drain the
  // whole daily allowance (R1.9); the daily budget is the hard throttle (R1.7).
  if (input.advancesThisSession >= AUTO_SESSION_ADVANCE_CAP) {
    return { kind: "capped" };
  }

  const choice = pickAutoChoice(input.choices);
  // Every offered choice is locked (or none are offered) — stall and hand back.
  if (!choice) return { kind: "stall" };

  return { kind: "advance", choice, delayMs: autoDelayMs(input.reducedMotion) };
}

export type UseAutoNarratorParams<T extends AutoNarratorChoice> = {
  /**
   * The settled scene's id — the effect key. A new scene id re-arms the timer;
   * a re-render of the SAME settled scene does not (so the pause never
   * restarts under it).
   */
  sceneId: string;
  /** The offered choices (`projection.choices`) — passed straight to the policy. */
  choices: readonly T[] | null | undefined;
  /**
   * The EXISTING `useTurn` `submitChoice` (RM10) — the identical path a manual
   * tap uses. Auto never wraps or forks it, so the metering + self-guard hold.
   */
  submitChoice: (choice: T) => void | Promise<void>;
  /** Reduced-motion shortens the inter-turn pause and the chapter beat (R1.8/R1.9). */
  reducedMotion: boolean;
  /** The halt guards (R1.2). */
  guards: AutoAdvanceGuards;
  /**
   * Chapter-interstitial behavior (R1.8, OQ8 default = auto-acknowledge). When
   * provided AND auto is ON at a chapter boundary, the hook calls this after a
   * readable beat (reduced-motion shortened) so the read stays hands-free.
   * OQ8 seam: to PAUSE at chapters instead, omit this param — auto simply waits
   * at the interstitial (the boundary is already a halt guard for advances).
   */
  onChapterAdvance?: (() => void) | undefined;
};

export type UseAutoNarratorResult = {
  /** Whether auto-narrator is currently ON (session state, default OFF). */
  autoOn: boolean;
  /** Flip auto ON/OFF — wired to the one-tap reader-chrome affordance (R1.5). */
  toggleAuto: () => void;
  /**
   * Set auto explicitly. ReaderScreen calls `setAutoOn(false)` on a manual
   * choice tap so the reader "grabs the wheel" (R1.5 / OQ8 default).
   */
  setAutoOn: (on: boolean) => void;
};

/**
 * Auto-narrator session state + the timed, guard-gated advance effect (R1).
 */
export function useAutoNarrator<T extends AutoNarratorChoice>({
  sceneId,
  choices,
  submitChoice,
  reducedMotion,
  guards,
  onChapterAdvance,
}: UseAutoNarratorParams<T>): UseAutoNarratorResult {
  // Session state ONLY — defaults OFF, resets OFF on unmount (reader close, R1.6).
  const [autoOn, setAutoOn] = useState(false);
  // Per-session advance tally for the soft cap (R1.9). A ref so it never causes
  // a re-render and survives across settled scenes for the life of the reader.
  const advancesRef = useRef(0);

  // Read the latest `choices`/`submitChoice` via refs so the advance effect
  // depends only on the scene id + guard booleans — NOT on the per-render array
  // identity of `choices`, which would otherwise reset the pause on every
  // render and never let it fire.
  const choicesRef = useRef(choices);
  choicesRef.current = choices;
  const submitRef = useRef(submitChoice);
  submitRef.current = submitChoice;
  const chapterAdvanceRef = useRef(onChapterAdvance);
  chapterAdvanceRef.current = onChapterAdvance;

  const {
    isStreaming,
    pendingChoiceId,
    hasEnding,
    atChapterBoundary,
    candleGuttered,
    hasError,
    isNarrating,
  } = guards;

  // The timed, guard-gated advance effect (R1.1/R1.2). Keyed on the settled
  // scene id and each guard boolean so it re-evaluates whenever a guard flips
  // (e.g. streaming completes, `pendingChoiceId` clears) and re-arms on each
  // new scene. Cleanup clears the pending timer, so a guard flip or scene
  // change cancels an un-fired advance.
  useEffect(() => {
    const decision = resolveAutoAdvance({
      autoOn,
      choices: choicesRef.current,
      guards: {
        isStreaming,
        pendingChoiceId,
        hasEnding,
        atChapterBoundary,
        candleGuttered,
        hasError,
        isNarrating,
      },
      reducedMotion,
      advancesThisSession: advancesRef.current,
    });
    if (decision.kind !== "advance") return;

    const pick = decision.choice;
    const timer = setTimeout(() => {
      advancesRef.current += 1;
      // Re-entrancy: `submitChoice` self-guards on `pendingChoiceId` + empty
      // choices (RM10), so even a stray double-fire no-ops on the turn path.
      void submitRef.current(pick);
    }, decision.delayMs);
    return () => clearTimeout(timer);
  }, [
    autoOn,
    sceneId,
    isStreaming,
    pendingChoiceId,
    hasEnding,
    atChapterBoundary,
    candleGuttered,
    hasError,
    isNarrating,
    reducedMotion,
  ]);

  // Chapter-interstitial behavior (R1.8, OQ8 default = auto-acknowledge). A
  // separate effect so it is independent of the advance timer: at a boundary
  // the advance effect is halted (`atChapterBoundary` guard), and this one
  // schedules the acknowledgement after a readable beat. Reduced-motion
  // shortens the beat. Omitting `onChapterAdvance` (the OQ8 seam) makes auto
  // simply pause at the interstitial.
  useEffect(() => {
    if (!autoOn || !atChapterBoundary) return;
    const ack = chapterAdvanceRef.current;
    if (!ack) return;
    const timer = setTimeout(() => {
      ack();
    }, autoDelayMs(reducedMotion));
    return () => clearTimeout(timer);
  }, [autoOn, atChapterBoundary, reducedMotion]);

  // Best-effort telemetry: emit `ui.auto_toggle {on}` whenever `autoOn` flips
  // (P3 UI-event path). Watching the state — rather than the setters — catches
  // every path uniformly: the one-tap `toggleAuto` AND ReaderScreen's
  // `setAutoOn(false)` "grab the wheel". `prevAutoRef` seeds to the initial
  // value so the mount render (default OFF) does NOT fire. Fire-and-forget —
  // `recordUiEvent` never throws into the effect.
  const prevAutoRef = useRef(autoOn);
  useEffect(() => {
    if (prevAutoRef.current === autoOn) return;
    prevAutoRef.current = autoOn;
    void recordUiEvent("ui.auto_toggle", { on: autoOn });
  }, [autoOn]);

  const toggleAuto = useCallback(() => {
    setAutoOn((on) => !on);
  }, []);

  return useMemo(
    () => ({ autoOn, toggleAuto, setAutoOn }),
    [autoOn, toggleAuto],
  );
}
