import { describe, expect, it } from "vitest";

import {
  applyStripeWebhook,
  applyUsageDelta,
  buildCheckoutSessionRequest,
  dailyAllowance,
  enableOverage,
  freeEntitlement,
  normalizeNativeReceipt,
  previewPlanChange,
  verifyAppleReceipt,
  verifyGoogleReceipt,
} from "../index";

describe("billing", () => {
  it("builds Stripe checkout requests with account metadata", () => {
    expect(
      buildCheckoutSessionRequest({
        accountId: "acct",
        targetTier: "pro",
        interval: "monthly",
        successUrl: "https://app/success",
        cancelUrl: "https://app/cancel",
      }).metadata,
    ).toMatchObject({ accountId: "acct", targetTier: "pro" });
  });

  it("applies Stripe webhooks idempotently", () => {
    const seen = new Set<string>();
    const entitlement = applyStripeWebhook(null, {
      id: "evt_1",
      type: "checkout.session.completed",
      customerId: "cus",
      subscriptionId: "sub",
      accountId: "acct",
      tier: "unlimited",
      status: "active",
      createdAt: 1,
    }, seen);

    expect(entitlement.source).toBe("stripe");
    expect(dailyAllowance(entitlement)).toBe("unlimited");
    expect(() => applyStripeWebhook(entitlement, {
      id: "evt_1",
      type: "invoice.paid",
      customerId: "cus",
      accountId: "acct",
      createdAt: 2,
    }, seen)).toThrow("duplicate_webhook_event");
  });

  it("normalizes verified native receipts", () => {
    const apple = normalizeNativeReceipt(null, verifyAppleReceipt({
      accountId: "acct",
      productId: "cyoa_pro_monthly",
      transactionId: "tx",
      verifiedAt: 1,
    }));
    const google = normalizeNativeReceipt(null, verifyGoogleReceipt({
      accountId: "acct",
      productId: "cyoa_unlimited_monthly",
      transactionId: "tx",
      verifiedAt: 1,
    }));

    expect(apple.source).toBe("apple");
    expect(apple.tier).toBe("pro");
    expect(google.source).toBe("google");
    expect(google.tier).toBe("unlimited");
  });

  it("requires explicit overage opt-in and spend cap", () => {
    const entitlement = { ...freeEntitlement("acct", 1), tier: "pro" as const, includedPremiumTokens: 0 };
    const meter = {
      accountId: "acct",
      periodStart: 1,
      periodEnd: 10,
      textTokens: 0,
      premiumTextTokens: 0,
      imageGenerations: 0,
      videoGenerations: 0,
      stripeMeterEventIds: [],
      estimatedCostCents: 0,
      billableOverageCents: 0,
      updatedAt: 1,
    };

    expect(() => applyUsageDelta(meter, entitlement, { premiumTextTokens: 2000 }, 2)).toThrow("overage_opt_in_required");
    const optedIn = enableOverage({ entitlement, monthlySpendCapCents: 10, now: 2 });
    expect(applyUsageDelta(meter, optedIn, { premiumTextTokens: 2000 }, 3).billableOverageCents).toBe(2);
  });

  it("previews plan changes with credits", () => {
    expect(previewPlanChange({ currentTier: "unlimited", targetTier: "pro", unusedCreditCents: 500 })).toEqual({
      immediateChargeCents: 1000,
      creditAppliedCents: 500,
    });
  });
});
