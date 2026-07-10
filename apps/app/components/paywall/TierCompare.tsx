import { Platform, View, type DimensionValue } from "react-native";

import { Text } from "../primitives";
import { useAppTheme } from "../../theme";
import {
  PATRON_TIERS,
  type PatronTier,
  type PatronTierId,
} from "../../lib/billingConfig";
import { useBreakpoint } from "../../lib/responsive";
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
  const { isPhone, isTablet } = useBreakpoint();
  const isNative = nativePlatform ?? Platform.OS !== "web";

  // Responsive column count. The intrinsic minWidth on TierCard (220) already
  // forces a single-column layout below ~480px under flex-wrap, but we set
  // explicit flexBasis values per breakpoint to lock the column count and
  // avoid one-card-in-row-two reflow at borderline widths.
  //   phone    (<520):  1 column   — full width per card.
  //   tablet   (520-768): 2 columns — calc(50% - gap) split.
  //   desktop  (≥768):   4 columns — original ladder layout.
  // The TierCard surface already grows to fill via `flex: 1`; we only need
  // to pin flexBasis to control wrap points.
  const cardBasis: DimensionValue = isPhone
    ? "100%"
    : isTablet
      ? "48%"
      : 220;

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
          flexDirection: isPhone ? "column" : "row",
          flexWrap: "wrap",
          gap: tokens.spacing.md,
        }}
      >
        {PATRON_TIERS.map((tier) => (
          <TierCard
            cardBasis={cardBasis}
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
