import { Pressable, View } from "react-native";

import type { NpcState } from "@cyoa/engine";

import type { RemoteArc, RemoteCodexEntry, RemoteRecentDiff } from "../../../../lib/gameApi";
import type { ReaderInventoryItem, ReaderStats } from "../../../../hooks/useTurn";
import { useAppTheme } from "../../../../theme";
import { DailyPulseChip } from "../../../daily/DailyPulseChip";
import { Text } from "../../../primitives";
import { StatsHud } from "../../../stats/StatsHud";
import { CandleBurnMeter } from "../../CandleGutter";
import { DoorsJournal } from "../../DoorsJournal";
import { QuestLine } from "../../QuestLine";
import { ThreadsPill } from "../../ThreadsPill";
import { buildRibbonSegments } from "../../chrome/ribbonSegments";

type RemoteAuth = { accountId: string; guestTokenHash?: string };

/** Candle burn state — passed ONLY under today's `showCandleMeter` rule (≥50%). */
type MarginaliaCandle = { turnsUsed: number; turnsAllowed: number };

/**
 * PURE — does the stats signal warrant a margin note (RC2 self-hide predicate)?
 *
 * `ReaderStats` is always a populated `{vitality, nerve, insight}` object, so
 * the mere existence of the record can't gate the note (it would never hide).
 * The stats note earns the margin only when the reader actually carries
 * something — an inventory item OR a non-zero attribute. All-zero / empty ⇒ the
 * note (and, absent every other signal, the whole rail) hides so the
 * illustration takes the page (R3.1 / RC2).
 */
export function hasStatsSignal(
  stats: ReaderStats,
  inventory: readonly ReaderInventoryItem[] | null | undefined,
): boolean {
  if ((inventory?.length ?? 0) > 0) return true;
  return Object.values(stats).some((value) => typeof value === "number" && value > 0);
}

/**
 * PURE — the synchronous "should the rail render at all" gate (RC2). The verso
 * margin renders when ANY signal is present: an arc (pursuit + threads), a
 * lit candle (≥50%, the caller only passes it then), or a carried stat/item.
 * When every one is absent the rail returns null and the illustration takes the
 * whole verso page (R3.1). Doors + daily-pulse ride the arc gate exactly as the
 * declutter StoryRibbon does — an arc-less legacy save stays quiet (they only
 * ever surface alongside the pursuit line).
 */
export function shouldRenderMarginalia(input: {
  arc?: RemoteArc | undefined;
  candle?: MarginaliaCandle | undefined;
  stats: ReaderStats;
  inventory: readonly ReaderInventoryItem[] | null | undefined;
}): boolean {
  if (input.arc) return true;
  if (input.candle) return true;
  return hasStatsSignal(input.stats, input.inventory);
}

export type MarginaliaProps = {
  // ---- pursuit + threads (QuestLine / ThreadsPill) ------------------------
  /** Arc summary — drives the pursuit phrase (QuestLine) + threads (ThreadsPill). */
  arc?: RemoteArc | undefined;
  /** This turn's signed diffs — feeds ThreadsPill's one-shot echo toast. */
  recentDiffs?: RemoteRecentDiff[] | undefined;

  // ---- candle two-stage (mirrors StoryRibbon's contract) -----------------
  /** Burn state, passed ONLY under today's `showCandleMeter` rule (≥50%, stage 1). */
  candle?: MarginaliaCandle | undefined;
  /** Opens the patronage door from the ≥80% "candle burns low" note (stage 2). */
  onOpenPatronage?: (() => void) | undefined;

  // ---- the stats display (StatsHud) --------------------------------------
  stats: ReaderStats;
  inventory: ReaderInventoryItem[];
  npcs?: Record<string, NpcState> | undefined;
  codex?: RemoteCodexEntry[] | undefined;
  turnNumber?: number | undefined;
  hiddenStatIds?: ReadonlyArray<string> | undefined;
  /** Account id for StatsHud's live NPC-portrait lookup (FullSheet only). */
  accountId?: string | undefined;

  // ---- detail-mount identity (existing components mount UNCHANGED, RC2) ---
  sceneId: string;
  saveId: string;
  auth?: RemoteAuth | undefined;
  dailyId?: string | undefined;
  completedTurn: number;
  reducedMotion?: boolean;
};

/**
 * Marginalia (open-book R3 / OB5) — the verso margin rail: the tale's living
 * signals given the room the declutter denied them, rendered as quiet margin
 * notes down the illustration page.
 *
 * It composes the SAME components the declutter StoryRibbon composes —
 * QuestLine (the pursuit), ThreadsPill (threads yet to pull), DoorsJournal
 * (doors the tome remembers), DailyPulseChip (today's readers) — plus the
 * StatsHud (what the reader carries) and the two-stage candle note. Every note
 * SELF-HIDES on its own existing predicate; there are NO new queries and NO
 * re-derived predicates (RC2) — this is the ONE mount of these signals on the
 * spread (the ReaderScreen StoryRibbon is suppressed at `spread`, so the
 * fetch/toast effects run here exactly once, never doubled).
 *
 * When every signal is absent the rail renders null (via
 * {@link shouldRenderMarginalia}) so the full-page illustration takes the verso
 * (R3.1 / RC2). The candle two-stage rule is NOT forked — the ≥80% "candle
 * burns low" note is read straight off the shared {@link buildRibbonSegments}
 * model, and the CandleBurnMeter shows the ≥50% wick, both linking to the
 * patronage door (R3.2 / R3.3).
 */
export function Marginalia({
  arc,
  recentDiffs,
  candle,
  onOpenPatronage,
  stats,
  inventory,
  npcs,
  codex,
  turnNumber,
  hiddenStatIds,
  accountId,
  sceneId,
  saveId,
  auth,
  dailyId,
  completedTurn,
  reducedMotion = false,
}: MarginaliaProps) {
  const { tokens } = useAppTheme();

  // Every signal absent ⇒ the rail is null so the illustration takes the page.
  if (!shouldRenderMarginalia({ arc, candle, stats, inventory })) return null;

  // The ≥80%-burn "candle burns low" note, read STRAIGHT off the shared ribbon
  // model — the two-stage threshold (CANDLE_LOW_BURN) is reused, never forked.
  const candleNote = candle
    ? buildRibbonSegments({ candle }).find((segment) => segment.key === "candle")
    : undefined;

  const statsVisible = hasStatsSignal(stats, inventory);

  return (
    <View
      accessibilityLabel="The tale's margins"
      style={{
        borderTopColor: tokens.colors.borderMuted,
        borderTopWidth: tokens.borderWidths.hairline,
        gap: tokens.spacing.sm,
        paddingTop: tokens.spacing.md,
      }}
    >
      {/* Pursuit (QuestLine self-hides without an arc) + threads. */}
      {arc ? <QuestLine arc={arc} reducedMotion={reducedMotion} /> : null}
      {arc ? (
        <ThreadsPill
          threadsPending={arc.threadsPending}
          sceneId={sceneId}
          {...(recentDiffs ? { recentDiffs } : {})}
        />
      ) : null}

      {/* Doors the tome remembers (self-hides with no auth / no teased doors). */}
      <DoorsJournal saveId={saveId} sceneId={sceneId} {...(auth ? { auth } : {})} />

      {/* Today's readers (self-hides with no auth / no committed pulse). */}
      {dailyId ? (
        <DailyPulseChip
          completedTurn={completedTurn}
          dailyId={dailyId}
          {...(auth ? { auth } : {})}
        />
      ) : null}

      {/* What the reader carries — the stats given room in the margin. */}
      {statsVisible ? (
        <StatsHud
          inventory={inventory}
          stats={stats}
          saveId={saveId}
          {...(accountId ? { accountId } : {})}
          {...(npcs ? { npcs } : {})}
          {...(codex ? { codex } : {})}
          {...(recentDiffs ? { recentDiffs } : {})}
          {...(turnNumber !== undefined ? { turnNumber } : {})}
          {...(hiddenStatIds !== undefined ? { hiddenStatIds } : {})}
        />
      ) : null}

      {/* The candle: stage 1 (≥50%) is the wick meter; stage 2 (≥80%) is the
          book-voice "burns low" note linking to the patronage door (R3.2). */}
      {candle ? <CandleBurnMeter turnsAllowed={candle.turnsAllowed} turnsUsed={candle.turnsUsed} /> : null}
      {candleNote ? (
        onOpenPatronage ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${candleNote.label}. Keep the candle burning — see patronage.`}
            onPress={onOpenPatronage}
            style={({ pressed }) => ({
              minHeight: 44,
              opacity: pressed ? 0.7 : 1,
              paddingVertical: tokens.spacing.xs,
            })}
          >
            <Text
              style={{
                color: tokens.colors.accent,
                fontFamily: tokens.typography.families.serif,
              }}
              variant="bodySmall"
            >
              {candleNote.label}
            </Text>
          </Pressable>
        ) : (
          <Text
            style={{ color: tokens.colors.accent, fontFamily: tokens.typography.families.serif }}
            variant="bodySmall"
          >
            {candleNote.label}
          </Text>
        )
      ) : null}
    </View>
  );
}
