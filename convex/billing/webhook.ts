import Stripe from "stripe";

import { AppError } from "../lib/errors";
import type { StripeWebhookEvent } from "./stripe";

export type StripeWebhookRecord = {
  eventId: string;
  type: StripeWebhookEvent["type"];
  processedAt: number;
};

const HANDLED_EVENT_TYPES = new Set<StripeWebhookEvent["type"]>([
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
]);

export function verifyStripeWebhookPayload(input: {
  body: string;
  signature: string | null | undefined;
  webhookSecret: string;
}): Stripe.Event {
  if (!input.signature) throw new AppError("stripe_signature_required");
  const stripe = new Stripe("sk_test_signature_verification_only");
  return stripe.webhooks.constructEvent(input.body, input.signature, input.webhookSecret);
}

export function normalizeStripeWebhookEvent(event: Stripe.Event): StripeWebhookEvent | null {
  if (!HANDLED_EVENT_TYPES.has(event.type as StripeWebhookEvent["type"])) return null;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    return {
      id: event.id,
      type: event.type,
      customerId: asId(session.customer),
      ...optional("subscriptionId", asOptionalId(session.subscription)),
      accountId: requireMetadata(session.metadata, "accountId"),
      ...optional("tier", readTier(session.metadata)),
      status: "active",
      createdAt: event.created,
    };
  }

  if (event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    return {
      id: event.id,
      type: event.type,
      customerId: asId(invoice.customer),
      ...optional("subscriptionId", asOptionalId(subscriptionFromInvoice(invoice))),
      accountId: requireMetadata(invoice.parent?.subscription_details?.metadata, "accountId"),
      ...optional("tier", readTier(invoice.parent?.subscription_details?.metadata)),
      status: "active",
      createdAt: event.created,
    };
  }

  const subscription = event.data.object as Stripe.Subscription;
  const status = event.type === "customer.subscription.deleted" ? "expired" : stripeStatusToBillingStatus(subscription.status);
  return {
    id: event.id,
    type: event.type as "customer.subscription.updated" | "customer.subscription.deleted",
    customerId: asId(subscription.customer),
    subscriptionId: subscription.id,
    accountId: requireMetadata(subscription.metadata, "accountId"),
    ...optional("tier", readTier(subscription.metadata)),
    ...optional("status", status),
    ...optional("currentPeriodEnd", subscriptionEndedAt(subscription)),
    createdAt: event.created,
  };
}

export function assertStripeEventNotProcessed(records: StripeWebhookRecord[], eventId: string): void {
  if (records.some((record) => record.eventId === eventId)) {
    throw new AppError("duplicate_webhook_event");
  }
}

function requireMetadata(metadata: Stripe.Metadata | null | undefined, key: string): string {
  const value = metadata?.[key];
  if (!value) throw new AppError(`stripe_metadata_missing:${key}`);
  return value;
}

function readTier(metadata: Stripe.Metadata | null | undefined): StripeWebhookEvent["tier"] {
  const value = metadata?.targetTier;
  return value === "unlimited" || value === "pro" || value === "free" ? value : undefined;
}

function stripeStatusToBillingStatus(status: Stripe.Subscription.Status): StripeWebhookEvent["status"] {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due" || status === "unpaid") return "grace";
  if (status === "canceled" || status === "incomplete_expired") return "expired";
  return "revoked";
}

function asId(value: string | Stripe.Customer | Stripe.DeletedCustomer | null): string {
  if (!value) throw new AppError("stripe_id_missing");
  return typeof value === "string" ? value : value.id;
}

function asOptionalId(value: string | { id: string } | null | undefined): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.id;
}

function subscriptionFromInvoice(invoice: Stripe.Invoice): string | { id: string } | null | undefined {
  const invoiceWithSubscription = invoice as Stripe.Invoice & {
    subscription?: string | { id: string } | null;
  };
  return invoiceWithSubscription.subscription;
}

function subscriptionEndedAt(subscription: Stripe.Subscription): number | undefined {
  const subscriptionWithPeriod = subscription as Stripe.Subscription & {
    current_period_end?: number;
  };
  return subscriptionWithPeriod.current_period_end;
}

function optional<Key extends string, Value>(key: Key, value: Value | undefined): Record<Key, Value> | {} {
  return value === undefined ? {} : { [key]: value } as Record<Key, Value>;
}
