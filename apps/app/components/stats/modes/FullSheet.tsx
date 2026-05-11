import { Modal, ScrollView, View } from "react-native";

import { Button, Chip, Divider, Surface, Text } from "../../primitives";
import { useAppTheme } from "../../../theme";
import { filterVisibleStats, type StatsHudCommonProps } from "../types";

type FullSheetProps = StatsHudCommonProps & {
  visible: boolean;
};

/**
 * Mode 4 · The Character Sheet — RPG-style full overlay.
 *
 * Lifted from CYOA Wireframes (Stats_FullSheet):
 *   "full pause overlay — RPG menu."
 *   "opens on demand from any reading view. lives behind ≡."
 *
 * Hidden-stat policy: the lo-fi canvas drafted an inline "(hidden)" entry
 * for hidden stats. Our implementation omits hidden stats entirely —
 * revealing them would defeat the engine's `AttributeVisibility = "hidden"`
 * flag, which marks stats whose presence is privileged.
 */
export function FullSheetMode({
  characterName = "Reader",
  hiddenStatIds,
  inventory,
  onCloseFullSheet,
  stats,
  turnNumber,
  visible,
}: FullSheetProps) {
  const { tokens } = useAppTheme();
  const visibleStats = filterVisibleStats(stats, hiddenStatIds);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onCloseFullSheet}
      transparent
      visible={visible}
    >
      <View
        accessibilityViewIsModal
        style={{
          backgroundColor: tokens.colors.overlay,
          flex: 1,
          justifyContent: "center",
          padding: tokens.spacing.lg,
        }}
      >
        <Surface
          accessibilityLabel="Character sheet"
          padded
          style={{
            alignSelf: "center",
            gap: tokens.spacing.md,
            maxWidth: 520,
            width: "100%",
          }}
        >
          <View style={{ gap: tokens.spacing.xs }}>
            <Text variant="title">{characterName}</Text>
            {typeof turnNumber === "number" ? (
              <Text muted variant="caption">
                {`The Reader · turn ${turnNumber}`}
              </Text>
            ) : null}
          </View>
          <Divider />
          <ScrollView
            contentContainerStyle={{ gap: tokens.spacing.md }}
            style={{ maxHeight: 360 }}
          >
            <View style={{ gap: tokens.spacing.xs }}>
              <Text variant="subtitle">Attributes</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                {visibleStats.map((stat) => (
                  <Chip key={stat.key}>
                    {`${stat.glyph} ${stat.label} ${stat.value}`}
                  </Chip>
                ))}
              </View>
            </View>
            <View style={{ gap: tokens.spacing.xs }}>
              <Text variant="subtitle">Inventory</Text>
              <View style={{ flexDirection: "column", gap: tokens.spacing.xs }}>
                {inventory.length > 0 ? (
                  inventory.map((item) => (
                    <Text key={item.id} variant="bodySmall">
                      {`· ${item.label}`}
                    </Text>
                  ))
                ) : (
                  <Text muted variant="bodySmall">
                    No items carried.
                  </Text>
                )}
              </View>
            </View>
          </ScrollView>
          {onCloseFullSheet ? (
            <Button accessibilityLabel="Close character sheet" onPress={onCloseFullSheet}>
              Close
            </Button>
          ) : null}
        </Surface>
      </View>
    </Modal>
  );
}
