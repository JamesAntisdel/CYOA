import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAccountProfile } from "../../hooks/useAccountProfile";

export default function AccountRoute() {
  const { clearGuestSession, profile } = useAccountProfile();

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.header}>
        <Text style={styles.kicker}>Account</Text>
        <Text style={styles.title}>{profile ? "Guest profile" : "No local profile"}</Text>
        <Text style={styles.copy}>
          Claiming an account keeps saves portable. Mature controls stay unavailable unless a paid authenticated 18+ account explicitly opts in.
        </Text>
      </View>

      <View style={styles.panel}>
        <InfoRow label="Status" value={profile?.kind ?? "none"} />
        <InfoRow label="Age range" value={profile?.ageBand ?? "not selected"} />
        <InfoRow label="Data export" value={profile?.exportReady ? "available" : "unavailable"} />
        <InfoRow label="18+ controls" value={profile?.canEnableMature ? "eligible" : "not eligible"} />
      </View>

      <View style={styles.actions}>
        <Pressable accessibilityRole="button" style={styles.primaryButton}>
          <Text style={styles.primaryText}>Claim with email</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>Export account data</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={clearGuestSession} style={styles.dangerButton}>
          <Text style={styles.dangerText}>Delete local guest profile</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: "#efe2c8",
    flexGrow: 1,
    gap: 18,
    padding: 18,
  },
  header: {
    gap: 8,
    maxWidth: 760,
  },
  kicker: {
    color: "#7b5a35",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  title: {
    color: "#24180f",
    fontSize: 30,
    fontWeight: "800",
  },
  copy: {
    color: "#594635",
    fontSize: 15,
    lineHeight: 22,
  },
  panel: {
    backgroundColor: "#fff8ea",
    borderColor: "#d5b98f",
    borderWidth: 1,
    maxWidth: 760,
  },
  row: {
    borderBottomColor: "#ead9bd",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    padding: 14,
  },
  rowLabel: {
    color: "#594635",
    fontSize: 14,
    fontWeight: "700",
  },
  rowValue: {
    color: "#24180f",
    fontSize: 14,
    fontWeight: "800",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#2d1d12",
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 16,
  },
  primaryText: {
    color: "#fff8ea",
    fontSize: 15,
    fontWeight: "800",
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#7b5a35",
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 16,
  },
  secondaryText: {
    color: "#2d1d12",
    fontSize: 15,
    fontWeight: "800",
  },
  dangerButton: {
    alignItems: "center",
    borderColor: "#8f1d18",
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 16,
  },
  dangerText: {
    color: "#8f1d18",
    fontSize: 15,
    fontWeight: "800",
  },
});
