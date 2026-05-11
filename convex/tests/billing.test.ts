import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { handleStripeWebhookForTest } from "../billingFunctions";

import {
  applyStripeWebhook,
  applyUsageDelta,
  assertStripeEventNotProcessed,
  buildCheckoutSessionRequest,
  buildCheckoutSessionCreateParams,
  calculateOverageCents,
  dailyAllowance,
  enableOverage,
  freeEntitlement,
  hasPaidEntitlement,
  mergeEntitlementUpdate,
  normalizeNativeReceipt,
  normalizeStripeWebhookEvent,
  planAllowance,
  previewPlanChange,
  readStripePriceConfig,
  requireStripeSecretKey,
  requireStripeWebhookSecret,
  verifyStripeWebhookPayload,
  verifyAppleReceipt,
  verifyGoogleReceipt,
} from "../index";

describe("billing", () => {
  it("builds Stripe checkout requests with account metadata", () => {
    const prices = {
      unlimited: { monthly: "price_unlimited_monthly", annual: "price_unlimited_annual" },
      pro: { monthly: "price_pro_monthly", annual: "price_pro_annual" },
    };
    const plan = {
      accountId: "acct",
      targetTier: "pro" as const,
      interval: "monthly" as const,
      successUrl: "https://app/success",
      cancelUrl: "https://app/cancel",
    };

    expect(
      buildCheckoutSessionRequest(plan).metadata,
    ).toMatchObject({ accountId: "acct", targetTier: "pro" });
    expect(buildCheckoutSessionCreateParams({ plan, prices })).toMatchObject({
      mode: "subscription",
      line_items: [{ price: "price_pro_monthly", quantity: 1 }],
      subscription_data: { metadata: { accountId: "acct", targetTier: "pro" } },
    });
    expect(() => buildCheckoutSessionRequest({ ...plan, successUrl: "http://app/success" })).toThrow(
      "checkout_urls_must_be_https",
    );
  });

  it("reads required Stripe billing environment", () => {
    const env = {
      STRIPE_SECRET_KEY: "sk_test",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
      STRIPE_PRICE_UNLIMITED_MONTHLY: "price_unlimited_monthly",
      STRIPE_PRICE_UNLIMITED_ANNUAL: "price_unlimited_annual",
      STRIPE_PRICE_PRO_MONTHLY: "price_pro_monthly",
      STRIPE_PRICE_PRO_ANNUAL: "price_pro_annual",
    };

    expect(requireStripeSecretKey(env)).toBe("sk_test");
    expect(requireStripeWebhookSecret(env)).toBe("whsec_test");
    expect(readStripePriceConfig(env).pro.annual).toBe("price_pro_annual");
    expect(() => readStripePriceConfig({})).toThrow("missing_env:STRIPE_PRICE_UNLIMITED_MONTHLY");
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

    const existingTierFallback = applyStripeWebhook(entitlement, {
      id: "evt_existing_fallback",
      type: "invoice.paid",
      customerId: "cus",
      accountId: "acct",
      createdAt: 3,
      currentPeriodEnd: 99,
    }, seen);
    expect(existingTierFallback).toMatchObject({
      tier: "unlimited",
      status: "active",
      renewsAt: 99,
    });

    const freeFallback = applyStripeWebhook(null, {
      id: "evt_free_fallback",
      type: "invoice.paid",
      customerId: "cus",
      accountId: "acct",
      createdAt: 4,
    }, seen);
    expect(freeFallback).toMatchObject({
      tier: "free",
      status: "active",
    });
  });

  it("verifies and normalizes Stripe webhook payloads", () => {
    const secret = "whsec_test_secret";
    const payload = JSON.stringify({
      id: "evt_checkout",
      type: "checkout.session.completed",
      created: 10,
      data: {
        object: {
          id: "cs_test",
          object: "checkout.session",
          customer: "cus",
          subscription: "sub",
          metadata: {
            accountId: "acct",
            targetTier: "pro",
          },
        },
      },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
    const event = verifyStripeWebhookPayload({ body: payload, signature, webhookSecret: secret });

    expect(normalizeStripeWebhookEvent(event)).toMatchObject({
      id: "evt_checkout",
      type: "checkout.session.completed",
      accountId: "acct",
      tier: "pro",
      status: "active",
    });
    expect(() => verifyStripeWebhookPayload({ body: payload, signature: null, webhookSecret: secret })).toThrow(
      "stripe_signature_required",
    );
    expect(() => assertStripeEventNotProcessed([{ eventId: "evt_checkout", type: "checkout.session.completed", processedAt: 1 }], "evt_checkout")).toThrow(
      "duplicate_webhook_event",
    );
  });

  it("handles Stripe webhook payloads through the endpoint helper", async () => {
    const secret = "whsec_endpoint_secret";
    const payload = JSON.stringify({
      id: "evt_endpoint",
      type: "checkout.session.completed",
      created: 10,
      data: {
        object: {
          id: "cs_test",
          object: "checkout.session",
          customer: "cus",
          subscription: "sub",
          metadata: {
            accountId: "acct",
            targetTier: "pro",
          },
        },
      },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    const calls: unknown[] = [];

    const handled = await handleStripeWebhookForTest({
      body: payload,
      signature,
      webhookSecret: secret,
      applyEvent: async (event) => {
        calls.push(event);
        return "applied";
      },
    });

    expect(handled).toEqual({ ignored: false, result: "applied" });
    expect(calls).toHaveLength(1);

    const ignoredPayload = JSON.stringify({
      id: "evt_ignored_endpoint",
      type: "customer.created",
      created: 10,
      data: { object: { id: "cus" } },
    });
    const ignoredSignature = Stripe.webhooks.generateTestHeaderString({
      payload: ignoredPayload,
      secret,
    });
    await expect(
      handleStripeWebhookForTest({
        body: ignoredPayload,
        signature: ignoredSignature,
        webhookSecret: secret,
        applyEvent: async () => "unexpected",
      }),
    ).resolves.toEqual({ ignored: true });
  });

  it("normalizes subscription webhooks and ignores unhandled Stripe events", () => {
    expect(
      normalizeStripeWebhookEvent({
        id: "evt_ignored",
        type: "customer.created",
        created: 10,
        data: { object: { id: "cus" } },
      } as unknown as Stripe.Event),
    ).toBeNull();

    expect(
      normalizeStripeWebhookEvent({
        id: "evt_sub",
        type: "customer.subscription.updated",
        created: 11,
        data: {
          object: {
            id: "sub",
            customer: "cus",
            status: "past_due",
            current_period_end: 99,
            metadata: {
              accountId: "acct",
              targetTier: "unlimited",
            },
          },
        },
      } as unknown as Stripe.Event),
    ).toMatchObject({
      accountId: "acct",
      tier: "unlimited",
      status: "grace",
      currentPeriodEnd: 99,
    });

    expect(
      normalizeStripeWebhookEvent({
        id: "evt_sub_deleted",
        type: "customer.subscription.deleted",
        created: 12,
        data: {
          object: {
            id: "sub",
            customer: { id: "cus", object: "customer" },
            status: "canceled",
            current_period_end: 100,
            metadata: {
              accountId: "acct",
              targetTier: "pro",
            },
          },
        },
      } as unknown as Stripe.Event),
    ).toMatchObject({
      customerId: "cus",
      status: "expired",
    });

    expect(
      normalizeStripeWebhookEvent({
        id: "evt_revoked",
        type: "customer.subscription.updated",
        created: 13,
        data: {
          object: {
            id: "sub",
            customer: "cus",
            status: "incomplete",
            metadata: {
              accountId: "acct",
              targetTier: "free",
            },
          },
        },
      } as unknown as Stripe.Event),
    ).toMatchObject({
      tier: "free",
      status: "revoked",
    });

    const invalidTierEvent = normalizeStripeWebhookEvent({
      id: "evt_trialing",
      type: "customer.subscription.updated",
      created: 14,
      data: {
        object: {
          id: "sub",
          customer: "cus",
          status: "trialing",
          metadata: {
            accountId: "acct",
            targetTier: "enterprise",
          },
        },
      },
    } as unknown as Stripe.Event);
    expect(invalidTierEvent).toMatchObject({
      accountId: "acct",
      status: "active",
    });
    expect(invalidTierEvent?.tier).toBeUndefined();

    expect(
      normalizeStripeWebhookEvent({
        id: "evt_unpaid",
        type: "customer.subscription.updated",
        created: 15,
        data: {
          object: {
            id: "sub",
            customer: "cus",
            status: "unpaid",
            metadata: {
              accountId: "acct",
              targetTier: "pro",
            },
          },
        },
      } as unknown as Stripe.Event),
    ).toMatchObject({ status: "grace" });

    expect(
      normalizeStripeWebhookEvent({
        id: "evt_incomplete_expired",
        type: "customer.subscription.updated",
        created: 16,
        data: {
          object: {
            id: "sub",
            customer: "cus",
            status: "incomplete_expired",
            metadata: {
              accountId: "acct",
              targetTier: "pro",
            },
          },
        },
      } as unknown as Stripe.Event),
    ).toMatchObject({ status: "expired" });
  });

  it("normalizes invoice webhooks and rejects malformed Stripe payloads", () => {
    expect(
      normalizeStripeWebhookEvent({
        id: "evt_invoice",
        type: "invoice.paid",
        created: 14,
        data: {
          object: {
            id: "in",
            object: "invoice",
            customer: { id: "cus", object: "customer" },
            subscription: { id: "sub" },
            parent: {
              subscription_details: {
                metadata: {
                  accountId: "acct",
                  targetTier: "pro",
                },
              },
            },
          },
        },
      } as unknown as Stripe.Event),
    ).toMatchObject({
      id: "evt_invoice",
      subscriptionId: "sub",
      tier: "pro",
      status: "active",
    });

    expect(() =>
      normalizeStripeWebhookEvent({
        id: "evt_bad",
        type: "checkout.session.completed",
        created: 15,
        data: { object: { id: "cs", customer: null, metadata: {} } },
      } as unknown as Stripe.Event),
    ).toThrow("stripe_id_missing");

    expect(() =>
      normalizeStripeWebhookEvent({
        id: "evt_missing_metadata",
        type: "invoice.paid",
        created: 16,
        data: {
          object: {
            id: "in",
            customer: "cus",
            parent: { subscription_details: { metadata: {} } },
          },
        },
      } as unknown as Stripe.Event),
    ).toThrow("stripe_metadata_missing:accountId");
  });

  it("expires Stripe entitlements when a subscription is deleted", () => {
    const seen = new Set<string>();
    const existing = mergeEntitlementUpdate(null, {
      accountId: "acct",
      tier: "pro",
      source: "stripe",
      status: "active",
      updatedAt: 1,
    });

    const expired = applyStripeWebhook(existing, {
      id: "evt_deleted",
      type: "customer.subscription.deleted",
      customerId: "cus",
      subscriptionId: "sub",
      accountId: "acct",
      createdAt: 2,
    }, seen);

    expect(expired).toMatchObject({
      tier: "free",
      status: "expired",
      stripeCustomerId: "cus",
      stripeSubscriptionId: "sub",
    });
    expect(dailyAllowance(expired)).toBe(10);

    const noSubscription = applyStripeWebhook(existing, {
      id: "evt_deleted_without_subscription",
      type: "customer.subscription.deleted",
      customerId: "cus",
      accountId: "acct",
      createdAt: 3,
    }, seen);
    expect(noSubscription.stripeSubscriptionId).toBeUndefined();
  });

  it("verifies and normalizes native receipts", async () => {
    const apple = normalizeNativeReceipt(null, await verifyAppleReceipt({
      accountId: "acct",
      productId: "cyoa_pro_monthly",
      transactionId: "tx",
      expiresAt: 100,
      verifiedAt: 1,
    }, {
      expectedBundleId: "com.cyoa.app",
      fetchTransaction: async () => ({
        transactionId: "tx",
        productId: "cyoa_pro_monthly",
        appAccountToken: "acct",
        bundleId: "com.cyoa.app",
        expiresAt: 100,
      }),
    }));
    const google = normalizeNativeReceipt(null, await verifyGoogleReceipt({
      accountId: "acct",
      productId: "cyoa_unlimited_monthly",
      transactionId: "tx",
      verifiedAt: 1,
    }, {
      packageName: "com.cyoa.app",
      fetchSubscription: async () => ({
        purchaseToken: "tx",
        productId: "cyoa_unlimited_monthly",
        linkedAccountId: "acct",
        packageName: "com.cyoa.app",
        acknowledgementState: "ACKNOWLEDGED",
        subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
      }),
    }));

    expect(apple.source).toBe("apple");
    expect(apple.tier).toBe("pro");
    expect(apple.renewsAt).toBe(100);
    expect(google.source).toBe("google");
    expect(google.tier).toBe("unlimited");
  });

  it("rejects malformed native receipts before entitlement normalization", async () => {
    await expect(
      verifyAppleReceipt({
        accountId: "acct",
        productId: "cyoa_pro_monthly",
        transactionId: "tx",
        verifiedAt: 200,
      }, {
        fetchTransaction: async () => ({
          transactionId: "tx",
          productId: "cyoa_other_monthly",
        }),
      }),
    ).rejects.toThrow("native_receipt_product_mismatch");

    await expect(
      verifyAppleReceipt({
        accountId: "acct",
        productId: "cyoa_pro_monthly",
        transactionId: "tx",
        verifiedAt: 200,
      }, {
        fetchTransaction: async () => ({
          transactionId: "tx",
          productId: "cyoa_pro_monthly",
          expiresAt: 100,
        }),
      }),
    ).rejects.toThrow("native_receipt_expired");

    await expect(
      verifyGoogleReceipt({
        accountId: "acct",
        productId: "cyoa_unlimited_monthly",
        transactionId: "purchase-token",
        verifiedAt: 1,
      }, {
        fetchSubscription: async () => ({
          purchaseToken: "purchase-token",
          productId: "cyoa_unlimited_monthly",
          linkedAccountId: "other-acct",
        }),
      }),
    ).rejects.toThrow("native_receipt_account_mismatch");

    await expect(
      verifyGoogleReceipt({
        accountId: "acct",
        productId: "cyoa_unlimited_monthly",
        transactionId: "",
        verifiedAt: 1,
      }, {
        fetchSubscription: async () => {
          throw new Error("should_not_fetch");
        },
      }),
    ).rejects.toThrow("native_receipt_transaction_required");
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
    expect(() => enableOverage({ entitlement, monthlySpendCapCents: 0, now: 2 })).toThrow("spend_cap_required");
    expect(
      applyUsageDelta(meter, entitlement, {}, 2),
    ).toMatchObject({
      premiumTextTokens: 0,
      imageGenerations: 0,
      videoGenerations: 0,
      estimatedCostCents: 0,
    });
    const optedIn = enableOverage({ entitlement, monthlySpendCapCents: 10, now: 2 });
    expect(
      applyUsageDelta(meter, optedIn, {
        estimatedCostCents: 25,
        imageGenerations: 0,
        premiumTextTokens: 2000,
        videoGenerations: 0,
      }, 3).billableOverageCents,
    ).toBe(2);
    expect(() => applyUsageDelta(meter, optedIn, { premiumTextTokens: 20_000 }, 4)).toThrow(
      "overage_spend_cap_reached",
    );
    expect(() =>
      applyUsageDelta(meter, { ...optedIn, monthlySpendCapCents: undefined }, { premiumTextTokens: 2000 }, 4),
    ).toThrow("overage_spend_cap_reached");
    expect(
      calculateOverageCents(
        {
          ...meter,
          imageGenerations: 2,
          videoGenerations: 1,
        },
        {
          ...optedIn,
          includedImages: 0,
          includedVideos: 0,
        },
      ),
    ).toBe(70);
    expect(calculateOverageCents({ ...meter, premiumTextTokens: 1000, imageGenerations: 1, videoGenerations: 1 }, {
      ...entitlement,
      includedPremiumTokens: undefined,
      includedImages: undefined,
      includedVideos: undefined,
    })).toBe(46);
  });

  it("previews plan changes with credits", () => {
    expect(planAllowance("free")).toMatchObject({ includedTurnsPerDay: 10 });
    expect(planAllowance("unlimited")).toMatchObject({ includedPremiumTokens: 25_000 });
    expect(hasPaidEntitlement({ tier: "pro", status: "active" })).toBe(true);
    expect(hasPaidEntitlement({ tier: "pro", status: "grace" })).toBe(false);
    expect(dailyAllowance({ ...freeEntitlement("acct", 1), includedTurnsPerDay: undefined })).toBe(0);
    expect(previewPlanChange({ currentTier: "unlimited", targetTier: "pro", unusedCreditCents: 500 })).toEqual({
      immediateChargeCents: 1000,
      creditAppliedCents: 500,
    });
    expect(previewPlanChange({ currentTier: "pro", targetTier: "unlimited" })).toEqual({
      immediateChargeCents: 0,
      creditAppliedCents: 0,
    });
  });
});
