import type { EntitlementTier } from "@cyoa/shared";

export type BillingSource = "stripe" | "apple" | "google" | "manual";
export type BillingStatus = "active" | "grace" | "expired" | "revoked";

export type EntitlementRecord = {
  accountId: string;
  stripeCustomerId?: string | undefined;
  stripeSubscriptionId?: string | undefined;
  tier: EntitlementTier;
  source: BillingSource;
  status: BillingStatus;
  includedTurnsPerDay?: number | undefined;
  includedPremiumTokens?: number | undefined;
  includedImages?: number | undefined;
  includedVideos?: number | undefined;
  overageOptIn: boolean;
  monthlySpendCapCents?: number | undefined;
  creditBalanceCents?: number | undefined;
  renewsAt?: number | undefined;
  updatedAt: number;
};

/**
 * Daily turn allowance for the free tier. Also the floor for any account that
 * is not an active/grace paid subscriber — a lapsed or expired subscriber must
 * never end up with FEWER daily turns than a brand-new guest.
 */
export const FREE_DAILY_TURNS = 10;

export function freeEntitlement(accountId: string, now: number): EntitlementRecord {
  return {
    accountId,
    tier: "free",
    source: "manual",
    status: "active",
    includedTurnsPerDay: FREE_DAILY_TURNS,
    includedPremiumTokens: 0,
    includedImages: 0,
    includedVideos: 0,
    overageOptIn: false,
    creditBalanceCents: 0,
    updatedAt: now,
  };
}

export function planAllowance(tier: EntitlementTier): Pick<
  EntitlementRecord,
  "includedTurnsPerDay" | "includedPremiumTokens" | "includedImages" | "includedVideos"
> {
  if (tier === "pro") {
    return {
      includedPremiumTokens: 250_000,
      includedImages: 100,
      includedVideos: 20,
    };
  }
  if (tier === "unlimited") {
    return {
      includedPremiumTokens: 25_000,
      includedImages: 0,
      includedVideos: 0,
    };
  }
  return {
    includedTurnsPerDay: FREE_DAILY_TURNS,
    includedPremiumTokens: 0,
    includedImages: 0,
    includedVideos: 0,
  };
}

export function mergeEntitlementUpdate(
  existing: EntitlementRecord | null,
  update: Partial<EntitlementRecord> & Pick<EntitlementRecord, "accountId" | "tier" | "source" | "status" | "updatedAt">,
): EntitlementRecord {
  const allowance = planAllowance(update.tier);
  const base = existing ?? freeEntitlement(update.accountId, update.updatedAt);
  const clearPlanSpecificFields =
    update.tier === "free"
      ? {}
      : {
          includedTurnsPerDay: undefined,
        };
  return {
    ...base,
    ...clearPlanSpecificFields,
    ...allowance,
    ...update,
  };
}

export function hasPaidEntitlement(entitlement: Pick<EntitlementRecord, "tier" | "status">): boolean {
  return entitlement.status === "active" && (entitlement.tier === "unlimited" || entitlement.tier === "pro");
}

export function dailyAllowance(entitlement: EntitlementRecord): number | "unlimited" {
  // Only an ACTIVE paid tier gets unlimited daily turns — this must fail
  // CLOSED. A paid tier in `grace` (Stripe past_due / unpaid) is a payment
  // that has already failed; there is no `graceExpiresAt` and no cron that
  // downgrades grace, so granting unlimited here would let a customer whose
  // final `customer.subscription.deleted` webhook is dropped (endpoint outage,
  // bad secret) keep unlimited access forever without paying. Instead, a grace
  // subscriber falls through to the free daily floor below: still non-zero (so
  // a transient card retry doesn't lock a paying customer out — the original
  // bug), but metered, so a stuck-in-grace account can't mint free unlimited.
  if (hasPaidEntitlement(entitlement)) {
    return "unlimited";
  }
  // Everyone else falls back to the free daily floor rather than 0. A paid
  // tier whose status has lapsed has its includedTurnsPerDay cleared to
  // undefined (mergeEntitlementUpdate), so without this floor an expired
  // subscriber would get 0 turns — strictly worse than a free guest.
  return entitlement.includedTurnsPerDay ?? FREE_DAILY_TURNS;
}
