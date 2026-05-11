import Stripe from "stripe";
import { actionGeneric, mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

import { readStripePriceConfig, requireStripeSecretKey } from "./billing/config";
import { applyStripeWebhook, previewPlanChange } from "./billing/stripe";
import { assertStripeEventNotProcessed, normalizeStripeWebhookEvent, verifyStripeWebhookPayload } from "./billing/webhook";
import { AppError } from "./lib/errors";
import { buildCheckoutStartPlan } from "./liveCore";

const accountId = v.id("accounts");
const tier = v.union(v.literal("free"), v.literal("unlimited"), v.literal("pro"));
const paidTier = v.union(v.literal("unlimited"), v.literal("pro"));
const interval = v.union(v.literal("monthly"), v.literal("annual"));

export const previewPlan = queryGeneric({
  args: {
    currentTier: tier,
    targetTier: tier,
    unusedCreditCents: v.optional(v.number()),
  },
  handler: async (_ctx, args) => previewPlanChange(args),
});

export const createCheckoutSession = actionGeneric({
  args: {
    accountId,
    targetTier: paidTier,
    interval,
    successUrl: v.string(),
    cancelUrl: v.string(),
  },
  handler: async (_ctx, args) => {
    const plan = buildCheckoutStartPlan({
      checkout: args,
      prices: readStripePriceConfig(),
    });
    const stripe = new Stripe(requireStripeSecretKey());
    const session = await stripe.checkout.sessions.create(plan.params);
    if (!session.url) throw new AppError("stripe_checkout_url_missing");
    return {
      url: session.url,
      clientReferenceId: plan.request.clientReferenceId,
    };
  },
});

export const applyNormalizedStripeEvent = mutationGeneric({
  args: {
    event: v.any(),
  },
  handler: async (ctx, args) => {
    const event = args.event;
    const existingRecord = await ctx.db
      .query("stripe_webhook_events")
      .withIndex("by_eventId", (q) => q.eq("eventId", event.id))
      .first();
    assertStripeEventNotProcessed(existingRecord ? [existingRecord] : [], event.id);

    const existingEntitlement = await ctx.db
      .query("entitlements")
      .withIndex("by_accountId", (q) => q.eq("accountId", event.accountId))
      .first();
    const entitlement = applyStripeWebhook(existingEntitlement, event, new Set());
    if (existingEntitlement) {
      await ctx.db.patch(existingEntitlement._id, cleanDoc(entitlement));
    } else {
      await ctx.db.insert("entitlements", cleanDoc(entitlement));
    }
    await ctx.db.insert("stripe_webhook_events", {
      eventId: event.id,
      type: event.type,
      processedAt: Date.now(),
    });
    return { accountId: event.accountId, tier: entitlement.tier, status: entitlement.status };
  },
});

export async function handleStripeWebhookForTest(input: {
  body: string;
  signature: string | null | undefined;
  webhookSecret: string;
  applyEvent: (event: NonNullable<ReturnType<typeof normalizeStripeWebhookEvent>>) => Promise<unknown>;
}): Promise<{ ignored: boolean; result?: unknown }> {
  const stripeEvent = verifyStripeWebhookPayload(input);
  const normalized = normalizeStripeWebhookEvent(stripeEvent);
  if (!normalized) return { ignored: true };
  return { ignored: false, result: await input.applyEvent(normalized) };
}

function cleanDoc<T extends Record<string, unknown>>(doc: T): T {
  return Object.fromEntries(Object.entries(doc).filter(([, value]) => value !== undefined)) as T;
}
