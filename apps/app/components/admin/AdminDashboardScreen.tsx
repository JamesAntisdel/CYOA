import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "../../theme";
import { Chip, Stamp, Text } from "../primitives";
import { AdminGate } from "./AdminGate";
import { CostBoard, FunnelBoard, LiveBoard, SafetyBoard } from "./boards";
import type { AdminAccount, AdminDashboardData } from "./types";

export type AdminDashboardView = "overview" | "funnel" | "cost" | "safety" | "live";

type AdminDashboardScreenProps = {
  account: AdminAccount | null;
  dashboard: AdminDashboardData;
  view?: AdminDashboardView;
};

/**
 * Operator dashboard host. Canvas § 25 ("HCE.OperatorDashboard") lays
 * out four boards — Funnel, Cost, Safety, Live load — on one screen,
 * admin-only, with personal data redacted and no raw prose. The
 * unified overview renders all four; the deep-link views render just
 * the one board so the URL still points at a useful surface.
 *
 * Role gating happens at this component boundary via `AdminGate`.
 */
export function AdminDashboardScreen({
  account,
  dashboard,
  view = "overview",
}: AdminDashboardScreenProps) {
  const { tokens } = useAppTheme();

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: tokens.spacing.lg }}>
        <View
          style={{
            alignSelf: "center",
            gap: tokens.spacing.lg,
            maxWidth: 1120,
            width: "100%",
          }}
        >
          <AdminGate account={account}>
            <DashboardHeader dashboard={dashboard} view={view} />

            {view === "overview" || view === "funnel" ? (
              <FunnelBoard dashboard={dashboard} />
            ) : null}
            {view === "overview" || view === "cost" ? (
              <CostBoard dashboard={dashboard} />
            ) : null}
            {view === "overview" || view === "safety" ? (
              <SafetyBoard dashboard={dashboard} />
            ) : null}
            {view === "overview" || view === "live" ? (
              <LiveBoard dashboard={dashboard} />
            ) : null}
          </AdminGate>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

type DashboardHeaderProps = {
  dashboard: AdminDashboardData;
  view: AdminDashboardView;
};

function DashboardHeader({ dashboard, view }: DashboardHeaderProps) {
  const { tokens } = useAppTheme();

  return (
    <View style={{ gap: tokens.spacing.sm }}>
      <Stamp>operator · req 27 · admin only</Stamp>
      <Text variant="title">{titleForView(view)}</Text>
      <Text muted variant="bodySmall">
        Funnel, cost, safety, and live load — visible only to operators. Personal data redacted; no
        prose ever surfaces here.
      </Text>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: tokens.spacing.sm,
        }}
      >
        <Chip>{formatWindow(dashboard.window.from, dashboard.window.to)}</Chip>
        <Chip>{new Date(dashboard.generatedAt).toLocaleTimeString()}</Chip>
        <Chip>in-house analytics</Chip>
      </View>
    </View>
  );
}

function titleForView(view: AdminDashboardView): string {
  switch (view) {
    case "funnel":
      return "Funnel · the reader's ladder";
    case "cost":
      return "Cost · what every turn costs";
    case "safety":
      return "Safety · what the wards caught";
    case "live":
      return "Live · the room's pulse";
    default:
      return "The keeper's desk";
  }
}

function formatWindow(from: number, to: number): string {
  const hours = Math.max(1, Math.round((to - from) / (60 * 60 * 1000)));
  return `${hours}h window`;
}
