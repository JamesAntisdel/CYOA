// =============================================================================
// Daily turn state — Panel-2 Wave 2 "candle truth" server projection (BC2).
//
// Registered path (clients call the FULL directory-qualified path):
//   dailyTurns:getDailyTurnState   query
//
// This is the single server API that closes the free->paid funnel's honesty
// gap (panel-review-2, "Real candle-state API"): it projects the reader's
// `daily_turn_counter` row + their entitlement allowance into a small shape the
// client renders as the in-reader candle burn meter (from 50%) AND the
// candle-gutter interstitial, WITHOUT the client hardcoding an allowance or a
// fabricated "7h 22m" reset label.
//
// The projection is a PURE function (`buildDailyTurnState`) so it is trivially
// unit-testable and can be reused by any other read path; the `queryGeneric`
// wrapper only authorizes + loads the two rows and hands them to it.
//
// Wire shape (BC2 — consumed by WAVE2-CLIENT). Server emits CONCRETE values,
// never null; the client adapter maps them straight through:
//
//   type DailyTurnStateProjection = {
//     turnsUsedToday: number;              // >= 0, today's UTC count
//     allowance: number | "unlimited";     // free floor = 10; paid = "unlimited"
//     remaining: number | "unlimited";     // max(0, allowance - used); "unlimited" for paid
//     resetsAtUtc: number;                 // epoch ms of next UTC midnight (candle re-light)
//     tier: EntitlementTier;               // "free" | "pro" | "unlimited"
//   }
//
// Tolerance (mirrors the rest of the funnel): a missing counter row is a fresh
// day (0 used); a missing entitlement floors to the free tier; a negative or
// fractional stored `turnsUsed` is clamped to a whole >= 0; a stale/absent
// `resetAt` falls back to the computed next UTC midnight. No field ever throws.
// =============================================================================

import { queryGeneric } from "convex/server";
import { v } from "convex/values";

import {
  dailyAllowance,
  freeEntitlement,
  type EntitlementRecord,
} from "./billing/entitlements";
import { loadAndAuthorizeAccount } from "./lib/authz";
import { makeDayKey } from "./lib/ids";

const accountId = v.id("accounts");
const guestTokenHash = v.optional(v.string());

/** Wire shape (BC2). See module header. */
export type DailyTurnStateProjection = {
  turnsUsedToday: number;
  allowance: number | "unlimited";
  remaining: number | "unlimited";
  resetsAtUtc: number;
  tier: EntitlementRecord["tier"];
};

/** Minimal read of the fields this projection needs off a counter row. */
type DailyCounterLike = { turnsUsed?: number; resetAt?: number } | null | undefined;

/**
 * Epoch ms of the next UTC midnight after `now` — when the daily candle
 * re-lights. Kept local (game.ts's copy is not exported and game.ts is
 * PLATFORM-FIXES-owned) and pure: takes `now`, never reads the clock.
 */
function nextUtcMidnight(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

/**
 * Pure projection of a reader's daily-turn state. Tolerant of a missing counter
 * row (fresh day) and clamps a malformed stored `turnsUsed`. `allowance` and
 * `remaining` collapse to "unlimited" for an active paid tier (dailyAllowance
 * fails CLOSED — grace/expired fall to the free floor, never unlimited).
 */
export function buildDailyTurnState(input: {
  counter: DailyCounterLike;
  entitlement: EntitlementRecord;
  now: number;
}): DailyTurnStateProjection {
  const rawUsed = input.counter?.turnsUsed ?? 0;
  const turnsUsedToday = Number.isFinite(rawUsed) ? Math.max(0, Math.floor(rawUsed)) : 0;
  const allowance = dailyAllowance(input.entitlement);
  const remaining =
    allowance === "unlimited" ? "unlimited" : Math.max(0, allowance - turnsUsedToday);
  // Today's row carries a resetAt == next UTC midnight; prefer it, but fall back
  // to a recompute if it is absent (no row / legacy) or already in the past.
  const storedReset = input.counter?.resetAt;
  const resetsAtUtc =
    typeof storedReset === "number" && storedReset > input.now
      ? storedReset
      : nextUtcMidnight(input.now);
  return {
    turnsUsedToday,
    allowance,
    remaining,
    resetsAtUtc,
    tier: input.entitlement.tier,
  };
}

/**
 * getDailyTurnState({ accountId, guestTokenHash? }) -> DailyTurnStateProjection.
 *
 * Auth via loadAndAuthorizeAccount (owner or matching guest token). Reads at
 * most two rows: today's `daily_turn_counter` (by_account_day) and the account
 * `entitlements` row (by_accountId), defaulting to the free entitlement when
 * absent so a brand-new reader still gets a truthful 10-turn candle.
 */
export const getDailyTurnState = queryGeneric({
  args: { accountId, guestTokenHash },
  handler: async (ctx, args) => {
    const now = Date.now();
    await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);

    const dayKey = makeDayKey(new Date(now));
    const counter = (await ctx.db
      .query("daily_turn_counter")
      .withIndex("by_account_day", (q: any) =>
        q.eq("accountId", args.accountId).eq("dayKey", dayKey),
      )
      .first()) as DailyCounterLike;

    const entitlement =
      ((await ctx.db
        .query("entitlements")
        .withIndex("by_accountId", (q: any) => q.eq("accountId", args.accountId))
        .first()) as EntitlementRecord | null) ?? freeEntitlement(args.accountId, now);

    return buildDailyTurnState({ counter, entitlement, now });
  },
});
