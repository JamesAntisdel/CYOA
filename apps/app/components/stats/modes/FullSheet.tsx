import { Modal, ScrollView, View } from "react-native";

import { npcTrendsFromDiffs } from "../../../lib/storyEngagement";
import { useBreakpoint } from "../../../lib/responsive";
import { Button, Chip, Divider, Surface, Text } from "../../primitives";
import { useAppTheme } from "../../../theme";
import { Codex } from "../../reading/Codex";
import { NpcRoster } from "../NpcRoster";
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
  accountId,
  characterName = "Reader",
  codex,
  hiddenStatIds,
  inventory,
  npcs,
  onCloseFullSheet,
  recentDiffs,
  saveId,
  stats,
  turnNumber,
  visible,
}: FullSheetProps) {
  const { tokens } = useAppTheme();
  const { isPhone } = useBreakpoint();
  const visibleStats = filterVisibleStats(stats, hiddenStatIds);
  const hasNpcs = npcs ? Object.keys(npcs).length > 0 : false;
  // W2-C3: disposition trend arrows for cast members who moved this turn.
  const npcTrends = npcTrendsFromDiffs(recentDiffs);
  const hasCodex = codex ? codex.length > 0 : false;

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
          // On phone viewports the sheet stretches to fill the screen
          // (top-aligned so the title row doesn't disappear under a tall
          // keyboard / status bar). On tablet+ it stays vertically
          // centered with the previous max-width contract.
          justifyContent: isPhone ? "flex-start" : "center",
          padding: isPhone ? tokens.spacing.sm : tokens.spacing.lg,
        }}
      >
        <Surface
          accessibilityLabel="Character sheet"
          padded
          style={{
            alignSelf: "center",
            gap: tokens.spacing.md,
            // Phone: occupy the full available width (the parent padding
            // already provides 8px gutters). Desktop/tablet: cap at 520
            // so the sheet doesn't sprawl across wide windows.
            maxWidth: isPhone ? "100%" : 520,
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
            // On phones we want the roster to scroll within the full
            // screen rather than a fixed 360px viewport — the cast can
            // get long (4–6 NPCs), and a tight inner ScrollView nested
            // inside a phone-height Modal traps the reader inside a
            // ~360px window that doesn't visibly indicate scrollability.
            style={{ maxHeight: isPhone ? undefined : 360 }}
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
            {hasNpcs ? (
              <View style={{ gap: tokens.spacing.xs }}>
                <Text variant="subtitle">Companions and Cast</Text>
                <NpcRoster
                  npcs={npcs}
                  {...(accountId ? { accountId } : {})}
                  {...(saveId ? { saveId } : {})}
                  {...(Object.keys(npcTrends).length > 0 ? { trends: npcTrends } : {})}
                />
              </View>
            ) : null}
            {hasCodex ? (
              <Codex codex={codex} {...(turnNumber !== undefined ? { currentTurn: turnNumber } : {})} />
            ) : null}
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
