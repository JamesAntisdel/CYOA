import { View } from "react-native";

import { useAppTheme } from "../../../theme";
import { Divider, Surface, Text } from "../../primitives";
import { RedactionGuard, redactValue } from "../RedactionGuard";
import type { AdminDashboardData, AdminSafetyMetric } from "../types";
import {
  BoardHeader,
  MetricTile,
  RuledRow,
  TileGrid,
  formatCount,
  formatPercent,
} from "./internals";

type SafetyBoardProps = {
  dashboard: AdminDashboardData;
};

/**
 * Safety category keys we know are allowlisted by `convex/analytics.ts`.
 * Anything outside this set is treated as `prose` by RedactionGuard so
 * an upstream regression cannot leak free-text into the operator surface.
 */
const ALLOWED_SAFETY_CATEGORIES = new Set([
  "self_harm",
  "sexual_content",
  "despair",
  "mature",
  "graphic_violence",
  "harassment",
  "minors",
  "unknown",
]);

const ALLOWED_SAFETY_ACTIONS = new Set([
  "blocked",
  "redirected",
  "ended",
  "ended_safely",
  "unknown",
]);

const EVENT_LABEL: Record<AdminSafetyMetric["eventName"], string> = {
  "safety.blocked": "blocked",
  "safety.redirected": "redirected",
  "safety.ended": "ended_safely",
};

/**
 * Canvas § 25 — safety board. The most sensitive surface: any category
 * or action key that wasn't pre-allowlisted by the analytics pipeline
 * is run through RedactionGuard with kind="prose" and replaced with a
 * neutral placeholder. Counts and rates always render — they carry no
 * prose risk.
 */
export function SafetyBoard({ dashboard }: SafetyBoardProps) {
  const totals = aggregateSafety(dashboard.safety);

  return (
    <Surface padded>
      <View style={{ gap: 16 }}>
        <BoardHeader
          kicker="safety · 24h"
          sub="No raw prose ever surfaces here. Despair spirals must remain zero."
          title="What the wards caught"
        />

        <TileGrid testID="admin-safety-tiles">
          <MetricTile
            label="Blocked"
            sub={formatPercent(totals.blockedRate)}
            value={formatCount(totals.blocked)}
          />
          <MetricTile
            label="Redirected"
            sub={formatPercent(totals.redirectedRate)}
            value={formatCount(totals.redirected)}
          />
          <MetricTile
            label="Ended safely"
            sub="reader chose to step away"
            value={formatCount(totals.ended)}
          />
          <MetricTile
            label="Despair spirals"
            sub="must remain zero"
            value={formatCount(totals.despair)}
          />
        </TileGrid>

        <View style={{ gap: 12 }}>
          {dashboard.safety.map((metric) => (
            <SafetyEventBlock key={metric.eventName} metric={metric} />
          ))}
        </View>
      </View>
    </Surface>
  );
}

function SafetyEventBlock({ metric }: { metric: AdminSafetyMetric }) {
  const { tokens } = useAppTheme();
  const isDanger = metric.eventName === "safety.blocked" && metric.count > 0;

  return (
    <View style={{ gap: tokens.spacing.xs }}>
      <View
        style={{
          alignItems: "center",
          flexDirection: "row",
          gap: tokens.spacing.md,
          justifyContent: "space-between",
        }}
      >
        {/* event name is one of three allowlisted strings — safe. */}
        <RedactionGuard kind="safe">
          <Text
            style={{
              fontFamily: tokens.typography.families.serif,
              fontStyle: "italic",
            }}
            variant="bodySmall"
          >
            {EVENT_LABEL[metric.eventName]}
          </Text>
        </RedactionGuard>
        <Text
          style={{
            color: isDanger ? tokens.colors.danger : tokens.colors.text,
            fontFamily: tokens.typography.families.mono,
          }}
          variant="bodySmall"
        >
          {formatCount(metric.count)} · {formatPercent(metric.rate)}
        </Text>
      </View>

      {/* Categories: anything outside the allowlist is treated as prose. */}
      {Object.entries(metric.categories).length === 0 ? null : (
        <View style={{ gap: 4 }}>
          {Object.entries(metric.categories).map(([key, count]) => (
            <RuledRow
              key={`cat:${key}`}
              label={
                <RedactionGuard
                  kind={ALLOWED_SAFETY_CATEGORIES.has(key) ? "safe" : "prose"}
                >
                  {/* Even when allowlisted, never render a value that an
                      attacker could push to the dashboard as free text. */}
                  {String(redactValue(
                    ALLOWED_SAFETY_CATEGORIES.has(key) ? "safe" : "prose",
                    `category · ${key}`,
                  ))}
                </RedactionGuard>
              }
              value={formatCount(count)}
            />
          ))}
        </View>
      )}

      {Object.entries(metric.actions).length === 0 ? null : (
        <View style={{ gap: 4 }}>
          {Object.entries(metric.actions).map(([key, count]) => (
            <RuledRow
              key={`act:${key}`}
              label={
                <RedactionGuard
                  kind={ALLOWED_SAFETY_ACTIONS.has(key) ? "safe" : "prose"}
                >
                  {String(redactValue(
                    ALLOWED_SAFETY_ACTIONS.has(key) ? "safe" : "prose",
                    `action · ${key}`,
                  ))}
                </RedactionGuard>
              }
              value={formatCount(count)}
            />
          ))}
        </View>
      )}
      <Divider />
    </View>
  );
}

type SafetyTotals = {
  blocked: number;
  blockedRate: number;
  redirected: number;
  redirectedRate: number;
  ended: number;
  endedRate: number;
  despair: number;
};

function aggregateSafety(rows: AdminSafetyMetric[]): SafetyTotals {
  const blocked = rows.find((row) => row.eventName === "safety.blocked");
  const redirected = rows.find((row) => row.eventName === "safety.redirected");
  const ended = rows.find((row) => row.eventName === "safety.ended");
  const despair = rows.reduce(
    (sum, row) => sum + (row.categories.despair ?? 0),
    0,
  );

  return {
    blocked: blocked?.count ?? 0,
    blockedRate: blocked?.rate ?? 0,
    redirected: redirected?.count ?? 0,
    redirectedRate: redirected?.rate ?? 0,
    ended: ended?.count ?? 0,
    endedRate: ended?.rate ?? 0,
    despair,
  };
}
