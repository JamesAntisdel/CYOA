import { AppError } from "../lib/errors";
import { getStripePriceId, type StripePriceConfig } from "./config";
import { mergeEntitlementUpdate, type EntitlementRecord } from "./entitlements";

export type CheckoutPlan = {
  accountId: string;
  targetTier: "unlimited" | "pro";
  interval: "monthly" | "annual";
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutSessionRequest = CheckoutPlan & {
  clientReferenceId: string;
  metadata: Record<string, string>;
};

export type StripeCheckoutSessionCreateParams = {
  mode: "subscription";
  success_url: string;
  cancel_url: string;
  client_reference_id: string;
  allow_promotion_codes: boolean;
  line_items: Array<{ price: string; quantity: number }>;
  metadata: Record<string, string>;
  subscription_data: {
    metadata: Record<string, string>;
  };
};

export type StripeWebhookEvent = {
  id: string;
  type: "customer.subscription.updated" | "customer.subscription.deleted" | "checkout.session.completed" | "invoice.paid";
  customerId: string;
  subscriptionId?: string;
  accountId: string;
  tier?: "free" | "unlimited" | "pro";
  status?: "active" | "grace" | "expired" | "revoked";
  currentPeriodEnd?: number;
  createdAt: number;
};

export function buildCheckoutSessionRequest(plan: CheckoutPlan): CheckoutSessionRequest {
  if (!plan.successUrl.startsWith("https://") || !plan.cancelUrl.startsWith("https://")) {
    throw new AppError("checkout_urls_must_be_https");
  }
  return {
    ...plan,
    clientReferenceId: plan.accountId,
    metadata: {
      accountId: plan.accountId,
      targetTier: plan.targetTier,
      interval: plan.interval,
    },
  };
}

export function buildCheckoutSessionCreateParams(input: {
  plan: CheckoutPlan;
  prices: StripePriceConfig;
}): StripeCheckoutSessionCreateParams {
  const request = buildCheckoutSessionRequest(input.plan);
  return {
    mode: "subscription",
    success_url: request.successUrl,
    cancel_url: request.cancelUrl,
    client_reference_id: request.clientReferenceId,
    allow_promotion_codes: true,
    line_items: [
      {
        price: getStripePriceId({
          prices: input.prices,
          tier: input.plan.targetTier,
          interval: input.plan.interval,
        }),
        quantity: 1,
      },
    ],
    metadata: request.metadata,
    subscription_data: {
      metadata: request.metadata,
    },
  };
}

export function applyStripeWebhook(
  existing: EntitlementRecord | null,
  event: StripeWebhookEvent,
  seenEventIds: Set<string>,
): EntitlementRecord {
  if (seenEventIds.has(event.id)) throw new AppError("duplicate_webhook_event");
  seenEventIds.add(event.id);

  if (event.type === "customer.subscription.deleted") {
    return mergeEntitlementUpdate(existing, {
      accountId: event.accountId,
      stripeCustomerId: event.customerId,
      ...(event.subscriptionId === undefined ? {} : { stripeSubscriptionId: event.subscriptionId }),
      tier: "free",
      source: "stripe",
      status: "expired",
      updatedAt: event.createdAt,
    });
  }

  return mergeEntitlementUpdate(existing, {
    accountId: event.accountId,
    stripeCustomerId: event.customerId,
    ...(event.subscriptionId === undefined ? {} : { stripeSubscriptionId: event.subscriptionId }),
    tier: event.tier ?? existing?.tier ?? "free",
    source: "stripe",
    status: event.status ?? "active",
    ...(event.currentPeriodEnd === undefined ? {} : { renewsAt: event.currentPeriodEnd }),
    updatedAt: event.createdAt,
  });
}

export function previewPlanChange(input: {
  currentTier: "free" | "unlimited" | "pro";
  targetTier: "free" | "unlimited" | "pro";
  unusedCreditCents?: number;
}): { immediateChargeCents: number; creditAppliedCents: number } {
  const prices = { free: 0, unlimited: 1000, pro: 2500 };
  const delta = Math.max(0, prices[input.targetTier] - prices[input.currentTier]);
  const credit = Math.min(delta, input.unusedCreditCents ?? 0);
  return { immediateChargeCents: delta - credit, creditAppliedCents: credit };
}
