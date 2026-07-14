import { useRouter } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "../../theme";
import { Chip, Stamp, Text } from "../primitives";
import { AdminGate } from "./AdminGate";
import {
  CostBoard,
  FunnelBoard,
  LiveBoard,
  ModerationBoard,
  SafetyBoard,
  StoriesBoard,
  UsersBoard,
} from "./boards";
import type { AdminAccount, AdminDashboardData } from "./types";

export type AdminDashboardView =
  | "overview"
  | "funnel"
  | "cost"
  | "safety"
  | "live"
  | "stories"
  | "users"
  | "moderation";

// The content views (stories / users / moderation) self-fetch their admin-gated
// data via their own hooks, so they don't consume the passed `dashboard`.
const CONTENT_VIEWS: readonly AdminDashboardView[] = ["stories", "users", "moderation"];

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
            <AdminNav view={view} />

            {view === "stories" ? <StoriesBoard /> : null}
            {view === "users" ? <UsersBoard /> : null}
            {view === "moderation" ? <ModerationBoard /> : null}

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
    case "stories":
      return "Stories · content across accounts";
    case "users":
      return "Users · accounts & admin";
    case "moderation":
      return "Moderation · the takedown queue";
    default:
      return "The keeper's desk";
  }
}

const NAV_ITEMS: ReadonlyArray<{ view: AdminDashboardView; label: string; href: string }> = [
  { view: "overview", label: "Overview", href: "/admin" },
  { view: "funnel", label: "Funnel", href: "/admin/funnel" },
  { view: "cost", label: "Cost", href: "/admin/cost" },
  { view: "safety", label: "Safety", href: "/admin/safety" },
  { view: "live", label: "Live", href: "/admin/live" },
  { view: "stories", label: "Stories", href: "/admin/stories" },
  { view: "users", label: "Users", href: "/admin/users" },
  { view: "moderation", label: "Moderation", href: "/admin/moderation" },
];

/**
 * Deep-link tab row across every admin surface. Each tab routes to the matching
 * `/admin/*` screen; the active view is highlighted. Kept here (not a separate
 * nav component) so the switch, the routes, and the tabs stay in lockstep.
 */
function AdminNav({ view }: { view: AdminDashboardView }) {
  const { tokens } = useAppTheme();
  const router = useRouter();
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: tokens.spacing.sm,
      }}
    >
      {NAV_ITEMS.map((item) => {
        const active = item.view === view;
        return (
          <Pressable
            key={item.view}
            accessibilityRole="link"
            accessibilityState={{ selected: active }}
            onPress={() => router.push(item.href as never)}
          >
            <Chip variant={active ? "accent" : "default"}>{item.label}</Chip>
          </Pressable>
        );
      })}
    </View>
  );
}

function formatWindow(from: number, to: number): string {
  const hours = Math.max(1, Math.round((to - from) / (60 * 60 * 1000)));
  return `${hours}h window`;
}
