import { View } from "react-native";

import { Button, Surface, Text } from "../../primitives";
import { useAppTheme } from "../../../theme";
import type { PaywallVariantProps } from "../types";

/**
 * Soft: today's candle has burned. Blocking modal-style card.
 *
 * Fires when the reader has used every available daily turn. Copy
 * never blames the reader — the book "closes itself" — and offers a
 * single upgrade CTA per available tier plus a quiet "comes back
 * tomorrow" footer. Always reachable: every variant is dismissible
 * so the reader can return to the library.
 */
export function Soft({
  candle,
  upgradeTiers,
  currentTier,
  nativePlatform,
  onSubscribeTier,
  onDismiss,
  onOpenCompare,
}: PaywallVariantProps) {
  const { tokens } = useAppTheme();

  return (
    <Surface
      accessibilityLabel="Daily turns reached. Upgrade or return tomorrow."
      padded
      style={{ gap: tokens.spacing.md }}
      testID="paywall-variant-soft"
      variant="muted"
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
          The candle gutters…
        </Text>
        <Text
          style={{
            fontFamily: tokens.typography.families.serif,
            fontStyle: "italic",
          }}
          variant="title"
        >
          You&apos;ve reached today&apos;s turn.
        </Text>
        <Text muted>
          {candle.turnsAllowed !== null
            ? `${candle.turnsUsed} of ${candle.turnsAllowed} turns used. The book closes itself until tomorrow — or:`
            : "The book closes for a moment. To keep reading:"}
        </Text>
      </View>

      <View style={{ gap: tokens.spacing.sm }}>
        {upgradeTiers.map((tier) => (
          <Surface key={tier.id} padded style={{ gap: tokens.spacing.xs }}>
            <Text
              style={{
                color: tokens.colors.accent,
                fontFamily: tokens.typography.families.serif,
              }}
              variant="subtitle"
            >
              {tier.label} — {tier.priceLabel}
            </Text>
            <Text muted variant="bodySmall">
              {tier.motto}
            </Text>
            <Button
              accessibilityLabel={`Subscribe to ${tier.label}`}
              onPress={() => onSubscribeTier(tier.id)}
              variant="primary"
            >
              {nativePlatform ? `Subscribe via store` : `Subscribe`}
            </Button>
          </Surface>
        ))}
      </View>

      <View
        style={{
          alignItems: "center",
          flexDirection: "row",
          gap: tokens.spacing.sm,
          justifyContent: "space-between",
        }}
      >
        <Text muted variant="caption">
          {candle.resetsInLabel
            ? `Resets in ${candle.resetsInLabel}`
            : `You are reading as ${currentTier.label}.`}
        </Text>
        <View style={{ flexDirection: "row", gap: tokens.spacing.sm }}>
          {onOpenCompare ? (
            <Button accessibilityLabel="Compare tiers" onPress={onOpenCompare} variant="ghost">
              Compare tiers
            </Button>
          ) : null}
          {onDismiss ? (
            <Button accessibilityLabel="Return tomorrow" onPress={onDismiss}>
              Return tomorrow
            </Button>
          ) : null}
        </View>
      </View>
    </Surface>
  );
}
