import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import type { NpcState } from "@cyoa/engine";

import type { ReaderInventoryItem, ReaderStats } from "../../hooks/useTurn";
import { useReaderSettings } from "../../hooks/useReaderSettings";
import { useAppTheme } from "../../theme";
import { StatPip } from "./StatPip";
import { ContextualMode } from "./modes/Contextual";
import { FullSheetMode } from "./modes/FullSheet";
import { PeekDrawerMode } from "./modes/PeekDrawer";
import { PersistentMode } from "./modes/Persistent";
import {
  diffVisibleStats,
  shouldBubbleReceiptsAtDispatcher,
  statsHudModeFromSetting,
  type StatsDelta,
  type StatsHudMode,
} from "./types";
import { usePreviousStats } from "./usePreviousStats";

type StatsHudProps = {
  inventory: ReaderInventoryItem[];
  stats: ReaderStats;
  /** Stat ids the engine has flagged hidden. Never rendered in any mode. */
  hiddenStatIds?: ReadonlyArray<string>;
  /** Override the mode (otherwise read from `useReaderSettings`). */
  mode?: StatsHudMode;
  /** Optional character header for Persistent/FullSheet modes. */
  characterName?: string;
  /** Turn number for header context. */
  turnNumber?: number;
  /**
   * Cast roster for the FullSheet's "Companions and Cast" section. Forwarded
   * to whichever mode surfaces the character sheet; the persistent/peek/
   * contextual modes ignore it.
   */
  npcs?: Record<string, NpcState>;
  /**
   * Account + save identity, forwarded to `<FullSheetMode>` so the cast
   * roster can resolve live portrait URLs via the convex query
   * `media/npcMedia:getNpcPortraitUrl`. Both required for live lookup;
   * omitting either silently falls back to the initials placeholder.
   */
  accountId?: string;
  saveId?: string;
};

/**
 * Stats HUD dispatcher — selects one of the four canvas modes:
 *  1 · Persistent  2 · Peek Drawer (default)  3 · Contextual  4 · Full Sheet
 *
 * Pip motion: in every mode except Contextual (which renders its own pips
 * inline as the surface), changes also bubble a transient pip into a
 * separate "receipt" container next to the HUD. The reading agent owns the
 * prose-anchor coordinates; if it provides an anchor, the StatPip will be
 * rendered into that slot via a sibling render-prop callback. To avoid
 * touching components/reading we expose the receipt feed but render the
 * default placement inline above the HUD body, where the reading screen
 * already places the HUD beneath the prose surface.
 */
export function StatsHud({
  accountId,
  characterName,
  hiddenStatIds,
  inventory,
  mode,
  npcs,
  saveId,
  stats,
  turnNumber,
}: StatsHudProps) {
  const { tokens } = useAppTheme();
  const { settings } = useReaderSettings();
  const resolvedMode: StatsHudMode = mode ?? statsHudModeFromSetting(settings.hudMode);

  const [sheetOpen, setSheetOpen] = useState(false);
  const openSheet = () => setSheetOpen(true);
  const closeSheet = () => setSheetOpen(false);

  // Receipts (pips). In Contextual mode the inline component already shows
  // them, so we suppress duplicates here.
  const previous = usePreviousStats(stats);
  const [receipts, setReceipts] = useState<Array<StatsDelta & { issuedAt: number }>>([]);

  useEffect(() => {
    if (!shouldBubbleReceiptsAtDispatcher(resolvedMode)) return;
    const deltas = diffVisibleStats(previous, stats, hiddenStatIds);
    if (deltas.length === 0) return;
    const issuedAt = Date.now();
    setReceipts((current) => [
      ...current,
      ...deltas.map((delta) => ({ ...delta, issuedAt })),
    ]);
  }, [hiddenStatIds, previous, resolvedMode, stats]);

  const dismissReceipt = (key: string, issuedAt: number) => {
    setReceipts((current) =>
      current.filter((pip) => !(pip.key === key && pip.issuedAt === issuedAt)),
    );
  };

  const commonProps = useMemo(
    () => {
      const base = {
        inventory,
        stats,
        onOpenFullSheet: openSheet,
      } as const;
      const extras: {
        hiddenStatIds?: ReadonlyArray<string>;
        characterName?: string;
        turnNumber?: number;
        npcs?: Record<string, NpcState>;
        accountId?: string;
        saveId?: string;
      } = {};
      if (hiddenStatIds !== undefined) extras.hiddenStatIds = hiddenStatIds;
      if (characterName !== undefined) extras.characterName = characterName;
      if (turnNumber !== undefined) extras.turnNumber = turnNumber;
      if (npcs !== undefined) extras.npcs = npcs;
      if (accountId !== undefined) extras.accountId = accountId;
      if (saveId !== undefined) extras.saveId = saveId;
      return { ...base, ...extras };
    },
    [accountId, characterName, hiddenStatIds, inventory, npcs, saveId, stats, turnNumber],
  );

  return (
    <View accessibilityLabel="Stats HUD" style={{ gap: tokens.spacing.sm }}>
      {receipts.length > 0 ? (
        <View accessibilityLabel="Stat receipts" style={{ gap: tokens.spacing.xs }}>
          {receipts.map((pip) => (
            <StatPip
              delta={pip.delta}
              key={`${pip.key}-${pip.issuedAt}`}
              label={pip.label}
              onDismiss={() => dismissReceipt(pip.key, pip.issuedAt)}
              value={pip.value}
            />
          ))}
        </View>
      ) : null}
      {resolvedMode === "persistent" ? <PersistentMode {...commonProps} /> : null}
      {resolvedMode === "peekDrawer" ? <PeekDrawerMode {...commonProps} /> : null}
      {resolvedMode === "contextual" ? <ContextualMode {...commonProps} /> : null}
      <FullSheetMode
        {...commonProps}
        onCloseFullSheet={closeSheet}
        visible={sheetOpen || resolvedMode === "fullSheet"}
      />
    </View>
  );
}
