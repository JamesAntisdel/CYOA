import { View } from "react-native";

import { Button, Divider, Surface, Text } from "../../primitives";
import { useAppTheme } from "../../../theme";
import type { PaywallVariantProps } from "../types";

/**
 * Inline: slots into the next scene position.
 *
 * Fires on the last available turn (or for a Pro-only feature like
 * media on an uncapped tier). Reads as the next "page" rather than a
 * covering modal, so the reader can keep flowing and accept the
 * upgrade in-context. Copy never blames the reader.
 */
export function Inline({
  reason,
  candle,
  upgradeTiers,
  nativePlatform,
  onSubscribeTier,
  onDismiss,
  onOpenCompare,
}: PaywallVariantProps) {
  const { tokens } = useAppTheme();
  const isMedia = reason === "pro_media";

  return (
    <Surface
      accessibilityLabel={
        isMedia
          ? "Illustrate this scene with a Pro upgrade."
          : "One more turn until the candle gutters."
      }
      padded
      style={{ gap: tokens.spacing.md }}
      testID="paywall-variant-inline"
    >
      <View style={{ gap: tokens.spacing.xs }}>
        <Text
          muted
          style={{
            fontFamily: tokens.typography.families.mono,
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
          variant="caption"
        >
          {isMedia ? "Illuminations" : "One more turn"}
        </Text>
        <Text
          style={{
            fontFamily: tokens.typography.families.serif,
          }}
          variant="subtitle"
        >
          {isMedia
            ? "See this scene illustrated?"
            : candle.turnsAllowed !== null
              ? `Last turn of ${candle.turnsAllowed}. The next scene closes the book until tomorrow.`
              : "Keep the next scene moving."}
        </Text>
      </View>

      <Divider />

      <View style={{ gap: tokens.spacing.sm }}>
        {upgradeTiers.map((tier) => (
          <View
            key={tier.id}
            style={{
              alignItems: "center",
              flexDirection: "row",
              gap: tokens.spacing.md,
              justifyContent: "space-between",
            }}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: tokens.colors.accent,
                  fontFamily: tokens.typography.families.serif,
                }}
                variant="subtitle"
              >
                {tier.label} — {tier.priceLabel}
              </Text>
              <Text muted variant="caption">
                {tier.motto}
              </Text>
            </View>
            <Button
              accessibilityLabel={`Subscribe to ${tier.label}`}
              onPress={() => onSubscribeTier(tier.id)}
              variant="primary"
            >
              {nativePlatform ? "Store" : "Upgrade"}
            </Button>
          </View>
        ))}
      </View>

      <View
        style={{
          flexDirection: "row",
          gap: tokens.spacing.sm,
          justifyContent: "flex-end",
        }}
      >
        {onOpenCompare ? (
          <Button accessibilityLabel="Compare tiers" onPress={onOpenCompare} variant="ghost">
            Compare tiers
          </Button>
        ) : null}
        {onDismiss ? (
          <Button accessibilityLabel="Not now" onPress={onDismiss}>
            Not now
          </Button>
        ) : null}
      </View>
    </Surface>
  );
}
