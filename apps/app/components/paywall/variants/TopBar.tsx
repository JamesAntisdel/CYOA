import { View } from "react-native";

import { Button, Text } from "../../primitives";
import { useAppTheme } from "../../../theme";
import type { PaywallVariantProps } from "../types";

/**
 * TopBar: thin ribbon when turns remain.
 *
 * The most ambient variant. Surfaces remaining-turns count plus a
 * single upgrade affordance for the next tier. Does not block reading
 * — the reader is still actively in the loop and just needs visibility
 * into the candle.
 */
export function TopBar({
  candle,
  upgradeTiers,
  currentTier,
  nativePlatform,
  onSubscribeTier,
  onOpenCompare,
}: PaywallVariantProps) {
  const { tokens } = useAppTheme();
  const target = upgradeTiers[0];

  const remainingLabel = candle.turnsAllowed === null
    ? "Unlimited reading"
    : `Turns ${candle.turnsUsed}/${candle.turnsAllowed} today`;

  return (
    <View
      accessibilityLabel={
        candle.turnsAllowed === null
          ? `${currentTier.label}: unlimited reading.`
          : `${remainingLabel}. Upgrade to ${target?.label ?? currentTier.label}.`
      }
      style={{
        alignItems: "center",
        backgroundColor: tokens.colors.surfaceMuted,
        borderColor: tokens.colors.borderMuted,
        borderRadius: tokens.radii.pill,
        borderWidth: tokens.borderWidths.hairline,
        flexDirection: "row",
        gap: tokens.spacing.sm,
        justifyContent: "space-between",
        paddingHorizontal: tokens.spacing.md,
        paddingVertical: tokens.spacing.xs,
      }}
      testID="paywall-variant-topbar"
    >
      <Text
        style={{
          fontFamily: tokens.typography.families.mono,
        }}
        variant="caption"
      >
        {remainingLabel}
      </Text>
      <View style={{ alignItems: "center", flexDirection: "row", gap: tokens.spacing.sm }}>
        {onOpenCompare ? (
          <Button accessibilityLabel="Compare tiers" onPress={onOpenCompare} variant="ghost">
            Compare
          </Button>
        ) : null}
        {target ? (
          <Button
            accessibilityLabel={`Upgrade to ${target.label}`}
            onPress={() => onSubscribeTier(target.id)}
            style={{
              backgroundColor: tokens.colors.accent,
              borderColor: tokens.colors.accent,
              minHeight: 36,
              paddingVertical: tokens.spacing.xs,
            }}
            variant="primary"
          >
            {nativePlatform ? `Store · ${target.label}` : `Upgrade · ${target.label}`}
          </Button>
        ) : null}
      </View>
    </View>
  );
}
