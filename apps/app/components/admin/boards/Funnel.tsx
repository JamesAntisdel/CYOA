import { View } from "react-native";

import { useAppTheme } from "../../../theme";
import { Surface, Text } from "../../primitives";
import { RedactionGuard } from "../RedactionGuard";
import type { AdminDashboardData, AdminFunnelMetric } from "../types";
import {
  BoardHeader,
  MetricTile,
  TileGrid,
  formatCount,
  formatPercent,
} from "./internals";

type FunnelBoardProps = {
  dashboard: AdminDashboardData;
};

/**
 * Canvas § 25 — funnel board. Renders the land → subscribe ladder
 * with one row per step: italic label, ruled bar, mono count/pct.
 * Funnel step labels are operator-curated (no prose, no PII), so the
 * RedactionGuard wraps them with kind="safe" — this is intentional and
 * documents that the surface is allowlist-only.
 */
export function FunnelBoard({ dashboard }: FunnelBoardProps) {
  const { tokens } = useAppTheme();
  const total = dashboard.funnel[0]?.count ?? 0;
  const landing = dashboard.funnel.find((step) => step.eventName === "age_gate.shown");
  const subscribed = dashboard.funnel.find(
    (step) => step.eventName === "billing.subscription_started",
  );
  const overall =
    landing && landing.count > 0 && subscribed
      ? subscribed.count / landing.count
      : 0;

  return (
    <Surface padded>
      <View style={{ gap: tokens.spacing.lg }}>
        <BoardHeader
          kicker="funnel · land → subscribe"
          sub="No personal data, no prose — only counted steps."
          title="The reader's ladder"
        />

        <TileGrid testID="admin-funnel-tiles">
          <MetricTile
            label="Landings · window"
            sub={`${dashboard.funnel.length} tracked steps`}
            value={formatCount(landing?.count ?? 0)}
          />
          <MetricTile
            label="Subscribed"
            sub={formatPercent(overall) + " end-to-end"}
            value={formatCount(subscribed?.count ?? 0)}
          />
          <MetricTile
            label="Activated"
            sub="age-gated readers continuing"
            value={formatCount(
              dashboard.funnel.find((step) => step.eventName === "activation.completed")?.count ??
                0,
            )}
          />
          <MetricTile
            label="Tutorial"
            sub="completed first arc"
            value={formatCount(
              dashboard.funnel.find((step) => step.eventName === "tutorial.completed")?.count ?? 0,
            )}
          />
        </TileGrid>

        <View style={{ gap: tokens.spacing.sm }}>
          {dashboard.funnel.map((step) => (
            <FunnelRow key={step.eventName} step={step} total={total} />
          ))}
        </View>
      </View>
    </Surface>
  );
}

type FunnelRowProps = {
  step: AdminFunnelMetric;
  total: number;
};

function FunnelRow({ step, total }: FunnelRowProps) {
  const { tokens } = useAppTheme();
  const ratio = total > 0 ? Math.max(0, Math.min(1, step.count / total)) : 0;

  return (
    <View
      accessibilityLabel={`${step.label}: ${step.count} (${formatPercent(step.conversionRate)})`}
      style={{ gap: tokens.spacing.xs }}
    >
      <View
        style={{
          alignItems: "center",
          flexDirection: "row",
          gap: tokens.spacing.md,
        }}
      >
        {/* Funnel labels are an allowlisted set defined in convex/analytics.ts. */}
        <View style={{ flex: 1 }}>
          <RedactionGuard kind="safe">
            <Text
              style={{
                fontFamily: tokens.typography.families.serif,
                fontStyle: "italic",
              }}
              variant="bodySmall"
            >
              {step.label}
            </Text>
          </RedactionGuard>
        </View>
        <Text
          muted
          style={{ fontFamily: tokens.typography.families.mono }}
          variant="caption"
        >
          {formatCount(step.count)} · {formatPercent(step.conversionRate)}
        </Text>
      </View>
      <View
        style={{
          backgroundColor: tokens.colors.overlay,
          borderRadius: tokens.radii.xs,
          height: 8,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            backgroundColor: tokens.colors.accent,
            height: "100%",
            width: `${ratio * 100}%`,
          }}
        />
      </View>
    </View>
  );
}
