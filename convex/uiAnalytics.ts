// =============================================================================
// uiAnalytics — SERVER half of the minimal client→server UI-event path.
//
// The new reading UI (Tome, StoryRibbon, auto-narrator) had no measurement
// hook (flagged P3 debt). This module owns exactly ONE public mutation:
//
//   uiAnalytics:recordUiEvent   mutation   (client, best-effort)
//
// It reuses the EXISTING `analytics_events` table (schema.ts) and the
// fire-and-forget insert pattern of `dailyFunctions.insertDailyAnalytics` /
// `analyticsEvents.ts`: build a sanitized row with `buildAnalyticsEvent`
// (which strips any sensitive keys and validates the dotted event name) and
// insert it. The handler is TOLERANT — a malformed event name or a failing
// insert is swallowed and reported as `{ recorded: false }` rather than thrown,
// so a telemetry hiccup never fails a client call. The client half
// (`apps/app/lib/uiAnalytics.ts`) is itself fire-and-forget, so both ends stay
// advisory.
//
// PRIVACY: `payload` is bounded to a FLAT map of scalars (boolean/number/
// string) — no nested objects, no arrays — so callers cannot smuggle content
// blobs, and `buildAnalyticsEvent`'s `sanitizePayload` redacts any sensitive
// keys on top. The only identifier accepted is an optional anonymous
// `accountId`; no scene text, choice text, or prose ever reaches here.
//
// Registers by path automatically as `uiAnalytics:recordUiEvent` — no
// `convex/index.ts` edit, no schema edit (the table already exists).
// =============================================================================

import { mutationGeneric } from "convex/server";
import { v } from "convex/values";

import { buildAnalyticsEvent } from "./analytics";

/**
 * Record ONE anonymous UI-interaction event from the reading client
 * (`ui.tome_open`, `ui.ribbon_expand`, `ui.auto_toggle`, …). Best-effort: the
 * insert is fire-and-forget and NEVER throws into the caller — an invalid event
 * name (rejected by `buildAnalyticsEvent`) or a DB failure resolves to
 * `{ recorded: false }`.
 *
 * `payload` is a flat scalar map (`{ on: true }` for the auto toggle); content
 * and PII must never be sent. `accountId` is the only accepted identifier and
 * is optional (omitted for anonymous readers).
 */
export const recordUiEvent = mutationGeneric({
  args: {
    event: v.string(),
    accountId: v.optional(v.id("accounts")),
    payload: v.optional(
      v.record(v.string(), v.union(v.boolean(), v.number(), v.string())),
    ),
  },
  handler: async (ctx, args): Promise<{ recorded: boolean }> => {
    try {
      await ctx.db.insert(
        "analytics_events",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        buildAnalyticsEvent({
          // The dotted UI event names (`ui.*`) live outside the typed
          // `AnalyticsMetricName` union but pass the builder's runtime
          // dotted-name validator; the cast mirrors `insertDailyAnalytics`.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          eventName: args.event as any,
          ...(args.accountId ? { accountId: args.accountId } : {}),
          payload: args.payload ?? {},
          createdAt: Date.now(),
        }),
      );
      return { recorded: true };
    } catch {
      // Telemetry is advisory — never fail the client call on a bad event
      // name or a transient insert error.
      return { recorded: false };
    }
  },
});
