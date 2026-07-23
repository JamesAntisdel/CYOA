import type { SetReadingModeResult } from "./gameApi";
import type { ReadingMode } from "./readingMode";

/**
 * Reading-modes cleanup (SWITCH-UX #7) — the pure result→action decision for a
 * reading-mode switch, extracted out of `ReaderScreen.handleSwitchReadingMode`
 * so every arm is unit-testable without mounting the reader.
 *
 * The component keeps only the thin wiring: it awaits the server seam
 * (`gameApi.setReadingMode`) and dispatches on the {@link ReadingModeRouteAction}
 * this returns —
 *   - `confirm` → surface the quiet "takes effect on the next page" note (the
 *     current scene keeps its shape; the new mode arrives with the next page);
 *   - `paywall` → close any open sheet, then route to the Pro paywall;
 *   - `noop`    → do nothing (not a real remote save, or a benign server reject).
 */
export type ReadingModeRouteAction =
  | { kind: "confirm"; mode: ReadingMode }
  | { kind: "paywall" }
  | { kind: "noop" };

/**
 * Map a {@link SetReadingModeResult} (or `null`, when no remote backend is
 * wired / the save is a local demo) to the action the reader should take.
 *
 *   ok                      → confirm (mode the switch moved TO)
 *   needs_pro               → paywall (Novel is Pro-gated)
 *   not_found | unauthorized→ noop (benign server reject — never a dead-end UI)
 *   null                    → noop (no real Convex saves row)
 */
export function routeReadingModeResult(
  result: SetReadingModeResult | null,
): ReadingModeRouteAction {
  if (!result) return { kind: "noop" };
  if (result.ok) return { kind: "confirm", mode: result.mode };
  if (result.reason === "needs_pro") return { kind: "paywall" };
  // not_found / unauthorized → quiet no-op (the switch simply didn't land).
  return { kind: "noop" };
}
