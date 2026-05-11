import { useCallback, useMemo, useState } from "react";
import { Platform, ScrollView, View } from "react-native";

import { PaywallPanel, TierCompare } from "../../components/paywall";
import type {
  CandleState,
  PaywallReason,
} from "../../components/paywall/types";
import { Surface, Text } from "../../components/primitives";
import { useAppTheme } from "../../theme";
import {
  PATRON_TIERS_BY_ID,
  resolvePatronTier,
  type PatronTierId,
} from "../../lib/billingConfig";
import { useAccountProfile } from "../../hooks/useAccountProfile";

/**
 * Paywall route. Composes:
 *
 * 1. The situational variant (Soft/Inline/TopBar) chosen by the
 *    candle/turns state and the paywall reason. Reasons in this demo
 *    can be overridden via the segmented selector so design wave 0
 *    review can flip through all variants.
 * 2. The patronage tier compare board (Wanderer / Reader / Patron /
 *    Magus). The CTA dispatches based on platform — native uses
 *    StoreKit / Play Billing rather than Stripe checkout.
 *
 * The "plan preview" surface below the board surfaces the server
 * confirmation copy used by older callers.
 */
export default function PaywallRoute() {
  const { tokens } = useAppTheme();
  const profile = useAccountProfile();
  const isNative = Platform.OS !== "web";

  const currentTier = useMemo(
    () =>
      resolvePatronTier({
        entitlement: "free",
        isClaimed: profile.profile?.kind === "claimed",
      }),
    [profile.profile?.kind],
  );

  const [reason, setReason] = useState<PaywallReason>("daily_limit");
  const [candle, setCandle] = useState<CandleState>(() => ({
    turnsUsed: currentTier.turnsPerDay ?? 0,
    turnsAllowed: currentTier.turnsPerDay,
    resetsInLabel: "7h 22m",
  }));
  const [preview, setPreview] = useState(
    "Choose a tier to preview server-confirmed pricing.",
  );

  const onSubscribeTier = useCallback(
    (tierId: PatronTierId) => {
      const tier = PATRON_TIERS_BY_ID[tierId];
      setPreview(
        isNative
          ? `${tier.label} preview: ${tier.priceLabel} ${tier.cycleLabel}. Native subscriptions route through the platform store (StoreKit / Play Billing).`
          : `${tier.label} preview: ${tier.priceLabel} ${tier.cycleLabel}. Web subscriptions confirm via Stripe checkout before access changes.`,
      );
    },
    [isNative],
  );

  return (
    <ScrollView
      contentContainerStyle={{
        backgroundColor: tokens.colors.background,
        flexGrow: 1,
        gap: tokens.spacing.lg,
        padding: tokens.spacing.lg,
      }}
    >
      <View
        accessibilityLabel="Paywall reason selector"
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: tokens.spacing.sm,
        }}
      >
        {([
          { id: "daily_limit", label: "Daily limit" },
          { id: "pro_media", label: "Pro media" },
          { id: "credits", label: "Credits" },
        ] as { id: PaywallReason; label: string }[]).map((option) => (
          <ReasonChip
            key={option.id}
            active={reason === option.id}
            label={option.label}
            onPress={() => {
              setReason(option.id);
              if (option.id === "daily_limit") {
                setCandle((current) => ({
                  ...current,
                  turnsUsed: current.turnsAllowed ?? 5,
                }));
              } else if (option.id === "pro_media") {
                setCandle((current) => ({
                  ...current,
                  turnsUsed: Math.max(
                    0,
                    (current.turnsAllowed ?? 5) - 1,
                  ),
                }));
              } else {
                setCandle((current) => ({
                  ...current,
                  turnsUsed: Math.max(0, (current.turnsAllowed ?? 5) - 2),
                }));
              }
            }}
          />
        ))}
      </View>

      <PaywallPanel
        candle={candle}
        currentTier={currentTier}
        nativePlatform={isNative}
        onSubscribeTier={onSubscribeTier}
        reason={reason}
      />

      <TierCompare
        currentTier={currentTier}
        nativePlatform={isNative}
        onSubscribeTier={onSubscribeTier}
      />

      <Surface padded style={{ gap: tokens.spacing.xs }}>
        <Text
          style={{ fontFamily: tokens.typography.families.serif }}
          variant="subtitle"
        >
          Plan preview
        </Text>
        <Text>{preview}</Text>
      </Surface>
    </ScrollView>
  );
}

function ReasonChip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const { tokens } = useAppTheme();
  return (
    <Text
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        backgroundColor: active ? tokens.colors.text : tokens.colors.surface,
        borderColor: tokens.colors.border,
        borderRadius: tokens.radii.pill,
        borderWidth: tokens.borderWidths.regular,
        color: active ? tokens.colors.background : tokens.colors.text,
        fontFamily: tokens.typography.families.mono,
        overflow: "hidden",
        paddingHorizontal: tokens.spacing.md,
        paddingVertical: tokens.spacing.xs,
      }}
      variant="caption"
    >
      {label}
    </Text>
  );
}
