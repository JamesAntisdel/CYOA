import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "../../theme";
import { Chip, Divider, Stamp, Surface, Text } from "../primitives";
import { AdminMetricBar } from "./AdminMetricBar";
import { AdminGate } from "./AdminGate";
import type { AdminAccount, AdminDashboardData } from "./types";

type AdminDashboardScreenProps = {
  account: AdminAccount | null;
  dashboard: AdminDashboardData;
  view?: "overview" | "funnel" | "cost" | "safety" | "live";
};

export function AdminDashboardScreen({
  account,
  dashboard,
  view = "overview",
}: AdminDashboardScreenProps) {
  const { tokens } = useAppTheme();
  const maxFunnelCount = Math.max(1, ...dashboard.funnel.map((metric) => metric.count));

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: tokens.spacing.lg }}>
        <View style={{ alignSelf: "center", gap: tokens.spacing.lg, maxWidth: 980, width: "100%" }}>
          <AdminGate account={account}>
            <View style={{ gap: tokens.spacing.sm }}>
              <Stamp>operator</Stamp>
              <Text variant="title">{titleForView(view)}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                <Chip>{formatWindow(dashboard.window.from, dashboard.window.to)}</Chip>
                <Chip>{new Date(dashboard.generatedAt).toLocaleTimeString()}</Chip>
                <Chip>in-house analytics</Chip>
              </View>
            </View>

            {view === "overview" || view === "live" ? <LivePanel dashboard={dashboard} /> : null}
            {view === "overview" || view === "funnel" ? (
              <FunnelPanel dashboard={dashboard} maxFunnelCount={maxFunnelCount} />
            ) : null}
            {view === "overview" || view === "cost" ? <CostPanel dashboard={dashboard} /> : null}
            {view === "overview" || view === "safety" ? <SafetyPanel dashboard={dashboard} /> : null}
          </AdminGate>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function LivePanel({ dashboard }: { dashboard: AdminDashboardData }) {
  const { tokens } = useAppTheme();
  const live = dashboard.live;

  return (
    <Surface padded>
      <View style={{ gap: tokens.spacing.md }}>
        <Text variant="subtitle">Live</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
          <Chip>{live.activeReads} active reads</Chip>
          <Chip>{live.activeCoopRooms} co-op rooms</Chip>
          <Chip>{formatPercent(live.fallbackRate)} fallback</Chip>
          <Chip>{formatPercent(live.errorRate)} errors</Chip>
        </View>
        <Divider />
        <AdminMetricBar label="First token p95" progress={live.latency.firstTokenP95Ms / 2000} value={`${live.latency.firstTokenP95Ms}ms`} />
        <AdminMetricBar label="Total turn p95" progress={live.latency.totalP95Ms / 5000} value={`${live.latency.totalP95Ms}ms`} />
      </View>
    </Surface>
  );
}

function FunnelPanel({
  dashboard,
  maxFunnelCount,
}: {
  dashboard: AdminDashboardData;
  maxFunnelCount: number;
}) {
  const { tokens } = useAppTheme();

  return (
    <Surface padded>
      <View style={{ gap: tokens.spacing.md }}>
        <Text variant="subtitle">Funnel</Text>
        {dashboard.funnel.map((metric) => (
          <AdminMetricBar
            key={metric.eventName}
            label={metric.label}
            progress={metric.count / maxFunnelCount}
            value={`${metric.count} - ${formatPercent(metric.conversionRate)}`}
          />
        ))}
      </View>
    </Surface>
  );
}

function CostPanel({ dashboard }: { dashboard: AdminDashboardData }) {
  const { tokens } = useAppTheme();
  const maxCost = Math.max(1, ...dashboard.cost.map((metric) => metric.estimatedCostCents));

  return (
    <Surface padded>
      <View style={{ gap: tokens.spacing.md }}>
        <Text variant="subtitle">Cost</Text>
        {dashboard.cost.map((metric) => (
          <View key={`${metric.provider}:${metric.storyId}`} style={{ gap: tokens.spacing.xs }}>
            <AdminMetricBar
              label={`${metric.provider} / ${metric.storyId}`}
              progress={metric.estimatedCostCents / maxCost}
              value={`${formatCents(metric.estimatedCostCents)} total`}
            />
            <Text muted variant="caption">
              {metric.textTokens} tokens, {metric.imageGenerations} images, {metric.videoGenerations} videos,
              {" "}{formatCents(metric.costPerTurnCents)} per turn
            </Text>
          </View>
        ))}
      </View>
    </Surface>
  );
}

function SafetyPanel({ dashboard }: { dashboard: AdminDashboardData }) {
  const { tokens } = useAppTheme();
  const maxSafetyCount = Math.max(1, ...dashboard.safety.map((metric) => metric.count));

  return (
    <Surface padded>
      <View style={{ gap: tokens.spacing.md }}>
        <Text variant="subtitle">Safety</Text>
        {dashboard.safety.map((metric) => (
          <View key={metric.eventName} style={{ gap: tokens.spacing.xs }}>
            <AdminMetricBar
              danger={metric.count > 0}
              label={metric.eventName}
              progress={metric.count / maxSafetyCount}
              value={`${metric.count} - ${formatPercent(metric.rate)}`}
            />
            <Text muted variant="caption">{formatBreakdown(metric.categories)}</Text>
          </View>
        ))}
      </View>
    </Surface>
  );
}

function titleForView(view: AdminDashboardScreenProps["view"]): string {
  switch (view) {
    case "funnel":
      return "Funnel Dashboard";
    case "cost":
      return "Cost Dashboard";
    case "safety":
      return "Safety Dashboard";
    case "live":
      return "Live Dashboard";
    default:
      return "Admin Dashboard";
  }
}

function formatWindow(from: number, to: number): string {
  const hours = Math.max(1, Math.round((to - from) / (60 * 60 * 1000)));
  return `${hours}h window`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatCents(value: number): string {
  return `$${(value / 100).toFixed(2)}`;
}

function formatBreakdown(values: Record<string, number>): string {
  const entries = Object.entries(values);
  if (entries.length === 0) return "No redacted events";
  return entries.map(([key, value]) => `${key}: ${value}`).join(", ");
}
