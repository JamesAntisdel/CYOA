import { View } from "react-native";

import { Chip, Text } from "../primitives";
import { useAppTheme } from "../../theme";
import type { ReaderInventoryItem, ReaderStats } from "../../hooks/useTurn";

type StatsHudProps = {
  inventory: ReaderInventoryItem[];
  mode?: "full" | "quiet";
  stats: ReaderStats;
};

const statLabels: Array<[keyof ReaderStats, string]> = [
  ["vitality", "Vitality"],
  ["nerve", "Nerve"],
  ["insight", "Insight"],
];

export function StatsHud({ inventory, mode = "full", stats }: StatsHudProps) {
  const { tokens } = useAppTheme();
  const inventoryLabel = inventory.length === 1 ? "1 item" : `${inventory.length} items`;

  return (
    <View style={{ gap: tokens.spacing.md }}>
      <View
        accessibilityLabel="Current stats"
        style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}
      >
        {statLabels.map(([key, label]) => (
          <Chip key={key}>
            {label}: {"●".repeat(stats[key])}
            {"○".repeat(Math.max(0, 5 - stats[key]))}
          </Chip>
        ))}
        {mode === "quiet" ? <Chip>Inventory: {inventoryLabel}</Chip> : null}
      </View>
      {mode === "full" ? (
        <View style={{ gap: tokens.spacing.xs }}>
          <Text muted variant="caption">
            Inventory
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
            {inventory.length > 0 ? (
              inventory.map((item) => <Chip key={item.id}>{item.label}</Chip>)
            ) : (
              <Text muted variant="bodySmall">
                Empty
              </Text>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}
