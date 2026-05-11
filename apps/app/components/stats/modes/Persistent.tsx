import { View } from "react-native";

import { Button, Chip, Surface, Text } from "../../primitives";
import { useAppTheme } from "../../../theme";
import { filterVisibleStats, type StatsHudCommonProps } from "../types";

/**
 * Mode 1 · Persistent — always-visible top strip. Most "gamey".
 *
 * Lifted from CYOA Wireframes (Stats_Persistent):
 *   "top strip, never hides. game-iest."
 *   Layout: [character name]  [♥ value]  [◈ value]  [✦ value]
 */
export function PersistentMode({
  characterName = "Reader",
  hiddenStatIds,
  inventory,
  onOpenFullSheet,
  stats,
  turnNumber,
}: StatsHudCommonProps) {
  const { tokens } = useAppTheme();
  const visible = filterVisibleStats(stats, hiddenStatIds);

  return (
    <Surface
      accessibilityLabel="Persistent stats HUD"
      padded
      style={{ gap: tokens.spacing.sm }}
    >
      <View
        style={{
          alignItems: "center",
          flexDirection: "row",
          flexWrap: "wrap",
          gap: tokens.spacing.md,
          justifyContent: "space-between",
        }}
      >
        <View style={{ gap: tokens.spacing.xs }}>
          <Text variant="subtitle">{characterName}</Text>
          {typeof turnNumber === "number" ? (
            <Text muted variant="caption">
              Turn {turnNumber}
            </Text>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
          {visible.map((stat) => (
            <Chip key={stat.key} accessibilityLabel={`${stat.label} ${stat.value}`}>
              {`${stat.glyph} ${stat.value}`}
            </Chip>
          ))}
        </View>
      </View>
      <View
        accessibilityLabel="Inventory summary"
        style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.xs }}
      >
        {inventory.length > 0 ? (
          inventory.map((item) => (
            <Chip key={item.id}>{`✦ ${item.label}`}</Chip>
          ))
        ) : (
          <Text muted variant="caption">
            Empty pack
          </Text>
        )}
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
    </Surface>
  );
}
