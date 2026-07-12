// Media credit / spark ledger helpers (provider-and-credit-model design §2.2–2.4).
//
// The `media_credits_ledger` table is append-only. Balance is the indexed sum
// over `by_account`, mirrored into `entitlements.creditBalanceCents` for cheap
// reads (1 spark = 1¢ so the sum IS the cent balance). `idempotencyKey` (unique
// via `by_idem`) dedupes grants / spends / refunds the same way
// `stripe_webhook_events` dedupes Stripe events.
//
// These are PURE DB mutations — no `fetch`, no `setTimeout`. They run inside the
// media queue mutations (before scheduling the job) and the mark-failed refund
// path. `ctx.db` is typed loosely (the same posture as the media modules) so the
// helpers work from any mutation context without pulling Convex's generated types.

import { cleanDoc } from "../lib/docs";
import { AppError } from "../lib/errors";
import { MEDIA_SPARK_COSTS, type MediaSparkKind } from "./mediaCosts";

export type LedgerReason =
  | "pro_allowance"
  | "pack_purchase"
  | "reader_spend"
  | "creator_spend"
  | "refund";

export type LedgerRow = {
  _id?: string;
  accountId: string;
  delta: number;
  reason: LedgerReason;
  idempotencyKey: string;
  assetId?: string;
  stripeSessionId?: string;
  createdAt: number;
};

type LedgerCtx = { db: any };

/** Who is footing a spend — the reader (reader_spend) or a creator (creator_spend). */
export type Spender = "reader" | "creator";

// --- Balance ---------------------------------------------------------------

/** Sum every ledger delta for an account (its spark balance). Never negative in
 * practice, but returns the raw sum so a bug is visible rather than clamped. */
export async function ledgerSumForAccount(ctx: LedgerCtx, accountId: string): Promise<number> {
  const rows = (await ctx.db
    .query("media_credits_ledger")
    .withIndex("by_account", (q: any) => q.eq("accountId", accountId))
    .collect()) as LedgerRow[];
  return rows.reduce((sum, row) => sum + (row.delta ?? 0), 0);
}

/** Mirror the summed balance into `entitlements.creditBalanceCents` (1 spark =
 * 1¢). No-op when the account has no entitlement row (guest/anon) — the ledger
 * sum stays the source of truth in that case. */
export async function mirrorBalanceToEntitlement(
  ctx: LedgerCtx,
  accountId: string,
  balance: number,
  now: number,
): Promise<void> {
  const entitlement = await ctx.db
    .query("entitlements")
    .withIndex("by_accountId", (q: any) => q.eq("accountId", accountId))
    .first();
  if (!entitlement) return;
  await ctx.db.patch(entitlement._id, { creditBalanceCents: balance, updatedAt: now });
}

/** Recompute + mirror the balance, returning the summed spark balance. */
export async function balanceForAccount(ctx: LedgerCtx, accountId: string): Promise<number> {
  const balance = await ledgerSumForAccount(ctx, accountId);
  await mirrorBalanceToEntitlement(ctx, accountId, balance, Date.now());
  return balance;
}

async function ledgerRowByIdem(ctx: LedgerCtx, idempotencyKey: string): Promise<LedgerRow | null> {
  return (await ctx.db
    .query("media_credits_ledger")
    .withIndex("by_idem", (q: any) => q.eq("idempotencyKey", idempotencyKey))
    .first()) as LedgerRow | null;
}

// --- Spend -----------------------------------------------------------------

export type ReserveResult = {
  /** Sparks actually debited by this call (0 when a prior identical debit already existed). */
  sparks: number;
  /** Spark balance after the debit. */
  balanceAfter: number;
  /** True when `idempotencyKey` already had a debit — the reservation is reused, not re-charged. */
  duplicate: boolean;
};

/**
 * Reserve `costSparks` against an account's balance, writing a spend debit
 * (`reader_spend` / `creator_spend`, `delta = -costSparks`) and re-mirroring the
 * balance. Idempotent via `by_idem`: a second call with the same key is a no-op
 * that reports the existing reservation. Throws `AppError("insufficient_sparks")`
 * when the balance can't cover the cost (the media queue mutation catches this
 * and degrades — a turn never hard-fails on media).
 */
export async function assertAndReserveSpark(
  ctx: LedgerCtx,
  accountId: string,
  costSparks: number,
  idempotencyKey: string,
  assetId?: string,
  spender: Spender = "reader",
): Promise<ReserveResult> {
  const existing = await ledgerRowByIdem(ctx, idempotencyKey);
  if (existing) {
    return { sparks: 0, balanceAfter: await ledgerSumForAccount(ctx, accountId), duplicate: true };
  }
  if (costSparks <= 0) {
    return { sparks: 0, balanceAfter: await ledgerSumForAccount(ctx, accountId), duplicate: false };
  }
  const balance = await ledgerSumForAccount(ctx, accountId);
  if (balance < costSparks) throw new AppError("insufficient_sparks");

  const now = Date.now();
  await ctx.db.insert(
    "media_credits_ledger",
    cleanDoc({
      accountId,
      delta: -costSparks,
      reason: spender === "creator" ? "creator_spend" : "reader_spend",
      idempotencyKey,
      ...(assetId ? { assetId } : {}),
      createdAt: now,
    }),
  );
  const balanceAfter = balance - costSparks;
  await mirrorBalanceToEntitlement(ctx, accountId, balanceAfter, now);
  return { sparks: costSparks, balanceAfter, duplicate: false };
}

// --- Refund ----------------------------------------------------------------

/**
 * Refund the sparks a failed job's asset was charged. Keyed `refund:<assetId>`
 * and idempotent — a second call is a no-op. Refunds EXACTLY the sum of the
 * spend debits linked to the asset, so an asset that was never charged (anchor /
 * NPC portrait — base experience, no spend) or was covered by the Pro allowance
 * refunds nothing. Called from the mark-failed internal mutations.
 */
export async function refundSpark(
  ctx: LedgerCtx,
  assetId: string,
): Promise<{ refunded: boolean; sparks: number }> {
  const idempotencyKey = `refund:${assetId}`;
  const already = await ledgerRowByIdem(ctx, idempotencyKey);
  if (already) return { refunded: false, sparks: 0 };

  const asset = (await ctx.db.get(assetId)) as { accountId?: string } | null;
  if (!asset?.accountId) return { refunded: false, sparks: 0 };
  const accountId = asset.accountId;

  const rows = (await ctx.db
    .query("media_credits_ledger")
    .withIndex("by_account", (q: any) => q.eq("accountId", accountId))
    .collect()) as LedgerRow[];
  const spent = rows
    .filter(
      (r) =>
        r.assetId === assetId && (r.reason === "reader_spend" || r.reason === "creator_spend"),
    )
    .reduce((sum, r) => sum + r.delta, 0); // negative
  if (spent >= 0) return { refunded: false, sparks: 0 };

  const refundSparks = -spent; // positive credit
  const now = Date.now();
  await ctx.db.insert(
    "media_credits_ledger",
    cleanDoc({
      accountId,
      delta: refundSparks,
      reason: "refund",
      idempotencyKey,
      assetId,
      createdAt: now,
    }),
  );
  await mirrorBalanceToEntitlement(ctx, accountId, await ledgerSumForAccount(ctx, accountId), now);
  return { refunded: true, sparks: refundSparks };
}

// --- Grants (packs + Pro monthly allowance) --------------------------------

/**
 * Append a positive-delta credit row (grant/purchase) idempotently and re-mirror
 * the balance. Shared by pack purchases and the Pro monthly allowance grant.
 * Returns `{ granted: false }` when `idempotencyKey` was already recorded.
 */
export async function creditLedger(
  ctx: LedgerCtx,
  input: {
    accountId: string;
    sparks: number;
    reason: Extract<LedgerReason, "pack_purchase" | "pro_allowance">;
    idempotencyKey: string;
    stripeSessionId?: string;
  },
): Promise<{ granted: boolean; sparks: number; balanceAfter: number }> {
  const existing = await ledgerRowByIdem(ctx, input.idempotencyKey);
  if (existing) {
    return { granted: false, sparks: 0, balanceAfter: await ledgerSumForAccount(ctx, input.accountId) };
  }
  const now = Date.now();
  await ctx.db.insert(
    "media_credits_ledger",
    cleanDoc({
      accountId: input.accountId,
      delta: input.sparks,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      ...(input.stripeSessionId ? { stripeSessionId: input.stripeSessionId } : {}),
      createdAt: now,
    }),
  );
  const balanceAfter = await ledgerSumForAccount(ctx, input.accountId);
  await mirrorBalanceToEntitlement(ctx, input.accountId, balanceAfter, now);
  return { granted: true, sparks: input.sparks, balanceAfter };
}

/** Grant the sparks from a completed one-time pack checkout, keyed by session id. */
export async function recordPackPurchase(
  ctx: LedgerCtx,
  input: { accountId: string; sparks: number; stripeSessionId: string },
): Promise<{ granted: boolean; sparks: number; balanceAfter: number }> {
  return creditLedger(ctx, {
    accountId: input.accountId,
    sparks: input.sparks,
    reason: "pack_purchase",
    idempotencyKey: `pack:${input.stripeSessionId}`,
    stripeSessionId: input.stripeSessionId,
  });
}

/** Materialize a Pro billing-period allowance grant (design §2.4: 1,200 sparks),
 * keyed `pro_grant:<accountId>:<periodStart>` so a period rolls over exactly once. */
export async function grantProAllowance(
  ctx: LedgerCtx,
  input: { accountId: string; sparks: number; periodStart: number },
): Promise<{ granted: boolean; sparks: number; balanceAfter: number }> {
  return creditLedger(ctx, {
    accountId: input.accountId,
    sparks: input.sparks,
    reason: "pro_allowance",
    idempotencyKey: `pro_grant:${input.accountId}:${input.periodStart}`,
  });
}

/** Default Pro monthly spark grant (design §2.4: "~3 fully-illustrated stories/month"). */
export const PRO_MONTHLY_SPARK_GRANT = 1200;

// --- Queue-time charge (allowance-then-spark) ------------------------------

type EntitlementLite = {
  _id?: string;
  tier?: string;
  status?: string;
  includedImages?: number;
  includedVideos?: number;
};

export type ChargeKind = "image" | "video" | "audio" | "cinematic";

export type ChargeResult =
  | { charged: true; via: "allowance" | "spark"; sparks: number }
  | { charged: false; reason: string };

/**
 * Charge for one metered media job at queue time (design §2.3/§2.4). For an
 * active Pro account with a monthly IMAGE/VIDEO allowance still on the clock
 * (`entitlement.includedImages` / `includedVideos`, reset to plan values on
 * renewal), consume ONE allowance unit and charge no sparks. Otherwise reserve
 * the media's spark cost against the ledger balance. Non-throwing: an exhausted
 * balance returns `{ charged: false, reason: "insufficient_sparks" }` so the
 * caller degrades (drops the media) instead of failing the turn.
 *
 * Anchor + NPC portraits do NOT call this — they are the system-generated base
 * experience and are never metered (design §2.3).
 */
export async function chargeMediaSpend(
  ctx: LedgerCtx,
  input: {
    accountId: string;
    chargeKind: ChargeKind;
    sparkKind: MediaSparkKind;
    assetId: string;
    idempotencyKey: string;
    spender?: Spender;
  },
): Promise<ChargeResult> {
  const entitlement = (await ctx.db
    .query("entitlements")
    .withIndex("by_accountId", (q: any) => q.eq("accountId", input.accountId))
    .first()) as EntitlementLite | null;
  const isPro = entitlement?.tier === "pro" && entitlement.status === "active";

  // Pro monthly allowance is consumed FIRST for still/video products.
  if (isPro && entitlement) {
    const field =
      input.chargeKind === "video"
        ? "includedVideos"
        : input.chargeKind === "image"
          ? "includedImages"
          : null;
    if (field && (entitlement[field] ?? 0) > 0) {
      await ctx.db.patch(entitlement._id, {
        [field]: (entitlement[field] ?? 0) - 1,
        updatedAt: Date.now(),
      });
      return { charged: true, via: "allowance", sparks: 0 };
    }
  }

  const costSparks = MEDIA_SPARK_COSTS[input.sparkKind];
  try {
    const reserved = await assertAndReserveSpark(
      ctx,
      input.accountId,
      costSparks,
      input.idempotencyKey,
      input.assetId,
      input.spender ?? "reader",
    );
    return { charged: true, via: "spark", sparks: reserved.sparks };
  } catch (err) {
    if (err instanceof AppError && err.code === "insufficient_sparks") {
      return { charged: false, reason: "insufficient_sparks" };
    }
    throw err;
  }
}
