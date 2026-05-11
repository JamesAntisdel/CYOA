import { AppError } from "../lib/errors";

export type BillingInterval = "monthly" | "annual";
export type PaidTier = "unlimited" | "pro";

export type StripePriceConfig = Record<PaidTier, Record<BillingInterval, string>>;

export const STRIPE_PRICE_ENV_KEYS = {
  unlimited: {
    monthly: "STRIPE_PRICE_UNLIMITED_MONTHLY",
    annual: "STRIPE_PRICE_UNLIMITED_ANNUAL",
  },
  pro: {
    monthly: "STRIPE_PRICE_PRO_MONTHLY",
    annual: "STRIPE_PRICE_PRO_ANNUAL",
  },
} as const;

export function readStripePriceConfig(env: Record<string, string | undefined> = process.env): StripePriceConfig {
  return {
    unlimited: {
      monthly: requireEnv(env, STRIPE_PRICE_ENV_KEYS.unlimited.monthly),
      annual: requireEnv(env, STRIPE_PRICE_ENV_KEYS.unlimited.annual),
    },
    pro: {
      monthly: requireEnv(env, STRIPE_PRICE_ENV_KEYS.pro.monthly),
      annual: requireEnv(env, STRIPE_PRICE_ENV_KEYS.pro.annual),
    },
  };
}

export function getStripePriceId(input: {
  prices: StripePriceConfig;
  tier: PaidTier;
  interval: BillingInterval;
}): string {
  return input.prices[input.tier][input.interval];
}

export function requireStripeWebhookSecret(env: Record<string, string | undefined> = process.env): string {
  return requireEnv(env, "STRIPE_WEBHOOK_SECRET");
}

export function requireStripeSecretKey(env: Record<string, string | undefined> = process.env): string {
  return requireEnv(env, "STRIPE_SECRET_KEY");
}

function requireEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value || value.trim().length === 0) throw new AppError(`missing_env:${key}`);
  return value;
}
