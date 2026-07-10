// Registered Convex query for the operator dashboard (Requirement 27.1–27.5).
//
// Security shape:
//   1. `assertAccountSessionAccess` proves the caller actually owns the
//      account row they claim (guest token proof or auth identity) — this runs
//      BEFORE any admin logic, so passing a known admin's accountId without the
//      matching credential is rejected outright.
//   2. `buildOperatorDashboard` (from ./analytics) runs `requireAdminDashboard`
//      internally and throws `admin_required` before returning any aggregated
//      operator data. No metrics are computed or returned for a non-admin.
//
// The heavy lifting (funnel / cost / safety / live aggregation) lives in the
// already-tested ./analytics helpers. This file is a thin registered wrapper
// plus two pure, unit-tested helpers (`mapAnalyticsDocToRecord`,
// `buildOperatorDashboardForAccount`).

import { queryGeneric } from "convex/server";
import { v } from "convex/values";

import {
  buildOperatorDashboard,
  type AnalyticsEventRecord,
  type AnalyticsMetricName,
  type OperatorDashboard,
} from "./analytics";
import { loadAndAuthorizeAccount, type AccountLike } from "./lib/authz";
import { accountFromDoc } from "./lib/docs";

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

// Cap how many analytics rows a single dashboard read scans so an admin query
// can't fan out unbounded on a busy deployment. The 24h window plus this cap
// keep the read bounded; older rows fall outside the funnel/cost/live math
// anyway.
export const OPERATOR_DASHBOARD_MAX_EVENTS = 5000;

/**
 * Coerce a raw `analytics_events` document into the plain `AnalyticsEventRecord`
 * shape the ./analytics aggregators expect. Stringifies Convex Ids and drops
 * absent optionals so the record matches what `buildAnalyticsEvent` produces.
 * Pure — unit-tested in convex/tests/operatorDashboard.test.ts.
 */
export function mapAnalyticsDocToRecord(doc: Record<string, unknown>): AnalyticsEventRecord {
  return {
    ...(doc.accountId === undefined || doc.accountId === null ? {} : { accountId: String(doc.accountId) }),
    ...(doc.saveId === undefined || doc.saveId === null ? {} : { saveId: String(doc.saveId) }),
    ...(doc.taleId === undefined || doc.taleId === null ? {} : { taleId: String(doc.taleId) }),
    ...(doc.roomId === undefined || doc.roomId === null ? {} : { roomId: String(doc.roomId) }),
    eventName: doc.eventName as AnalyticsMetricName,
    ...(doc.storyId === undefined ? {} : { storyId: doc.storyId as string }),
    ...(doc.turnNumber === undefined ? {} : { turnNumber: doc.turnNumber as number }),
    ...(doc.provider === undefined ? {} : { provider: doc.provider as AnalyticsEventRecord["provider"] }),
    payload: (doc.payload as Record<string, unknown>) ?? {},
    redacted: doc.redacted === true,
    createdAt: (doc.createdAt as number) ?? 0,
    // Cast: the conditional spreads above omit absent optionals at runtime, but
    // TS widens them to `T | undefined` under exactOptionalPropertyTypes.
  } as AnalyticsEventRecord;
}

/**
 * Pure core of the operator dashboard: map raw analytics docs to records and
 * delegate to `buildOperatorDashboard`, which enforces the admin gate before
 * returning anything. Throws `admin_required` (via `requireAdminDashboard`)
 * for a non-admin account. Unit-tested independently of Convex.
 */
export function buildOperatorDashboardForAccount(input: {
  account: AccountLike | null | undefined;
  docs: Array<Record<string, unknown>>;
  now: number;
  windowMs?: number;
}): OperatorDashboard {
  return buildOperatorDashboard({
    account: input.account,
    events: input.docs.map(mapAnalyticsDocToRecord),
    now: input.now,
    ...(input.windowMs === undefined ? {} : { windowMs: input.windowMs }),
  });
}

export const getOperatorDashboard = queryGeneric({
  args: {
    accountId: v.id("accounts"),
    guestTokenHash: v.optional(v.string()),
    windowMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<OperatorDashboard> => {
    // Ownership gate FIRST — never leak admin status of an arbitrary id.
    const account = await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);

    const now = Date.now();
    const windowMs = args.windowMs ?? DEFAULT_WINDOW_MS;
    const from = now - windowMs;

    // Read only the window we need, newest first, capped.
    const docs = await ctx.db
      .query("analytics_events")
      .withIndex("by_createdAt", (q: any) => q.gte("createdAt", from))
      .order("desc")
      .take(OPERATOR_DASHBOARD_MAX_EVENTS);

    // Admin gate runs inside buildOperatorDashboardForAccount →
    // buildOperatorDashboard → requireAdminDashboard, before any data returns.
    return buildOperatorDashboardForAccount({
      account: accountFromDoc(account),
      docs,
      now,
      windowMs,
    });
  },
});
