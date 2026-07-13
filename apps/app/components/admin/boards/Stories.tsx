import { useState } from "react";
import { Pressable, View } from "react-native";

import { useAppTheme } from "../../../theme";
import { Button, Divider, Surface, Text } from "../../primitives";
import {
  useAdminSaveDetail,
  useAdminSaves,
  useAdminStories,
  type AdminContentStatus,
} from "../../../hooks/useAdminContent";
import type { AdminSaveListItem } from "../../../lib/adminApi";
import { BoardHeader, MetricTile, RuledRow, TileGrid, formatCount } from "./internals";

/**
 * Stories board (product.md operator intent, Req 27). Two stacked panels:
 *   1. content overview — stories aggregated from recent saves (status mix +
 *      last activity), from `adminContent:listStories`.
 *   2. recent saves — cursor-paged across ALL accounts, each drilling into the
 *      per-save detail (`adminContent:getSaveDetail`): scene count, bible
 *      status (non-spoiler), endings reached.
 * Read-only. Owner ids are opaque analytics keys (no prose, no PII beyond the
 * account id the operator already administers).
 */
export function StoriesBoard() {
  return (
    <View style={{ gap: 16 }}>
      <StoriesOverviewPanel />
      <RecentSavesPanel />
    </View>
  );
}

function StoriesOverviewPanel() {
  const { status, stories, reload } = useAdminStories();
  const activeStories = stories.length;
  const totalSaves = stories.reduce((sum, s) => sum + s.saves, 0);

  return (
    <Surface padded>
      <View style={{ gap: 16 }}>
        <BoardHeader
          kicker="content · stories"
          sub="Aggregated from the most recent saves across all accounts."
          title="Stories in play"
        />
        <StateGate status={status} onRetry={reload} emptyLabel="No saves recorded yet.">
          {stories.length > 0 ? (
            <View style={{ gap: 12 }}>
              <TileGrid testID="admin-stories-tiles">
                <MetricTile label="Stories" sub="with recent saves" value={String(activeStories)} />
                <MetricTile label="Saves" sub="in the window" value={formatCount(totalSaves)} />
              </TileGrid>
              <View style={{ gap: 12 }}>
                {stories.map((story) => (
                  <View key={story.storyId || "(untitled)"} style={{ gap: 4 }}>
                    <Text
                      style={{ fontStyle: "italic" }}
                      variant="bodySmall"
                    >
                      {story.storyId || "(untitled)"}
                    </Text>
                    <RuledRow
                      label={`${formatCount(story.saves)} saves`}
                      value={`${story.active} active · ${story.ended} ended · ${story.dead} dead`}
                    />
                    <Divider />
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </StateGate>
      </View>
    </Surface>
  );
}

function RecentSavesPanel() {
  const { status, items, isDone, loadingMore, loadMore, reload } = useAdminSaves();
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <Surface padded>
      <View style={{ gap: 16 }}>
        <BoardHeader
          kicker="content · saves"
          sub="Newest first, across every account. Tap a save to inspect it."
          title="Recent saves"
        />
        <StateGate status={status} onRetry={reload} emptyLabel="No saves to browse.">
          <View style={{ gap: 8 }}>
            {items.map((save) => (
              <SaveRow
                key={save.saveId}
                save={save}
                selected={selected === save.saveId}
                onToggle={() =>
                  setSelected((current) => (current === save.saveId ? null : save.saveId))
                }
              />
            ))}
            {!isDone ? (
              <Button
                disabled={loadingMore}
                onPress={loadMore}
                testID="admin-saves-more"
                variant="ghost"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            ) : null}
          </View>
        </StateGate>
      </View>
    </Surface>
  );
}

function SaveRow({
  save,
  selected,
  onToggle,
}: {
  save: AdminSaveListItem;
  selected: boolean;
  onToggle: () => void;
}) {
  const { tokens } = useAppTheme();
  return (
    <View style={{ gap: tokens.spacing.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Save ${save.saveId} in ${save.storyId || "untitled"}`}
        onPress={onToggle}
      >
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            gap: tokens.spacing.md,
            justifyContent: "space-between",
          }}
        >
          <Text style={{ fontStyle: "italic" }} variant="bodySmall">
            {save.storyId || "(untitled)"}
          </Text>
          <Text style={{ fontFamily: tokens.typography.families.mono }} variant="bodySmall">
            t{save.turnNumber} · {save.status}
          </Text>
        </View>
      </Pressable>
      <RuledRow
        label={`${save.ownerKind} · ${save.ownerAccountId}`}
        value={new Date(save.createdAt).toLocaleDateString()}
      />
      {selected ? <SaveDetailPanel saveId={save.saveId} /> : null}
      <Divider />
    </View>
  );
}

function SaveDetailPanel({ saveId }: { saveId: string }) {
  const { detail, status } = useAdminSaveDetail(saveId);

  if (status === "loading") {
    return <Text muted variant="caption">Loading save…</Text>;
  }
  if (status !== "ready" || !detail) {
    return <Text muted variant="caption">Save detail unavailable.</Text>;
  }

  return (
    <Surface padded variant="muted">
      <View style={{ gap: 8 }}>
        <RuledRow label="Scenes" value={formatCount(detail.sceneCount)} />
        <RuledRow
          label="Story bible"
          value={detail.bible ? detail.bible.status : "none"}
        />
        <RuledRow label="Endings reached" value={String(detail.endings.length)} />
        {detail.endings.length > 0
          ? detail.endings.map((ending) => (
              <RuledRow
                key={ending.endingId}
                label={ending.label ?? ending.endingId}
                value={ending.safetyEnding ? "safety" : "earned"}
              />
            ))
          : null}
      </View>
    </Surface>
  );
}

/**
 * Shared loading / unavailable / empty gate for every content panel. Renders
 * children only when authorized-and-nonempty; otherwise the matching state.
 */
export function StateGate({
  status,
  onRetry,
  emptyLabel,
  children,
}: {
  status: AdminContentStatus;
  onRetry: () => void;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  if (status === "loading") {
    return <Text muted variant="bodySmall">Loading…</Text>;
  }
  if (status === "unavailable") {
    return (
      <View style={{ gap: 8 }}>
        <Text muted variant="bodySmall">
          Couldn’t load — the backend is unreachable or your session isn’t an admin.
        </Text>
        <Button onPress={onRetry} variant="ghost">
          Retry
        </Button>
      </View>
    );
  }
  // ready — child decides whether it has rows; if not, show the empty label.
  const hasChildren = Array.isArray(children)
    ? children.some(Boolean)
    : Boolean(children);
  if (!hasChildren) {
    return <Text muted variant="bodySmall">{emptyLabel}</Text>;
  }
  return <>{children}</>;
}
