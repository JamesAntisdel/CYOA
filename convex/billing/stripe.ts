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

export type CustomerPortalParams = {
  customer: string;
  return_url: string;
};

/**
 * Builds the params object passed to `stripe.billingPortal.sessions.create`.
 *
 * The Stripe Billing Portal is the standard surface for paid subscribers to
 * cancel, switch plans, update payment methods, and view invoices — without
 * us building a bespoke management UI. The portal redirects back to
 * `returnUrl` when the user is done.
 *
 * As with `buildCheckoutSessionRequest`, we require HTTPS for the return URL
 * because Stripe rejects http return URLs outside the test sandbox and the
 * mismatch yields opaque "Invalid URL" errors. Failing fast here surfaces
 * the misconfiguration at call sites (local-dev http origin) instead of at
 * Stripe.
 */
export function buildCustomerPortalParams(input: {
  customerId: string;
  returnUrl: string;
}): CustomerPortalParams {
  if (!input.returnUrl.startsWith("https://")) {
    throw new AppError("portal_return_url_must_be_https");
  }
  if (!input.customerId) {
    throw new AppError("stripe_customer_missing");
  }
  return {
    customer: input.customerId,
    return_url: input.returnUrl,
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

// --- Credit packs (provider-and-credit-model design §2.4) ------------------
// One-time spark packs bought via a `mode:'payment'` Stripe Checkout (the
// existing `createCheckoutSession` is subscription-only). The webhook's
// `checkout.session.completed` branch reads `metadata.packId` to grant the
// sparks (see `packSparksFromSessionMetadata`) and writes a `pack_purchase`
// ledger row keyed by the session id.

export type CreditPackId = "sparks_500" | "sparks_1200" | "sparks_4000";

export type CreditPack = { id: CreditPackId; sparks: number; priceCents: number; label: string };

export const CREDIT_PACKS: Record<CreditPackId, CreditPack> = {
  sparks_500: { id: "sparks_500", sparks: 500, priceCents: 499, label: "500 sparks" },
  sparks_1200: { id: "sparks_1200", sparks: 1200, priceCents: 999, label: "1,200 sparks" },
  sparks_4000: { id: "sparks_4000", sparks: 4000, priceCents: 2499, label: "4,000 sparks" },
};

export type CreditPackCheckoutPlan = {
  accountId: string;
  packId: CreditPackId;
  successUrl: string;
  cancelUrl: string;
};

export type StripePackCheckoutCreateParams = {
  mode: "payment";
  success_url: string;
  cancel_url: string;
  client_reference_id: string;
  line_items: Array<{
    price_data: {
      currency: "usd";
      unit_amount: number;
      product_data: { name: string };
    };
    quantity: number;
  }>;
  metadata: Record<string, string>;
  payment_intent_data: { metadata: Record<string, string> };
};

/**
 * Build the `stripe.checkout.sessions.create` params for a one-time credit-pack
 * purchase. `mode:'payment'` (not subscription). The pack's price is priced
 * inline via `price_data` so no Stripe Price object needs provisioning per pack.
 * `metadata.packId` + `metadata.accountId` ride on both the session and the
 * payment intent so the webhook can resolve the grant regardless of which object
 * it reads.
 */
export function buildCreditPackCheckoutParams(
  plan: CreditPackCheckoutPlan,
): StripePackCheckoutCreateParams {
  if (!plan.successUrl.startsWith("https://") || !plan.cancelUrl.startsWith("https://")) {
    throw new AppError("checkout_urls_must_be_https");
  }
  const pack = CREDIT_PACKS[plan.packId];
  if (!pack) throw new AppError("unknown_credit_pack");
  const metadata = { accountId: plan.accountId, packId: pack.id, sparks: String(pack.sparks) };
  return {
    mode: "payment",
    success_url: plan.successUrl,
    cancel_url: plan.cancelUrl,
    client_reference_id: plan.accountId,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: pack.priceCents,
          product_data: { name: pack.label },
        },
        quantity: 1,
      },
    ],
    metadata,
    payment_intent_data: { metadata },
  };
}

/**
 * Resolve the spark grant for a completed pack checkout from its Stripe session
 * metadata (`packId`). Returns null for non-pack sessions (subscription
 * checkouts have no `packId`) so the webhook can tell the two branches apart.
 */
export function packSparksFromSessionMetadata(
  metadata: Record<string, string> | null | undefined,
): { packId: CreditPackId; sparks: number } | null {
  const packId = metadata?.packId as CreditPackId | undefined;
  if (!packId || !(packId in CREDIT_PACKS)) return null;
  return { packId, sparks: CREDIT_PACKS[packId].sparks };
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
