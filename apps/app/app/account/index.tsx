import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Linking, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppNav } from "../../components/navigation";
import { Button, Chip, Divider, Field, Stamp, Surface, Text } from "../../components/primitives";
import { useAccountProfile } from "../../hooks/useAccountProfile";
import { createRemoteCustomerPortalSession } from "../../lib/gameApi";
import { useBreakpoint } from "../../lib/responsive";
import { useAppTheme } from "../../theme";

export default function AccountRoute() {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const { isPhone } = useBreakpoint();
  const {
    claimWithEmail,
    deleteAccountData,
    exportAccountData,
    profile,
    setMatureContentEnabled,
    signOut,
    updateDisplayName,
  } = useAccountProfile();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [claimError, setClaimError] = useState<string | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [matureError, setMatureError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [accountError, setAccountError] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);

  useEffect(() => {
    setDisplayName(profile?.name ?? "");
    setEmail(profile?.email ?? "");
  }, [profile?.email, profile?.name]);

  const handleNameSave = () => {
    setProfileMessage(null);
    setClaimError(null);
    try {
      const savedName = updateDisplayName(displayName);
      setDisplayName(savedName);
      setProfileMessage("Profile name updated.");
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : "display_name_update_failed");
    }
  };

  const handleClaim = async () => {
    setClaimError(null);
    setProfileMessage(null);
    try {
      await claimWithEmail(email);
      setProfileMessage(profile?.kind === "claimed" ? "Email updated." : "Profile claimed.");
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : "claim_failed");
    }
  };

  const toggleMature = async () => {
    if (!profile) return;
    setMatureError(null);
    try {
      await setMatureContentEnabled(!profile.matureContentEnabled);
    } catch (error) {
      setMatureError(error instanceof Error ? error.message : "mature_update_failed");
    }
  };

  const handleExport = async () => {
    setAccountError(null);
    setProfileMessage(null);
    try {
      const data = await exportAccountData();
      downloadJson(`cyoa-account-${profile?.accountId ?? "local"}.json`, data);
      setProfileMessage("Account export prepared.");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "account_export_failed");
    }
  };

  const isPaidPlan =
    profile?.entitlementTier === "unlimited" || profile?.entitlementTier === "pro";

  const handleManageSubscription = async () => {
    setAccountError(null);
    setProfileMessage(null);

    // Native subscriptions are owned by the platform store under app-store
    // policy — surface the platform-managed subscriptions URL rather than
    // Stripe's billing portal. The system handler picks the right app
    // (Settings on iOS, Play Store on Android).
    if (Platform.OS !== "web") {
      const url =
        Platform.OS === "ios"
          ? "https://apps.apple.com/account/subscriptions"
          : "https://play.google.com/store/account/subscriptions";
      try {
        await Linking.openURL(url);
      } catch (error) {
        setAccountError(
          error instanceof Error ? error.message : "platform_subscriptions_open_failed",
        );
      }
      return;
    }

    if (!profile?.accountId) {
      setAccountError("Sign in first to manage your subscription.");
      return;
    }

    // Mirror the paywall https guard — Stripe rejects http return URLs and
    // surfaces opaque "Invalid URL" failures from the billing portal create
    // call. Catching it client-side keeps the error reader-friendly.
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (!origin.startsWith("https://")) {
      setAccountError(
        "Stripe billing portal requires HTTPS — open the app at its HTTPS URL to manage your subscription.",
      );
      return;
    }

    setPortalBusy(true);
    try {
      const response = await createRemoteCustomerPortalSession({
        accountId: profile.accountId,
        returnUrl: `${origin}/account`,
      });
      if (response && response.url) {
        window.location.href = response.url;
        return;
      }
      setAccountError("Couldn't open billing portal — try again, or contact support.");
    } catch (error) {
      setAccountError(
        error instanceof Error ? error.message : "billing_portal_failed",
      );
    } finally {
      setPortalBusy(false);
    }
  };

  const handleDelete = async () => {
    setAccountError(null);
    setProfileMessage(null);
    if (deleteConfirm !== "DELETE") {
      setAccountError("Type DELETE to confirm account deletion.");
      return;
    }
    try {
      await deleteAccountData();
      setDeleteConfirm("");
      router.push("/");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "account_delete_failed");
    }
  };

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          // Tighter page padding on phone so the content surfaces don't lose
          // half the viewport to chrome on a 375px screen. xl on each side
          // (24+24=48px) eats too much horizontal real-estate; lg (16+16=32)
          // matches the breathing room used by the landing-mobile pass.
          gap: isPhone ? tokens.spacing.lg : tokens.spacing.xl,
          marginHorizontal: "auto",
          maxWidth: 980,
          padding: isPhone ? tokens.spacing.lg : tokens.spacing.xl,
          width: "100%",
        }}
      >
        <AppNav current="account" />

        <View style={{ gap: tokens.spacing.sm, maxWidth: 620 }}>
          <Stamp>account</Stamp>
          <Text variant="title">{profileTitle(profile?.kind)}</Text>
          <Text muted>
            Keep this profile readable, claim it with email, and manage account-level controls from one place.
          </Text>
        </View>

        {/*
         * Profile + edit two-column layout. On phone (< 520px) each Surface
         * spans the full row by widening `minWidth` to 100% so the columns
         * stack cleanly instead of wrapping mid-row. flexBasis 100% pins each
         * column to its own line on phone without giving up the side-by-side
         * desktop arrangement. Tablet+ keeps the original `minWidth: 320` so
         * the columns sit beside each other when the viewport allows it.
         */}
        <View style={{ alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.lg }}>
          <Surface
            padded
            style={isPhone ? { flexBasis: "100%", minWidth: "100%", width: "100%" } : { flex: 1, minWidth: 320 }}
          >
            <View style={{ gap: tokens.spacing.md }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                <Chip>{profile?.kind ?? "none"}</Chip>
                <Chip>{profile ? `${profile.entitlementTier} plan` : "no plan"}</Chip>
                <Chip>{formatAllowance(profile?.dailyAllowance)} turns</Chip>
              </View>
              <Divider />
              <InfoRow label="Name" value={profile?.name ?? "not set"} />
              <InfoRow label="Email" value={profile?.email ?? "not claimed"} />
              <InfoRow label="Age range" value={profile?.ageBand ?? "not selected"} />
              <InfoRow label="Plan status" value={profile ? `${profile.entitlementTier} (${profile.entitlementStatus})` : "none"} />
              <InfoRow label="18+ controls" value={profile?.canEnableMature ? "eligible" : "not eligible"} />
              <InfoRow label="Mature content" value={profile?.matureContentEnabled ? "enabled" : "disabled"} />
            </View>
          </Surface>

          <Surface
            padded
            style={isPhone ? { flexBasis: "100%", minWidth: "100%", width: "100%" } : { flex: 1, minWidth: 320 }}
            variant="muted"
          >
            <View style={{ gap: tokens.spacing.md }}>
              <Text variant="subtitle">Edit profile</Text>
              <View style={{ gap: tokens.spacing.sm }}>
                <Field
                  accessibilityLabel="Display name"
                  label="Display name"
                  onChangeText={setDisplayName}
                  placeholder="Reader name"
                  value={displayName}
                />
                {/*
                 * The display-name section's primary action is "Save name". The
                 * email-claim section below has its own primary ("Claim" /
                 * "Update email") — each form section gets exactly one primary
                 * CTA, never two side-by-side.
                 */}
                <Button disabled={!profile} onPress={handleNameSave} variant="primary">
                  Save name
                </Button>
              </View>

              {profile && profile.kind !== "user" ? (
                <View style={{ gap: tokens.spacing.sm }}>
                  <Field
                    accessibilityLabel="Email address"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    label="Email claim"
                    onChangeText={setEmail}
                    placeholder="reader@example.com"
                    value={email}
                  />
                  <Button onPress={handleClaim} variant="primary">
                    {profile.kind === "claimed" ? "Update email" : "Claim with email"}
                  </Button>
                </View>
              ) : null}

              {claimError ? <Text tone="danger">{claimError}</Text> : null}
              {profileMessage ? <Text muted>{profileMessage}</Text> : null}
            </View>
          </Surface>
        </View>

        <Surface padded>
          <View style={{ gap: tokens.spacing.md }}>
            <Text variant="subtitle">Account actions</Text>
            {/*
             * Button hierarchy here:
             *  - Exactly ONE primary action: "Sign in" (guest/claimed users)
             *    OR "Upgrade plan" (signed-in but on a free tier).
             *  - "Sign out" stays default — it's destructive-adjacent but not
             *    irreversible; reserve `danger` for delete.
             *  - Plan management buttons all use the default variant once a
             *    paid plan is active so they don't fight for attention.
             */}
            {/*
             * On phone, switch the action row to a vertical stack so each
             * action button spans the full Surface width and the touch
             * targets don't get squeezed under 44px when wrapping puts two
             * tiny buttons on one row. flexDirection toggles on the
             * breakpoint; the gap stays the same so spacing reads consistent.
             */}
            <View
              style={{
                flexDirection: isPhone ? "column" : "row",
                flexWrap: "wrap",
                gap: tokens.spacing.sm,
              }}
            >
              {profile?.kind !== "user" ? (
                <Button onPress={() => router.push("/login")} variant="primary">
                  Sign in or create account
                </Button>
              ) : (
                <Button onPress={signOut} variant="default">
                  Sign out
                </Button>
              )}
              <Button
                onPress={() => router.push("/paywall")}
                variant={profile?.kind === "user" && !isPaidPlan ? "primary" : "default"}
              >
                {isPaidPlan ? "Manage plan" : "Upgrade plan"}
              </Button>
              {isPaidPlan ? (
                <Button disabled={portalBusy} onPress={handleManageSubscription}>
                  {portalBusy ? "Opening subscription portal…" : "Manage subscription"}
                </Button>
              ) : null}
              {profile?.canEnableMature || profile?.matureContentEnabled ? (
                <Button onPress={toggleMature}>
                  {profile.matureContentEnabled ? "Disable mature content" : "Enable mature content"}
                </Button>
              ) : null}
            </View>
            {matureError ? <Text tone="danger">{matureError}</Text> : null}
            {accountError && profile?.kind !== "user" ? (
              <Text tone="danger">{accountError}</Text>
            ) : null}
          </View>
        </Surface>

        {profile?.kind === "user" ? (
          <Surface padded variant="muted">
            <View style={{ gap: tokens.spacing.md }}>
              <Text variant="subtitle">Privacy and data</Text>
              <Text muted>
                Download a copy of your profile, stories, endings, and account activity. Account deletion permanently removes private account data and removes your public stories from view.
              </Text>
              {/*
               * Export is benign — default variant. Delete is the only
               * destructive action on this surface; it gets the `danger`
               * variant rather than primary so it never reads as the
               * recommended path. Disabled until the user types DELETE.
               */}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                <Button disabled={!profile} onPress={handleExport}>
                  Export account data
                </Button>
              </View>
              {/*
               * Delete confirmation column. On phone we drop the 420px cap
               * so the Field is full-width — typing DELETE on a 375px
               * viewport in a half-width field is awkward and the cramped
               * label wrap pushes the destructive button below the fold.
               * On tablet+ the 420 cap returns to keep the danger surface
               * from feeling like a full content block. The Delete button
               * intentionally sits BELOW the field (column layout) so the
               * destructive action is never side-by-side with its
               * confirmation input.
               */}
              <View style={{ gap: tokens.spacing.sm, maxWidth: isPhone ? "100%" : 420 }}>
                <Field
                  accessibilityLabel="Delete confirmation"
                  autoCapitalize="characters"
                  label="Type DELETE to permanently delete this account"
                  onChangeText={setDeleteConfirm}
                  placeholder="DELETE"
                  value={deleteConfirm}
                />
                <Button
                  disabled={!profile || deleteConfirm !== "DELETE"}
                  onPress={handleDelete}
                  variant="danger"
                >
                  Delete account
                </Button>
              </View>
              {accountError ? <Text tone="danger">{accountError}</Text> : null}
            </View>
          </Surface>
        ) : null}

      </ScrollView>
    </SafeAreaView>
  );
}

function downloadJson(filename: string, data: Record<string, unknown>) {
  if (typeof document === "undefined") return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function profileTitle(kind: string | undefined): string {
  if (kind === "user") return "Signed-in profile";
  if (kind === "claimed") return "Claimed profile";
  if (kind === "guest") return "Guest profile";
  return "No local profile";
}

function formatAllowance(value: number | "unlimited" | undefined): string {
  if (value === "unlimited") return "unlimited";
  if (typeof value === "number") return `${value}`;
  return "not set";
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const { tokens } = useAppTheme();
  return (
    <View
      style={{
        alignItems: "center",
        borderBottomColor: tokens.colors.borderMuted,
        borderBottomWidth: tokens.borderWidths.hairline,
        flexDirection: "row",
        gap: tokens.spacing.md,
        justifyContent: "space-between",
        paddingVertical: tokens.spacing.sm,
      }}
    >
      <Text muted variant="bodySmall">{label}</Text>
      <Text style={{ fontWeight: "700", textAlign: "right" }} variant="bodySmall">{value}</Text>
    </View>
  );
}
