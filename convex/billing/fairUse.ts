// Unlimited fair-use soft cap (provider-and-credit-model design §2.4).
//
// Unlimited ($/mo) has no hard daily turn limit, but a heavy user can push COGS
// past price. The soft ceiling is 60 turns/UTC-day: PAST it, server-core degrades
// routing in-fiction to the cheapest model ("the ink runs thin tonight…") rather
// than BLOCK the turn. This module only exposes the boundary check — the routing
// degradation and the in-fiction copy live in the turn path (server-core owns
// that). Free stays on the hard 10-turn cap (entitlements.FREE_DAILY_TURNS).

import { makeDayKey } from "../lib/ids";

/** Soft daily-turn ceiling for Unlimited before routing degrades (design §2.4). */
export const UNLIMITED_DAILY_SOFT_CAP = 60;

type DailyCtx = { db: any };

/**
 * True when the account has already used at least `UNLIMITED_DAILY_SOFT_CAP`
 * turns today (UTC). Reads today's `daily_turn_counter` row via `by_account_day`.
 * No row / a stale day → false (fresh day, under cap). Server-core calls this to
 * DEGRADE routing, never to block — a turn always resolves.
 */
export async function unlimitedTurnCapExceeded(
  ctx: DailyCtx,
  accountId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const dayKey = makeDayKey(new Date(now));
  const counter = (await ctx.db
    .query("daily_turn_counter")
    .withIndex("by_account_day", (q: any) => q.eq("accountId", accountId).eq("dayKey", dayKey))
    .first()) as { turnsUsed?: number } | null;
  return (counter?.turnsUsed ?? 0) >= UNLIMITED_DAILY_SOFT_CAP;
}
