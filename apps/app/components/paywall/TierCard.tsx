import { Platform, View, type DimensionValue } from "react-native";

import { Button, Stamp, Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";
import type { PatronTier, PatronTierId } from "../../lib/billingConfig";

type TierCardProps = {
  tier: PatronTier;
  isCurrent: boolean;
  /**
   * Whether the platform is iOS/Android. Native uses StoreKit /
   * Play Billing instead of Stripe checkout — the CTA copy reflects
   * that.
   */
  nativePlatform?: boolean | undefined;
  onSubscribe?: ((id: PatronTierId) => void) | undefined;
  /**
   * Flex basis override from the compare board's responsive grid. When the
   * parent decides the column count (1 on phone, 2 on tablet, 4 on desktop),
   * it pins each card to the corresponding flexBasis so cards never reflow
   * into orphan rows at borderline widths. Accepts the same dimension
   * primitives as ViewStyle.flexBasis (number, "<n>%", "auto").
   */
  cardBasis?: DimensionValue;
};

/**
 * Single tier card in the patronage compare board.
 *
 * Renders the tier crest (stamp), motto, price, soft caps, included
 * media tier, feature bullets, and a tier-appropriate CTA. The current
 * tier renders a "you are here" marker and no upgrade button.
 */
export function TierCard({
  tier,
  isCurrent,
  nativePlatform,
  onSubscribe,
  cardBasis,
}: TierCardProps) {
  const { tokens } = useAppTheme();
  const isNative = nativePlatform ?? Platform.OS !== "web";

  return (
    <Surface
      accessibilityLabel={`${tier.label} tier${isCurrent ? " — your current tier" : ""}`}
      padded
      style={{
        borderColor: isCurrent ? tokens.colors.accent : tokens.colors.border,
        // flexBasis controls the column count from TierCompare. When unset
        // we fall back to the original "fill remaining row, never less than
        // 220" sizing so existing call sites stay visually identical.
        flexBasis: cardBasis,
        flexGrow: 1,
        flexShrink: 1,
        gap: tokens.spacing.sm,
        minWidth: cardBasis === undefined ? 220 : 0,
      }}
      testID={`tier-card-${tier.id}`}
    >
      <View
        style={{
          alignItems: "center",
          flexDirection: "row",
          gap: tokens.spacing.sm,
          justifyContent: "space-between",
        }}
      >
        <Stamp>{tier.label}</Stamp>
        {isCurrent ? (
          <Text
            style={{
              color: tokens.colors.accent,
              fontFamily: tokens.typography.families.mono,
              textTransform: "uppercase",
            }}
            variant="caption"
          >
            ★ you are here
          </Text>
        ) : null}
      </View>

      <Text
        style={{
          fontFamily: tokens.typography.families.serif,
          fontStyle: "italic",
        }}
        variant="subtitle"
      >
        {tier.motto}
      </Text>

      <View
        style={{
          flexDirection: "row",
          alignItems: "baseline",
          gap: tokens.spacing.sm,
        }}
      >
        <Text
          style={{
            color: tokens.colors.accent,
            fontFamily: tokens.typography.families.serif,
            fontWeight: "700",
          }}
          variant="title"
        >
          {tier.priceLabel}
        </Text>
        <Text muted variant="caption">
          {tier.cycleLabel}
        </Text>
      </View>

      <View style={{ gap: tokens.spacing.xs }}>
        <Text muted variant="caption">
          {tier.turnsPerDay === null
            ? "Turns: unlimited"
            : `Turns: ${tier.turnsPerDay} per day`}
        </Text>
        <Text muted variant="caption">
          Memory window: {tier.memoryWindowTurns} turns
        </Text>
        <Text muted variant="caption">
          Media: {describeMedia(tier.media)}
        </Text>
        {tier.canPlayCinematicDeath ? (
          <Text muted variant="caption">
            Cinematic deaths on first find
          </Text>
        ) : null}
      </View>

      <View style={{ gap: tokens.spacing.xs }}>
        {tier.features.map((feature) => (
          <Text key={feature} variant="bodySmall">
            ○ {feature}
          </Text>
        ))}
      </View>

      {tier.subscribable && !isCurrent && onSubscribe ? (
        <Button
          accessibilityLabel={`Subscribe to ${tier.label}`}
          onPress={() => onSubscribe(tier.id)}
          variant="primary"
        >
          {isNative ? `Subscribe via store` : `Subscribe to ${tier.label}`}
        </Button>
      ) : null}
    </Surface>
  );
}

function describeMedia(kind: PatronTier["media"]): string {
  switch (kind) {
    case "none":
      return "Text only";
    case "ambient":
      return "Ambient soundscapes";
    case "illustrated":
      return "Scene illustrations";
    case "cinematic":
      return "Cinematics + illustrations";
  }
}
