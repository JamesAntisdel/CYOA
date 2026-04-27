import { AppError } from "../lib/errors";
import type { EntitlementRecord } from "./entitlements";

export type UsageMeterRecord = {
  accountId: string;
  periodStart: number;
  periodEnd: number;
  textTokens: number;
  premiumTextTokens: number;
  imageGenerations: number;
  videoGenerations: number;
  stripeMeterEventIds: string[];
  estimatedCostCents: number;
  billableOverageCents: number;
  updatedAt: number;
};

export type UsageDelta = {
  premiumTextTokens?: number;
  imageGenerations?: number;
  videoGenerations?: number;
  estimatedCostCents?: number;
};

export function applyUsageDelta(
  meter: UsageMeterRecord,
  entitlement: EntitlementRecord,
  delta: UsageDelta,
  now: number,
): UsageMeterRecord {
  const next: UsageMeterRecord = {
    ...meter,
    premiumTextTokens: meter.premiumTextTokens + (delta.premiumTextTokens ?? 0),
    imageGenerations: meter.imageGenerations + (delta.imageGenerations ?? 0),
    videoGenerations: meter.videoGenerations + (delta.videoGenerations ?? 0),
    estimatedCostCents: meter.estimatedCostCents + (delta.estimatedCostCents ?? 0),
    updatedAt: now,
  };

  const overageCents = calculateOverageCents(next, entitlement);
  if (overageCents > 0) {
    if (!entitlement.overageOptIn) throw new AppError("overage_opt_in_required");
    const cap = entitlement.monthlySpendCapCents ?? 0;
    if (overageCents > cap) throw new AppError("overage_spend_cap_reached");
  }

  return { ...next, billableOverageCents: overageCents };
}

export function calculateOverageCents(
  meter: UsageMeterRecord,
  entitlement: EntitlementRecord,
): number {
  const premiumOver = Math.max(0, meter.premiumTextTokens - (entitlement.includedPremiumTokens ?? 0));
  const imageOver = Math.max(0, meter.imageGenerations - (entitlement.includedImages ?? 0));
  const videoOver = Math.max(0, meter.videoGenerations - (entitlement.includedVideos ?? 0));
  return Math.ceil(premiumOver / 1000) + imageOver * 25 + videoOver * 100;
}

export function enableOverage(input: {
  entitlement: EntitlementRecord;
  monthlySpendCapCents: number;
  now: number;
}): EntitlementRecord {
  if (input.monthlySpendCapCents <= 0) throw new AppError("spend_cap_required");
  return {
    ...input.entitlement,
    overageOptIn: true,
    monthlySpendCapCents: input.monthlySpendCapCents,
    updatedAt: input.now,
  };
}
