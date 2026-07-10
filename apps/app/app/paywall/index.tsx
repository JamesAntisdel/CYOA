import { useCallback, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";

import { AppNav, BackToSceneButton } from "../../components/navigation";
import { PaywallPanel, TierCompare } from "../../components/paywall";
import type {
  CandleState,
  PaywallReason,
} from "../../components/paywall/types";
import { Chip, Surface, Text } from "../../components/primitives";
import { useAppTheme } from "../../theme";
import {
  PATRON_TIERS_BY_ID,
  resolvePatronTier,
  type PatronTierId,
} from "../../lib/billingConfig";
import { useAccountProfile } from "../../hooks/useAccountProfile";
import { createRemoteCheckoutSession } from "../../lib/gameApi";
import { useBreakpoint } from "../../lib/responsive";

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
 * confirmation copy used by older callers and inline error messages
 * surfaced from Stripe checkout attempts.
 */
export default function PaywallRoute() {
  const { tokens } = useAppTheme();
  const { isPhone } = useBreakpoint();
  const accountProfile = useAccountProfile();
  const profile = accountProfile.profile;
  const isNative = Platform.OS !== "web";

  const currentTier = useMemo(
    () =>
      resolvePatronTier({
        entitlement: profile?.entitlementTier ?? "free",
        isClaimed: profile?.kind === "claimed" || profile?.kind === "user",
      }),
    [profile?.entitlementTier, profile?.kind],
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
  const [busy, setBusy] = useState(false);

  const onSubscribeTier = useCallback(
    async (tierId: PatronTierId) => {
      const tier = PATRON_TIERS_BY_ID[tierId];

      // Native subscriptions must use StoreKit / Play Billing per app-store
      // policy — Stripe checkout URLs cannot be opened from the native shell.
      // Keep the preview-only behavior until LR-5 wires native IAP.
      if (isNative) {
        setPreview(
          `${tier.label} preview: ${tier.priceLabel} ${tier.cycleLabel}. Native subscriptions route through the platform store (StoreKit / Play Billing).`,
        );
        return;
      }

      // Free tiers aren't reachable through Stripe checkout — Wanderer is
      // the guest default and Reader is the claimed-but-free step. Send the
      // reader to /login to claim instead.
      if (!tier.subscribable) {
        if (!profile || profile.kind === "guest") {
          setPreview("Sign in to claim Reader — head to /login to set an email and unlock the claimed shelf.");
        } else {
          setPreview(
            `${tier.label} preview: ${tier.priceLabel} ${tier.cycleLabel}. This tier doesn't require a subscription.`,
          );
        }
        return;
      }

      if (!profile?.accountId) {
        setPreview("Sign in first — Stripe checkout needs an account to attach the subscription to.");
        return;
      }

      // Map the visual patron tier onto the canonical billing tier the
      // server's `createCheckoutSession` understands. The patron config
      // already pins entitlement — Patron→unlimited, Magus→pro — so we
      // reuse that mapping. Interval defaults to monthly; the annual
      // variant is wired server-side but the UI currently shows monthly
      // pricing only (see config.ts: priceLabel "$10 / month" etc).
      const targetTier: "unlimited" | "pro" | null =
        tier.entitlement === "unlimited" || tier.entitlement === "pro"
          ? tier.entitlement
          : null;
      if (!targetTier) {
        setPreview("This tier can't be subscribed to.");
        return;
      }

      // Stripe rejects http success/cancel URLs outside the test sandbox and
      // returns an opaque "Invalid URL" error. Guard against local-dev http
      // origins before we even hit the server.
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      if (!origin.startsWith("https://")) {
        setPreview(
          "Stripe checkout requires HTTPS — open the app at its HTTPS URL to subscribe.",
        );
        return;
      }

      setBusy(true);
      setPreview(`Starting ${tier.label} checkout…`);
      try {
        const response = await createRemoteCheckoutSession({
          accountId: profile.accountId,
          targetTier,
          interval: "monthly",
          successUrl: `${origin}/account?checkout=success`,
          cancelUrl: `${origin}/paywall?checkout=cancel`,
        });
        if (response && response.url) {
          // Stripe-hosted checkout — navigate the whole tab so the redirect
          // back lands on /account with our success query flag.
          window.location.href = response.url;
          return;
        }
        setPreview("Couldn't start checkout — try again, or contact support.");
      } catch (error) {
        console.error("[paywall] createCheckoutSession failed", error);
        setPreview("Couldn't start checkout — try again, or contact support.");
      } finally {
        setBusy(false);
      }
    },
    [isNative, profile],
  );

  return (
    <ScrollView
      contentContainerStyle={{
        backgroundColor: tokens.colors.background,
        flexGrow: 1,
        gap: isPhone ? tokens.spacing.md : tokens.spacing.lg,
        // Phone padding stays at md (12px) — paywall content is dense and
        // pulling the gutter in another 4px on each side lets the Plan
        // preview Surface and TierCompare cards breathe at 375px.
        padding: isPhone ? tokens.spacing.md : tokens.spacing.lg,
      }}
    >
      {/* Top-nav and back-affordance for parity with the other
          account-adjacent surfaces. The paywall is reached from
          /account, so the canonical back target is /account when
          no router history exists (deep link). */}
      <AppNav current="account" />
      <BackToSceneButton
        fallbackHref="/account"
        label="← Back to account"
        accessibilityLabel="Back to account"
      />

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
        <Text>{busy ? "Working…" : preview}</Text>
      </Surface>
    </ScrollView>
  );
}

/**
 * Pressable wrapper around the canonical `Chip` primitive for the
 * paywall-reason selector. Centering the selection treatment in Chip
 * (variant="accent" when active) keeps the pill identical to every other
 * chip surface in the app — see also the entitlement chips in
 * `apps/app/app/account/index.tsx`. We only own the *selection* affordance
 * here; the chip's typography, border, and radius are owned by primitives.
 */
function ReasonChip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  // Pressable wraps the visual Chip but the Chip's intrinsic height
  // (body line + xs padding * 2) lands around 28-30px — below the WCAG
  // 2.5.5 / iOS HIG 44pt touch minimum. We set `minHeight: 44` on the
  // Pressable so the tap target hits target on phones even though the
  // pill stays visually compact.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{ justifyContent: "center", minHeight: 44 }}
    >
      <Chip variant={active ? "accent" : "default"}>{label}</Chip>
    </Pressable>
  );
}
