import { useState } from "react";
import { Pressable, View } from "react-native";

import { KeepsakeBadge } from "../../creator/KeepsakePicker";
import { Button, Chip, Divider, Surface, Text } from "../../primitives";
import { isKeepsakeItem } from "../../../lib/storyEngagementW3";
import { useAppTheme } from "../../../theme";
import { filterVisibleStats, type StatsHudCommonProps } from "../types";

/**
 * Mode 2 · Peek Drawer — default. Tap corner sigil; drawer slides open.
 *
 * Lifted from CYOA Wireframes (Stats_PeekDrawer):
 *   "tap a corner sigil; drawer slides in."
 *   "best balance — preserves 'book' feel, full info on demand."
 *
 * We render the sigil chip + a collapsible drawer in-flow rather than as a
 * floating layer so we do not collide with the reading agent's prose
 * coordinates. The visual contract — sigil summary always visible, full
 * stats + inventory available on tap — matches the canvas.
 */
export function PeekDrawerMode({
  characterName,
  hiddenStatIds,
  inventory,
  onOpenFullSheet,
  stats,
}: StatsHudCommonProps) {
  const { tokens } = useAppTheme();
  const [open, setOpen] = useState(false);
  const visible = filterVisibleStats(stats, hiddenStatIds);
  const summary = visible
    .map((stat) => `${stat.glyph}${stat.value}`)
    .join(" ");

  return (
    <Surface
      accessibilityLabel="Peek drawer stats HUD"
      padded
      style={{ gap: tokens.spacing.sm }}
    >
      <View
        style={{
          alignItems: "center",
          flexDirection: "row",
          justifyContent: "space-between",
          gap: tokens.spacing.sm,
        }}
      >
        <Text variant="caption" muted>
          {characterName ?? "Stats"}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? "Close stats drawer" : "Open stats drawer"}
          onPress={() => setOpen((prev) => !prev)}
          style={{
            borderColor: tokens.colors.border,
            borderRadius: tokens.radii.xs,
            borderWidth: tokens.borderWidths.regular,
            paddingHorizontal: tokens.spacing.sm,
            paddingVertical: tokens.spacing.xs,
          }}
        >
          <Text variant="caption">{summary || "—"}</Text>
        </Pressable>
      </View>
      {open ? (
        <View style={{ gap: tokens.spacing.sm }}>
          <Divider />
          <View
            accessibilityLabel="Current stats"
            style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}
          >
            {visible.map((stat) => (
              <Chip key={stat.key}>{`${stat.glyph} ${stat.label} ${stat.value}`}</Chip>
            ))}
          </View>
          <View style={{ gap: tokens.spacing.xs }}>
            <Text muted variant="caption">
              Inventory
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
              {inventory.length > 0 ? (
                inventory.map((item) => (
                  <Chip key={item.id} variant={isKeepsakeItem(item) ? "accent" : "default"}>
                    {`✦ ${item.label}`}
                    {isKeepsakeItem(item) ? <KeepsakeBadge /> : null}
                  </Chip>
                ))
              ) : (
                <Text muted variant="bodySmall">
                  Empty
                </Text>
              )}
            </View>
          </View>
          {onOpenFullSheet ? (
            <Button
              accessibilityLabel="Open character sheet"
              onPress={onOpenFullSheet}
              variant="ghost"
            >
              Open character sheet
            </Button>
          ) : null}
        </View>
      ) : null}
    </Surface>
  );
}
