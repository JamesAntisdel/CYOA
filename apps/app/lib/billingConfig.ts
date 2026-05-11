// Patronage tier metadata for the client-facing pricing surface.
//
// Convex billing operates on the canonical entitlement tiers from
// `@cyoa/shared` (`free | unlimited | pro`). The reader surface presents
// four narrative-flavored "patronage" labels that map onto those tiers
// plus a guest-leaning `Wanderer` step. This file is the single source
// of truth for tier copy, pricing, and capability summaries used by
// `<TierCompare />`, the paywall variants, and the death/first-find
// gating logic.
//
// Convex remains authoritative. Anything written here is presentation
// only — see `convex/billing/entitlements.ts` for canonical limits.

import type { EntitlementTier } from "@cyoa/shared";

export type PatronTierId = "wanderer" | "reader" | "patron" | "magus";

export type MediaCapability = "none" | "ambient" | "illustrated" | "cinematic";

export type PatronTier = {
  id: PatronTierId;
  /** Maps onto the canonical Convex/shared entitlement tier. */
  entitlement: EntitlementTier;
  label: string;
  /** One-line motto for the tier card crest. */
  motto: string;
  /** Display price string, already localized to the platform. */
  priceLabel: string;
  /** Cents per cycle on web/Stripe. Native platforms render the storefront price. */
  webPriceCents: number;
  cycleLabel: string;
  /** Per-day soft cap. `null` means uncapped. */
  turnsPerDay: number | null;
  /** Memory window in turns the LLM retains. */
  memoryWindowTurns: number;
  media: MediaCapability;
  /** Cinematic Veo death playback eligibility (Pro/Magus only). */
  canPlayCinematicDeath: boolean;
  /** Marketing bullets surfaced in `<TierCard />`. */
  features: string[];
  /** Whether this tier is reachable via subscribe CTA from the paywall. */
  subscribable: boolean;
};

export const PATRON_TIERS: readonly PatronTier[] = [
  {
    id: "wanderer",
    entitlement: "free",
    label: "Wanderer",
    motto: "Travel light. The book gives you a candle.",
    priceLabel: "Free",
    webPriceCents: 0,
    cycleLabel: "no card needed",
    turnsPerDay: 5,
    memoryWindowTurns: 8,
    media: "none",
    canPlayCinematicDeath: false,
    features: [
      "Five turns each evening",
      "Starter adventures and tutorial",
      "Ending crypt across all guests",
    ],
    subscribable: false,
  },
  {
    id: "reader",
    entitlement: "free",
    label: "Reader",
    motto: "Claim your shelf. The book remembers you.",
    priceLabel: "Free, claimed",
    webPriceCents: 0,
    cycleLabel: "with an account",
    turnsPerDay: 10,
    memoryWindowTurns: 16,
    media: "none",
    canPlayCinematicDeath: false,
    features: [
      "Ten turns per day",
      "Personal endings crypt and saves",
      "Cross-device sync",
    ],
    subscribable: false,
  },
  {
    id: "patron",
    entitlement: "unlimited",
    label: "Patron",
    motto: "Keep the lamp lit. Read as long as you like.",
    priceLabel: "$10 / month",
    webPriceCents: 1000,
    cycleLabel: "per month",
    turnsPerDay: null,
    memoryWindowTurns: 64,
    media: "ambient",
    canPlayCinematicDeath: false,
    features: [
      "Unlimited general turns",
      "Longer memory window",
      "Ambient soundscapes",
    ],
    subscribable: true,
  },
  {
    id: "magus",
    entitlement: "pro",
    label: "Magus",
    motto: "Illuminations and final cinematics. The richest tier.",
    priceLabel: "$25 / month",
    webPriceCents: 2500,
    cycleLabel: "per month",
    turnsPerDay: null,
    memoryWindowTurns: 128,
    media: "cinematic",
    canPlayCinematicDeath: true,
    features: [
      "Everything in Patron",
      "Illustrated scenes and ambient sound",
      "Cinematic deaths the first time you find them",
      "Early access to seasonal endings",
    ],
    subscribable: true,
  },
] as const;

export const PATRON_TIERS_BY_ID: Record<PatronTierId, PatronTier> = PATRON_TIERS.reduce(
  (acc, tier) => {
    acc[tier.id] = tier;
    return acc;
  },
  {} as Record<PatronTierId, PatronTier>,
);

/**
 * Resolve the patron tier label for an account.
 * - Unauthenticated guests render as Wanderer.
 * - Claimed but free accounts render as Reader.
 * - Paid Unlimited maps to Patron, Pro to Magus.
 */
export function resolvePatronTier(input: {
  entitlement: EntitlementTier;
  isClaimed: boolean;
}): PatronTier {
  if (input.entitlement === "pro") return PATRON_TIERS_BY_ID.magus;
  if (input.entitlement === "unlimited") return PATRON_TIERS_BY_ID.patron;
  return input.isClaimed ? PATRON_TIERS_BY_ID.reader : PATRON_TIERS_BY_ID.wanderer;
}

/** Returns the next upgrade target above the current tier, or null at the top. */
export function nextUpgradeTier(current: PatronTierId): PatronTier | null {
  const order: PatronTierId[] = ["wanderer", "reader", "patron", "magus"];
  const idx = order.indexOf(current);
  if (idx < 0 || idx >= order.length - 1) return null;
  for (let i = idx + 1; i < order.length; i += 1) {
    const nextId = order[i];
    if (!nextId) continue;
    const next = PATRON_TIERS_BY_ID[nextId];
    if (next.subscribable) return next;
  }
  return null;
}
