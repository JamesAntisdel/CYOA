import { useState } from "react";
import { Pressable, View } from "react-native";

import { useModerationQueue } from "../../../hooks/useModerationQueue";
import type { AdminReportRow, ReportStatus } from "../../../lib/moderationApi";
import { useAppTheme } from "../../../theme";
import { Button, Chip, Divider, Surface, Text } from "../../primitives";
import { BoardHeader, MetricTile, RuledRow, TileGrid, formatCount } from "./internals";
import { StateGate } from "./Stories";

const STATUS_TABS: ReadonlyArray<{ value: ReportStatus; label: string }> = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
];

const REASON_LABELS: Record<string, string> = {
  sexual_content: "Sexual content",
  hate_or_harassment: "Hate / harassment",
  self_harm: "Self-harm",
  violence_or_threats: "Violence / threats",
  illegal_or_csam: "Illegal / CSAM",
  spam_or_scam: "Spam / scam",
  other: "Other",
};

/**
 * Moderation board — the operator takedown queue (product-readiness launch
 * blocker: Apple 1.2 / Play UGC + GenAI). Lists reports by status; for an open
 * report the admin can dismiss it or resolve it, optionally hiding the reported
 * content (a tale takedown flips its `accessRevokedAt`). Admin-gated end to end:
 * the server refuses non-admins, so the board only renders rows when the caller
 * is proven admin.
 */
export function ModerationBoard() {
  const [status, setStatus] = useState<ReportStatus>("open");
  const { status: queueStatus, reports, reload, resolving, resolve } = useModerationQueue(status);

  return (
    <Surface padded>
      <View style={{ gap: 16 }}>
        <BoardHeader
          kicker="safety · moderation"
          sub="Reader reports across every published tale, community seed, and AI-generated scene."
          title="Takedown queue"
        />

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {STATUS_TABS.map((tab) => {
            const active = tab.value === status;
            return (
              <Pressable
                key={tab.value}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Show ${tab.label} reports`}
                onPress={() => setStatus(tab.value)}
              >
                <Chip variant={active ? "accent" : "default"}>{tab.label}</Chip>
              </Pressable>
            );
          })}
        </View>

        <StateGate status={queueStatus} onRetry={reload} emptyLabel="No reports in this bucket.">
          {reports.length > 0 ? (
            <View style={{ gap: 12 }}>
              <TileGrid testID="admin-moderation-tiles">
                <MetricTile label="Reports" sub={`marked ${status}`} value={formatCount(reports.length)} />
              </TileGrid>
              <View style={{ gap: 12 }}>
                {reports.map((report) => (
                  <ReportRow
                    key={report.reportId}
                    report={report}
                    busy={resolving === report.reportId}
                    onResolve={(hideContent) =>
                      void resolve({ reportId: report.reportId, status: "resolved", hideContent })
                    }
                    onDismiss={() =>
                      void resolve({ reportId: report.reportId, status: "dismissed" })
                    }
                  />
                ))}
              </View>
            </View>
          ) : null}
        </StateGate>
      </View>
    </Surface>
  );
}

function ReportRow({
  report,
  busy,
  onResolve,
  onDismiss,
}: {
  report: AdminReportRow;
  busy: boolean;
  onResolve: (hideContent: boolean) => void;
  onDismiss: () => void;
}) {
  const { tokens } = useAppTheme();
  const isOpen = report.status === "open";
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
        <Text style={{ fontWeight: "700" }} variant="bodySmall">
          {REASON_LABELS[report.reason] ?? report.reason}
        </Text>
        <View style={{ flexDirection: "row", gap: tokens.spacing.xs }}>
          <Chip variant="muted">{report.targetType}</Chip>
          {report.contentHidden ? <Chip variant="accent">hidden</Chip> : null}
        </View>
      </View>
      <RuledRow label="Target" value={report.targetId || "(unknown)"} />
      <RuledRow label="Reporter" value={report.reporterAccountId || "(unknown)"} />
      <RuledRow label="Filed" value={new Date(report.createdAt).toLocaleString()} />
      {report.details ? (
        <Text muted variant="caption">
          “{report.details}”
        </Text>
      ) : null}
      {report.resolutionNote ? (
        <Text muted variant="caption">
          Resolution: {report.resolutionNote}
        </Text>
      ) : null}
      {isOpen ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
          <Button
            accessibilityLabel={`Hide and resolve report ${report.reportId}`}
            disabled={busy}
            onPress={() => onResolve(true)}
            variant="primary"
          >
            {busy ? "Working…" : "Hide + resolve"}
          </Button>
          <Button
            accessibilityLabel={`Resolve report ${report.reportId} without hiding`}
            disabled={busy}
            onPress={() => onResolve(false)}
            variant="default"
          >
            Resolve
          </Button>
          <Button
            accessibilityLabel={`Dismiss report ${report.reportId}`}
            disabled={busy}
            onPress={onDismiss}
            variant="ghost"
          >
            Dismiss
          </Button>
        </View>
      ) : null}
      <Divider />
    </View>
  );
}
