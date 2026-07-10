import { View } from "react-native";

import { useAppTheme } from "../../../theme";
import { Divider, Surface, Text } from "../../primitives";
import { RedactionGuard } from "../RedactionGuard";
import type { AdminCostMetric, AdminDashboardData } from "../types";
import {
  BoardHeader,
  MetricTile,
  RuledRow,
  TileGrid,
  formatCents,
  formatCount,
} from "./internals";

type CostBoardProps = {
  dashboard: AdminDashboardData;
};

/**
 * Canvas § 25 — cost board. One row per (provider · story) pair, with
 * provider names treated as allowlisted (anthropic, vertex, deepseek)
 * and storyIds treated as content slugs (also allowlisted by the
 * publish pipeline). Per-turn cost is the headline metric.
 */
export function CostBoard({ dashboard }: CostBoardProps) {
  const totalCents = dashboard.cost.reduce(
    (sum, row) => sum + row.estimatedCostCents,
    0,
  );
  const totalTurns = dashboard.cost.reduce((sum, row) => sum + row.turns, 0);
  const p50 = totalTurns > 0 ? totalCents / totalTurns : 0;

  return (
    <Surface padded>
      <View style={{ gap: 16 }}>
        <BoardHeader
          kicker="cost · provider · story"
          sub="Aggregated by provider and story id only — no per-account costs."
          title="What every turn costs"
        />

        <TileGrid testID="admin-cost-tiles">
          <MetricTile
            label="$ / turn · p50"
            sub="across all providers"
            value={formatCents(p50)}
          />
          <MetricTile
            label="Total · window"
            sub={`${formatCount(totalTurns)} turns`}
            value={formatCents(totalCents)}
          />
          <MetricTile
            label="Providers"
            sub="active this window"
            value={String(new Set(dashboard.cost.map((row) => row.provider)).size)}
          />
          <MetricTile
            label="Stories"
            sub="contributing cost"
            value={String(new Set(dashboard.cost.map((row) => row.storyId)).size)}
          />
        </TileGrid>

        <View style={{ gap: 12 }}>
          {dashboard.cost.length === 0 ? (
            <Text muted variant="bodySmall">
              No cost recorded in window.
            </Text>
          ) : (
            dashboard.cost.map((row) => <CostRow key={`${row.provider}:${row.storyId}`} row={row} />)
          )}
        </View>
      </View>
    </Surface>
  );
}

function CostRow({ row }: { row: AdminCostMetric }) {
  const { tokens } = useAppTheme();
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
        {/* provider/storyId are allowlisted analytics keys, not PII. */}
        <RedactionGuard kind="safe">
          <Text
            style={{
              fontFamily: tokens.typography.families.serif,
              fontStyle: "italic",
            }}
            variant="bodySmall"
          >
            {row.provider} · {row.storyId}
          </Text>
        </RedactionGuard>
        <Text
          style={{ fontFamily: tokens.typography.families.mono }}
          variant="bodySmall"
        >
          {formatCents(row.estimatedCostCents)}
        </Text>
      </View>
      <RuledRow
        label={`${formatCount(row.turns)} turns`}
        value={`${formatCents(row.costPerTurnCents)} / turn`}
      />
      <RuledRow
        label={`${formatCount(row.textTokens)} tokens`}
        value={`${formatCount(row.imageGenerations)} img · ${formatCount(row.videoGenerations)} vid`}
      />
      <Divider />
    </View>
  );
}
