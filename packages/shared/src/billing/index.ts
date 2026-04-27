import { z } from "zod";

export const entitlementTierSchema = z.enum(["free", "unlimited", "pro"]);
export type EntitlementTier = z.infer<typeof entitlementTierSchema>;

export const entitlementSourceSchema = z.enum(["stripe", "apple", "google", "manual"]);
export type EntitlementSource = z.infer<typeof entitlementSourceSchema>;

export const entitlementStatusSchema = z.enum(["active", "grace", "expired", "revoked"]);
export type EntitlementStatus = z.infer<typeof entitlementStatusSchema>;

export const entitlementSchema = z.object({
  accountId: z.string().min(1),
  stripeCustomerId: z.string().optional(),
  stripeSubscriptionId: z.string().optional(),
  tier: entitlementTierSchema,
  source: entitlementSourceSchema,
  status: entitlementStatusSchema,
  includedTurnsPerDay: z.number().int().nonnegative().optional(),
  includedPremiumTokens: z.number().int().nonnegative().optional(),
  includedImages: z.number().int().nonnegative().optional(),
  includedVideos: z.number().int().nonnegative().optional(),
  overageOptIn: z.boolean(),
  monthlySpendCapCents: z.number().int().nonnegative().optional(),
  creditBalanceCents: z.number().int().nonnegative().optional(),
  renewsAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative(),
});
export type Entitlement = z.infer<typeof entitlementSchema>;

export const usageMeterSchema = z.object({
  accountId: z.string().min(1),
  periodStart: z.number().int().nonnegative(),
  periodEnd: z.number().int().nonnegative(),
  textTokens: z.number().int().nonnegative(),
  premiumTextTokens: z.number().int().nonnegative(),
  imageGenerations: z.number().int().nonnegative(),
  videoGenerations: z.number().int().nonnegative(),
  stripeMeterEventIds: z.array(z.string().min(1)),
  estimatedCostCents: z.number().int().nonnegative(),
  billableOverageCents: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type UsageMeter = z.infer<typeof usageMeterSchema>;

export const checkoutRequestSchema = z.object({
  accountId: z.string().min(1),
  targetTier: z.enum(["unlimited", "pro"]),
  interval: z.enum(["monthly", "annual"]),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

export const planChangePreviewRequestSchema = z.object({
  accountId: z.string().min(1),
  targetTier: z.enum(["free", "unlimited", "pro"]),
  targetInterval: z.enum(["monthly", "annual"]).optional(),
});
export type PlanChangePreviewRequest = z.infer<typeof planChangePreviewRequestSchema>;

export const overageOptInRequestSchema = z.object({
  accountId: z.string().min(1),
  enabled: z.boolean(),
  monthlySpendCapCents: z.number().int().positive().max(100000),
});
export type OverageOptInRequest = z.infer<typeof overageOptInRequestSchema>;
