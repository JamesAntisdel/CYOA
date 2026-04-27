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

export function freeEntitlement(accountId: string, now: number): EntitlementRecord {
  return {
    accountId,
    tier: "free",
    source: "manual",
    status: "active",
    includedTurnsPerDay: 10,
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
    includedTurnsPerDay: 10,
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
  return hasPaidEntitlement(entitlement) ? "unlimited" : (entitlement.includedTurnsPerDay ?? 0);
}
