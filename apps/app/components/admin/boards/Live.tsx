import { View } from "react-native";

import { useAppTheme } from "../../../theme";
import { Surface, Text } from "../../primitives";
import { RedactionGuard } from "../RedactionGuard";
import type { AdminDashboardData } from "../types";
import {
  BoardHeader,
  MetricTile,
  RuledRow,
  TileGrid,
  formatPercent,
} from "./internals";

type LiveBoardProps = {
  dashboard: AdminDashboardData;
};

/**
 * Canvas § 25 — live load board. Shows current activity and latency
 * derived from heartbeats, not from any per-account snapshots. Every
 * field is a count or millisecond reading; the only thing that could
 * leak would be a stray account/save id, so the per-stream detail row
 * is wrapped in RedactionGuard kind="pii" — it never renders ids, only
 * an aggregate placeholder.
 */
export function LiveBoard({ dashboard }: LiveBoardProps) {
  const { tokens } = useAppTheme();
  const live = dashboard.live;

  return (
    <Surface padded>
      <View style={{ gap: 16 }}>
        <BoardHeader
          kicker="live · last 5 min"
          sub="Heartbeats and latency only — no reader identifiers."
          title="The room's pulse"
        />

        <TileGrid testID="admin-live-tiles">
          <MetricTile
            label="Active reads"
            sub="last 5 minutes"
            value={String(live.activeReads)}
          />
          <MetricTile
            label="Co-op rooms"
            sub="open + populated"
            value={String(live.activeCoopRooms)}
          />
          <MetricTile
            label="Fallback"
            sub="provider failovers"
            value={formatPercent(live.fallbackRate)}
          />
          <MetricTile
            label="Errors"
            sub="of all events"
            value={formatPercent(live.errorRate)}
          />
        </TileGrid>

        <View style={{ gap: tokens.spacing.sm }}>
          <Text
            muted
            style={{
              fontFamily: tokens.typography.families.mono,
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
            variant="caption"
          >
            latency · first token
          </Text>
          <RuledRow label="p50" value={`${live.latency.firstTokenP50Ms} ms`} />
          <RuledRow
            emphasis={live.latency.firstTokenP95Ms > 1500 ? "danger" : "default"}
            label="p95"
            value={`${live.latency.firstTokenP95Ms} ms`}
          />
        </View>

        <View style={{ gap: tokens.spacing.sm }}>
          <Text
            muted
            style={{
              fontFamily: tokens.typography.families.mono,
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
            variant="caption"
          >
            latency · full turn
          </Text>
          <RuledRow label="p50" value={`${live.latency.totalP50Ms} ms`} />
          <RuledRow
            emphasis={live.latency.totalP95Ms > 5000 ? "danger" : "default"}
            label="p95"
            value={`${live.latency.totalP95Ms} ms`}
          />
        </View>

        {/* The dashboard data slice never contains per-reader rows for
            live, but if a future expansion accidentally added them we
            want a hard placeholder. This block is the structural guard. */}
        <RedactionGuard kind="pii">
          {/* Intentionally unreachable — RedactionGuard always drops
              children for kind="pii" and renders its neutral placeholder. */}
          <Text variant="caption">unused</Text>
        </RedactionGuard>
      </View>
    </Surface>
  );
}
