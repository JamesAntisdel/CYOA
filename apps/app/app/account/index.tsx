import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppNav } from "../../components/navigation";
import { Button, Chip, Divider, Stamp, Surface, Text } from "../../components/primitives";
import { useAccountProfile } from "../../hooks/useAccountProfile";
import { useAppTheme } from "../../theme";

export default function AccountRoute() {
  const router = useRouter();
  const { tokens } = useAppTheme();
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
          gap: tokens.spacing.xl,
          marginHorizontal: "auto",
          maxWidth: 980,
          padding: tokens.spacing.xl,
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

        <View style={{ alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.lg }}>
          <Surface padded style={{ flex: 1, minWidth: 320 }}>
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

          <Surface padded style={{ flex: 1, minWidth: 320 }} variant="muted">
            <View style={{ gap: tokens.spacing.md }}>
              <Text variant="subtitle">Edit profile</Text>
              <View style={{ gap: tokens.spacing.sm }}>
                <Text muted variant="caption">Display name</Text>
                <TextInput
                  accessibilityLabel="Display name"
                  onChangeText={setDisplayName}
                  placeholder="Reader name"
                  placeholderTextColor={tokens.colors.textFaint}
                  style={{
                    backgroundColor: tokens.colors.surface,
                    borderColor: tokens.colors.borderMuted,
                    borderRadius: tokens.radii.md,
                    borderWidth: tokens.borderWidths.regular,
                    color: tokens.colors.text,
                    minHeight: 46,
                    paddingHorizontal: tokens.spacing.md,
                  }}
                  value={displayName}
                />
                <Button disabled={!profile} onPress={handleNameSave}>Save name</Button>
              </View>

              {profile && profile.kind !== "user" ? (
                <View style={{ gap: tokens.spacing.sm }}>
                  <Text muted variant="caption">Email claim</Text>
                  <TextInput
                    accessibilityLabel="Email address"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    onChangeText={setEmail}
                    placeholder="reader@example.com"
                    placeholderTextColor={tokens.colors.textFaint}
                    style={{
                      backgroundColor: tokens.colors.surface,
                      borderColor: tokens.colors.borderMuted,
                      borderRadius: tokens.radii.md,
                      borderWidth: tokens.borderWidths.regular,
                      color: tokens.colors.text,
                      minHeight: 46,
                      paddingHorizontal: tokens.spacing.md,
                    }}
                    value={email}
                  />
                  <Button onPress={handleClaim} variant="primary">
                    {profile.kind === "claimed" ? "Update email" : "Claim with email"}
                  </Button>
                </View>
              ) : null}

              {claimError ? <Text style={{ color: tokens.colors.danger }}>{claimError}</Text> : null}
              {profileMessage ? <Text muted>{profileMessage}</Text> : null}
            </View>
          </Surface>
        </View>

        <Surface padded>
          <View style={{ gap: tokens.spacing.md }}>
            <Text variant="subtitle">Account actions</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
              {profile?.kind !== "user" ? (
                <Button onPress={() => router.push("/login")} variant="primary">
                  Sign in or create account
                </Button>
              ) : (
                <Button onPress={signOut}>Sign out</Button>
              )}
              {profile?.canEnableMature || profile?.matureContentEnabled ? (
                <Button onPress={toggleMature}>
                  {profile.matureContentEnabled ? "Disable mature content" : "Enable mature content"}
                </Button>
              ) : null}
            </View>
            {matureError ? <Text style={{ color: tokens.colors.danger }}>{matureError}</Text> : null}
          </View>
        </Surface>

        {profile?.kind === "user" ? (
          <Surface padded variant="muted">
            <View style={{ gap: tokens.spacing.md }}>
              <Text variant="subtitle">Privacy and data</Text>
              <Text muted>
                Download a copy of your profile, stories, endings, and account activity. Account deletion permanently removes private account data and removes your public stories from view.
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                <Button disabled={!profile} onPress={handleExport}>
                  Export account data
                </Button>
              </View>
              <View style={{ gap: tokens.spacing.sm, maxWidth: 420 }}>
                <Text muted variant="caption">Type DELETE to permanently delete this account</Text>
                <TextInput
                  accessibilityLabel="Delete confirmation"
                  autoCapitalize="characters"
                  onChangeText={setDeleteConfirm}
                  placeholder="DELETE"
                  placeholderTextColor={tokens.colors.textFaint}
                  style={{
                    backgroundColor: tokens.colors.surface,
                    borderColor: tokens.colors.borderMuted,
                    borderRadius: tokens.radii.md,
                    borderWidth: tokens.borderWidths.regular,
                    color: tokens.colors.text,
                    minHeight: 46,
                    paddingHorizontal: tokens.spacing.md,
                  }}
                  value={deleteConfirm}
                />
                <Button disabled={!profile || deleteConfirm !== "DELETE"} onPress={handleDelete} variant="ghost">
                  Delete account
                </Button>
              </View>
              {accountError ? <Text style={{ color: tokens.colors.danger }}>{accountError}</Text> : null}
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
