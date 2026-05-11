import { Platform, View } from "react-native";

import { Text } from "../primitives";
import { useAppTheme } from "../../theme";
import {
  PATRON_TIERS,
  type PatronTier,
  type PatronTierId,
} from "../../lib/billingConfig";
import { TierCard } from "./TierCard";

type TierCompareProps = {
  /** The viewer's current tier. Highlighted in the grid. */
  currentTier: PatronTier;
  /**
   * Platform override. Defaults to detecting native vs web via
   * `Platform.OS`. Native renders store-style CTAs.
   */
  nativePlatform?: boolean;
  onSubscribeTier?: (id: PatronTierId) => void;
};

/**
 * Four-tier patronage compare board.
 *
 * Surfaces limits, media tier, soft caps, and per-cycle price for
 * Wanderer / Reader / Patron / Magus. Native CTAs route through the
 * platform store (Apple StoreKit / Google Play Billing) instead of
 * Stripe checkout — see `TierCard` and the `app/paywall/index.tsx`
 * caller for the actual checkout dispatch.
 */
export function TierCompare({
  currentTier,
  nativePlatform,
  onSubscribeTier,
}: TierCompareProps) {
  const { tokens } = useAppTheme();
  const isNative = nativePlatform ?? Platform.OS !== "web";

  return (
    <View
      accessibilityLabel="Patronage tier comparison"
      style={{ gap: tokens.spacing.md }}
      testID="tier-compare-board"
    >
      <View style={{ gap: tokens.spacing.xs }}>
        <Text
          style={{ fontFamily: tokens.typography.families.serif }}
          variant="title"
        >
          The patrons&apos; ladder
        </Text>
        <Text muted variant="bodySmall">
          {isNative
            ? "Native subscriptions are billed through the App Store or Google Play. Cancel anytime from the platform settings."
            : "Web subscriptions are billed through Stripe. Cancel anytime from your account."}
        </Text>
      </View>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: tokens.spacing.md,
        }}
      >
        {PATRON_TIERS.map((tier) => (
          <TierCard
            isCurrent={tier.id === currentTier.id}
            key={tier.id}
            nativePlatform={isNative}
            onSubscribe={onSubscribeTier}
            tier={tier}
          />
        ))}
      </View>
    </View>
  );
}
