import { AppError } from "./lib/errors";

export type DailyTurnCounter = {
  accountId: string;
  dayKey: string;
  turnsUsed: number;
  resetAt: number;
  updatedAt: number;
};

// Dev-only escape hatch matching the CYOA_DEV_FORCE_PRO_MEDIA pattern used
// for media gating. When CYOA_DEV_UNLIMITED_TURNS=1 the daily-turn cap is
// ignored so iterating on prompt/UI changes doesn't burn through the
// 10-turn free-tier allowance every dev session. Production deploys never
// set this env var.
function devUnlimitedTurns(): boolean {
  return process.env.CYOA_DEV_UNLIMITED_TURNS === "1";
}

export function consumeTurn(input: {
  counter: DailyTurnCounter | null;
  accountId: string;
  dayKey: string;
  now: number;
  resetAt: number;
  allowance: number | "unlimited";
}): DailyTurnCounter {
  const effectiveAllowance = devUnlimitedTurns() ? "unlimited" : input.allowance;
  if (effectiveAllowance !== "unlimited" && (input.counter?.turnsUsed ?? 0) >= effectiveAllowance) {
    throw new AppError("daily_turns_exhausted");
  }

  return {
    accountId: input.accountId,
    dayKey: input.dayKey,
    turnsUsed: (input.counter?.turnsUsed ?? 0) + 1,
    resetAt: input.resetAt,
    updatedAt: input.now,
  };
}

// --- Fixed-window action rate limiter --------------------------------------
//
// A pure per-key sliding-window-ish counter mirroring `consumeTurn`, backing
// the abuse limits from the provider-and-credit design §3 (H1/H2): cap
// `createSave` (per-account — bounds the turn-0 bible-generation schedule cost
// amplification) and `createGuestAccount` (per-source — bounds identity
// minting). Stored in the `action_rate_counters` table (key → windowStart +
// count). The DB read/modify/write wrapper lives in `consumeActionRateLimit`
// below so the game.ts mutation stays terse; the throw is the enforcement.

/** One fixed window's counter for a rate-limit key. */
export type RateWindowCounter = {
  key: string;
  windowStart: number;
  count: number;
  updatedAt: number;
};

// Dev escape hatch matching `CYOA_DEV_UNLIMITED_TURNS` / the media-gate flag.
// When set, the action rate limiter still advances the counter (so behaviour
// is observable) but never throws. Production deploys never set this.
function devDisableRateLimits(): boolean {
  return process.env.CYOA_DEV_DISABLE_RATE_LIMITS === "1";
}

/**
 * Pure fixed-window step. Given the current counter row (or null), returns the
 * next counter for `now`. Throws `AppError("rate_limited")` when the limit is
 * already met inside the live window — UNLESS the dev bypass is set, in which
 * case it counts without throwing. A stale window (older than `windowMs`)
 * resets to a fresh window starting at `now`.
 */
export function enforceRateWindow(input: {
  counter: RateWindowCounter | null;
  key: string;
  now: number;
  windowMs: number;
  limit: number;
}): RateWindowCounter {
  const withinWindow =
    input.counter !== null && input.now - input.counter.windowStart < input.windowMs;
  const windowStart = withinWindow ? (input.counter as RateWindowCounter).windowStart : input.now;
  const priorCount = withinWindow ? (input.counter as RateWindowCounter).count : 0;
  if (!devDisableRateLimits() && priorCount >= input.limit) {
    throw new AppError("rate_limited");
  }
  return {
    key: input.key,
    windowStart,
    count: priorCount + 1,
    updatedAt: input.now,
  };
}

type RateLimitCtx = { db: any };

/**
 * DB-backed enforcement of {@link enforceRateWindow}: read the `by_key` row,
 * step it, throw on limit, else upsert the advanced counter. `ctx.db` is typed
 * loosely (the same posture as the media/ledger helpers) so this works from any
 * mutation context without pulling Convex's generated types. NEVER call from a
 * query — it writes.
 */
export async function consumeActionRateLimit(
  ctx: RateLimitCtx,
  input: { key: string; now: number; windowMs: number; limit: number },
): Promise<void> {
  const existing = (await ctx.db
    .query("action_rate_counters")
    .withIndex("by_key", (q: any) => q.eq("key", input.key))
    .first()) as (RateWindowCounter & { _id?: unknown }) | null;
  const next = enforceRateWindow({
    counter: existing
      ? { key: existing.key, windowStart: existing.windowStart, count: existing.count, updatedAt: existing.updatedAt }
      : null,
    key: input.key,
    now: input.now,
    windowMs: input.windowMs,
    limit: input.limit,
  });
  if (existing?._id) {
    await ctx.db.patch(existing._id, {
      windowStart: next.windowStart,
      count: next.count,
      updatedAt: next.updatedAt,
    });
  } else {
    await ctx.db.insert("action_rate_counters", next);
  }
}

/** Abuse-limit windows (design §3 H1/H2). One hour, generous enough to never
 * bite a real reader but bounding scripted floods. */
export const SAVE_CREATIONS_PER_HOUR = 30;
export const GUEST_MINTS_PER_HOUR = 20;
export const RATE_WINDOW_HOUR_MS = 60 * 60 * 1000;
