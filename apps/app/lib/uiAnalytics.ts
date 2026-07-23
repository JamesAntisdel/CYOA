/**
 * uiAnalytics — CLIENT half of the minimal UI-event telemetry path.
 *
 * A thin, best-effort wrapper over the canonical `convexHttp` transport that
 * fires anonymous UI-interaction events at the new reading chrome (Tome,
 * StoryRibbon, auto-narrator). It is FIRE-AND-FORGET by construction:
 *
 *   - it never `await`s into the UI — call sites drop the returned promise;
 *   - it swallows ALL transport/server errors (`convexHttp` already resolves
 *     to `null` on failure, and the outer `.catch` guards a rejected transport
 *     stub in tests / an unexpected throw);
 *   - it is a silent no-op when no backend is configured
 *     (`EXPO_PUBLIC_CONVEX_URL` unset — `convexHttp` warns + returns null);
 *   - it NEVER blocks or throws into the render path.
 *
 * PRIVACY: only an anonymous `accountId` (when trivially available) and a flat
 * scalar `payload` (e.g. `{ on: true }`) are sent — never scene text, choice
 * text, or any content/PII. The server half (`convex/uiAnalytics.ts`) bounds
 * and re-sanitizes the payload on top.
 *
 * BC1: `RECORD_UI_EVENT_PATH` is the FULL registered convex path INCLUDING the
 * module prefix (`uiAnalytics:recordUiEvent`) — `convexHttp` does not add one.
 */
import { convexHttp } from "./convexHttp";

/** Full registered convex path — BC1. Exported so tests can pin it. */
export const RECORD_UI_EVENT_PATH = "uiAnalytics:recordUiEvent";

/** The UI events this wrapper emits (kept in lockstep with the call sites). */
export type UiEventName = "ui.tome_open" | "ui.ribbon_expand" | "ui.auto_toggle";

/** A bounded, anonymous payload — flat scalars only (no content, no PII). */
export type UiEventPayload = Record<string, boolean | number | string>;

/**
 * Fire a UI-interaction event, best-effort. Returns a promise that ALWAYS
 * resolves (never rejects) so a call site can safely `void recordUiEvent(...)`.
 * `accountId`, when known, is passed as the sole (anonymous) identifier.
 */
export async function recordUiEvent(
  event: UiEventName,
  payload?: UiEventPayload,
  accountId?: string,
): Promise<void> {
  try {
    await convexHttp("mutation", RECORD_UI_EVENT_PATH, {
      event,
      ...(payload ? { payload } : {}),
      ...(accountId ? { accountId } : {}),
    });
  } catch {
    // Advisory telemetry — swallow every failure (rejected transport,
    // unexpected throw). Never surfaces into the UI.
  }
}
