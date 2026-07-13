import { Platform } from "react-native";
import type { JSX } from "react";
import { useMemo } from "react";

import {
  PATRON_TIERS,
  PATRON_TIERS_BY_ID,
  type PatronTier,
  type PatronTierId,
} from "../../lib/billingConfig";
import { Soft } from "./variants/Soft";
import { Inline } from "./variants/Inline";
import { TopBar } from "./variants/TopBar";
import { selectPaywallVariant } from "./selectVariant";
import type {
  CandleState,
  PaywallReason,
  PaywallVariantKind,
  PaywallVariantProps,
} from "./types";

/**
 * Legacy plan id retained for backward compatibility with the older
 * `onSelectPlan` signature. The dispatcher now passes a richer tier id;
 * `unlimited` maps to Patron, `pro` to Magus.
 */
export type PaywallPlan = {
  id: "unlimited" | "pro";
  title: string;
  price: string;
  features: string[];
};

type PaywallPanelProps = {
  reason: PaywallReason;
  /**
   * Candle/turn state. Used by the variant selector to choose between
   * Soft / Inline / TopBar.
   */
  candle?: CandleState;
  /** Currently-resolved patron tier. Defaults to Wanderer. */
  currentTier?: PatronTier;
  /** Variant override for testing / storybook. */
  forceVariant?: PaywallVariantKind;
  /** Platform override. Defaults to `Platform.OS` detection. */
  nativePlatform?: boolean;
  onSubscribeTier?: (tierId: PatronTierId) => void;
  /** Back-compat: forwarded as `onSubscribeTier` mapping unlimited→patron, pro→magus. */
  onSelectPlan?: (plan: PaywallPlan["id"]) => void;
  onDismiss?: () => void;
  onOpenCompare?: () => void;
};

const VARIANTS: Record<
  PaywallVariantKind,
  (props: PaywallVariantProps) => JSX.Element
> = {
  soft: Soft,
  inline: Inline,
  topbar: TopBar,
};

const DEFAULT_CANDLE: CandleState = {
  turnsUsed: 0,
  turnsAllowed: 5,
};

export function PaywallPanel({
  reason,
  candle = DEFAULT_CANDLE,
  currentTier = PATRON_TIERS_BY_ID.wanderer,
  forceVariant,
  nativePlatform,
  onSubscribeTier,
  onSelectPlan,
  onDismiss,
  onOpenCompare,
}: PaywallPanelProps) {
  const variant: PaywallVariantKind = useMemo(() => {
    if (forceVariant) return forceVariant;
    return selectPaywallVariant({ candle, reason });
  }, [candle, forceVariant, reason]);

  const upgradeTiers = useMemo(() => {
    return PATRON_TIERS.filter(
      (tier) => tier.subscribable && tierRank(tier.id) > tierRank(currentTier.id),
    );
  }, [currentTier.id]);

  const subscribe = useMemo(() => {
    return (tierId: PatronTierId) => {
      onSubscribeTier?.(tierId);
      if (!onSelectPlan) return;
      const tier = PATRON_TIERS_BY_ID[tierId];
      if (tier.entitlement === "pro") onSelectPlan("pro");
      else if (tier.entitlement === "unlimited") onSelectPlan("unlimited");
    };
  }, [onSelectPlan, onSubscribeTier]);

  const isNative = nativePlatform ?? Platform.OS !== "web";

  const Variant = VARIANTS[variant];

  return (
    <Variant
      candle={candle}
      currentTier={currentTier}
      nativePlatform={isNative}
      onDismiss={onDismiss}
      onOpenCompare={onOpenCompare}
      onSubscribeTier={subscribe}
      reason={reason}
      upgradeTiers={upgradeTiers}
    />
  );
}

function tierRank(id: PatronTierId): number {
  switch (id) {
    case "wanderer":
      return 0;
    case "reader":
      return 1;
    case "patron":
      return 2;
    case "magus":
      return 3;
  }
}
