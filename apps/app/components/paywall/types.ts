import type { PatronTier, PatronTierId } from "../../lib/billingConfig";

export type PaywallReason = "daily_limit" | "pro_media" | "credits";

export type PaywallVariantKind = "soft" | "inline" | "topbar";

/** Candle/turn state the dispatcher uses to pick a variant. */
export type CandleState = {
  /** Turns the reader has spent today. */
  turnsUsed: number;
  /** Total per-day cap. `null` = uncapped. */
  turnsAllowed: number | null;
  /** Optional human label describing when the candle re-lights. */
  resetsInLabel?: string | undefined;
};

/** Resolved upgrade actions a paywall variant can offer. */
export type PaywallActions = {
  onSubscribeTier: (tierId: PatronTierId) => void;
  onDismiss?: (() => void) | undefined;
  onOpenCompare?: (() => void) | undefined;
};

export type PaywallVariantProps = {
  reason: PaywallReason;
  candle: CandleState;
  /** Currently-resolved tier. Used to label CTA targets. */
  currentTier: PatronTier;
  /** Tiers the reader can upgrade into. Ordered cheapest-first. */
  upgradeTiers: readonly PatronTier[];
  /** Whether the platform is iOS/Android (uses StoreKit/Play Billing). */
  nativePlatform?: boolean | undefined;
} & PaywallActions;

export type PaywallSelectionInput = {
  candle: CandleState;
  reason: PaywallReason;
};
