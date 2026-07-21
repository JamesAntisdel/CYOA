import { useState } from "react";
import { Pressable, View } from "react-native";

import type { RemoteArc, RemoteRecentDiff } from "../../../lib/gameApi";
import { useAppTheme } from "../../../theme";
import { DailyPulseChip } from "../../daily/DailyPulseChip";
import { Button, Text } from "../../primitives";
import { CandleBurnMeter } from "../CandleGutter";
import { DoorsJournal } from "../DoorsJournal";
import { QuestLine } from "../QuestLine";
import { ThreadsPill } from "../ThreadsPill";
import { buildRibbonSegments, PAGE_COLUMN_MAX, type RibbonSegment } from "./ribbonSegments";

type RemoteAuth = { accountId: string; guestTokenHash?: string };

export type StoryRibbonProps = {
  /** Arc summary — drives the pursuit phrase + threads count (RC2 predicate). */
  arc?: RemoteArc | undefined;
  /**
   * Live doors count for the COLLAPSED doors segment. DoorsJournal self-fetches
   * its entries (RC2) and is the source of truth in the detail; ReaderScreen
   * has no synchronous count today, so the collapsed doors segment only appears
   * once a count is threaded here (see the wiring note in the wave report).
   */
  doorsCount?: number | undefined;
  /** Daily-pulse one-liner for the COLLAPSED pulse segment (same async caveat). */
  pulseLine?: string | undefined;
  /** Candle burn state — passed ONLY under today's `showCandleMeter` rule (≥50%). */
  candle?: { turnsUsed: number; turnsAllowed: number } | undefined;
  /** Opens the patronage door from the candle detail — RC-WIRE routes to /paywall. */
  onOpenPatronage?: (() => void) | undefined;
  /**
   * Upward count/pulse reporters threaded to THIS ribbon's own detail mounts
   * of DoorsJournal / DailyPulseChip — the single fetch per surface serves
   * both the detail render and the collapsed segments (no twin mounts, no
   * doubled network calls; RC2). ReaderScreen holds the state and feeds it
   * back via `doorsCount` / `pulseLine`.
   */
  onDoorsCount?: ((count: number) => void) | undefined;
  onPulseLine?: ((line: string | undefined) => void) | undefined;
  reducedMotion?: boolean;

  // ---- detail-mount identity (existing components mount UNCHANGED, RC2) ----
  sceneId: string;
  saveId: string;
  auth?: RemoteAuth | undefined;
  recentDiffs?: RemoteRecentDiff[] | undefined;
  dailyId?: string | undefined;
  completedTurn: number;
};

/**
 * StoryRibbon (R3) — the tale's living margins collapsed to ONE quiet line.
 *
 * Collapsed, it renders {@link buildRibbonSegments}: the ≥80%-burn candle
 * segment leads (U4), then the pursuit phrase (U1), then compact counts. When
 * every signal is absent it renders nothing (RC2 — zero layout shift).
 *
 * Tapping it expands an in-column detail panel that mounts the EXISTING
 * QuestLine / ThreadsPill / DoorsJournal / DailyPulseChip components unchanged
 * (their hooks fetch exactly as today; no new queries). The detail is an inline
 * panel rather than a modal on purpose: the strips stay MOUNTED while collapsed
 * (clipped to zero height, not unmounted) so ThreadsPill's thread-fired echo
 * toast and DoorsJournal's key-arrival nudge still fire from the collapsed
 * state (R3.3). The candle detail carries the full meter plus the patronage
 * door (R3.4). Reduced motion is inherent — the expand is an instant toggle.
 */
export function StoryRibbon({
  arc,
  doorsCount,
  pulseLine,
  candle,
  onOpenPatronage,
  onDoorsCount,
  onPulseLine,
  reducedMotion = false,
  sceneId,
  saveId,
  auth,
  recentDiffs,
  dailyId,
  completedTurn,
}: StoryRibbonProps) {
  const { tokens } = useAppTheme();
  const [expanded, setExpanded] = useState(false);

  const segments = buildRibbonSegments({
    ...(arc ? { pursuit: arc.dramaticQuestion, threadsPending: arc.threadsPending } : {}),
    ...(doorsCount !== undefined ? { doorsCount } : {}),
    ...(pulseLine !== undefined ? { pulseLine } : {}),
    ...(candle ? { candle } : {}),
  });

  // All signals absent ⇒ nothing renders (RC2). When an arc exists the pursuit
  // phrase guarantees a segment, so the detail (and ThreadsPill's toast effect)
  // stays mounted whenever it did today.
  if (segments.length === 0) return null;

  const lead = segments[0] as RibbonSegment;
  const rest = segments.slice(1);
  const leadIsCandle = lead.key === "candle";

  return (
    <View style={{ alignSelf: "center", maxWidth: PAGE_COLUMN_MAX, width: "100%" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`The tale's margins: ${segments.map((s) => s.label).join(", ")}`}
        accessibilityHint={expanded ? "Hide the details" : "Show the details"}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((v) => !v)}
        style={({ pressed }) => ({
          alignItems: "center",
          flexDirection: "row",
          gap: tokens.spacing.xs,
          minHeight: 44,
          opacity: pressed ? 0.7 : 1,
          paddingVertical: tokens.spacing.xs,
        })}
      >
        <Text
          numberOfLines={1}
          style={{
            color: leadIsCandle ? tokens.colors.accent : tokens.colors.text,
            flexShrink: 1,
            fontFamily: tokens.typography.families.serif,
            ...(leadIsCandle ? {} : { fontStyle: "italic" }),
          }}
          variant="bodySmall"
        >
          {lead.label}
        </Text>
        {rest.length > 0 ? (
          <Text
            numberOfLines={1}
            style={{ color: tokens.colors.textFaint, flexShrink: 0 }}
            variant="caption"
          >
            {rest.map((s) => `· ${s.label}`).join(" ")}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        {/* Geometric expand chevron (not a control emoji — RC5). */}
        <Text aria-hidden style={{ color: tokens.colors.accent }} variant="caption">
          {"▾"}
        </Text>
      </Pressable>

      {/*
        Detail panel — ALWAYS mounted so the composed strips' toast/fetch
        effects run while the ribbon is collapsed (R3.3). Collapsed, it is
        clipped to zero height and removed from the a11y tree; expanded, it lays
        out normally. No animation ⇒ reduced-motion-safe by construction.
      */}
      <View
        accessibilityElementsHidden={!expanded}
        importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}
        pointerEvents={expanded ? "auto" : "none"}
        style={
          expanded
            ? { gap: tokens.spacing.sm, paddingBottom: tokens.spacing.sm }
            : // display:none (NOT height-0 clip): on react-native-web a
              // zero-height clipped Pressable stays in the keyboard Tab order
              // (aria-hidden / pointer-events don't strip tabindex), so hidden
              // detail controls were focusable + Enter-activatable while
              // invisible. display:none removes them from the tab order but
              // keeps the components MOUNTED — their fetch/toast effects
              // (R3.3) still run.
              { display: "none" }
        }
      >
        <QuestLine reducedMotion={reducedMotion} {...(arc ? { arc } : {})} />
        {arc ? (
          <ThreadsPill
            threadsPending={arc.threadsPending}
            sceneId={sceneId}
            {...(recentDiffs ? { recentDiffs } : {})}
          />
        ) : null}
        {dailyId ? (
          <DailyPulseChip
            completedTurn={completedTurn}
            dailyId={dailyId}
            {...(onPulseLine ? { onPulseLine } : {})}
            {...(auth ? { auth } : {})}
          />
        ) : null}
        <DoorsJournal
          saveId={saveId}
          sceneId={sceneId}
          {...(onDoorsCount ? { onCount: onDoorsCount } : {})}
          {...(auth ? { auth } : {})}
        />
        {candle ? (
          <View style={{ gap: tokens.spacing.sm }}>
            <CandleBurnMeter turnsAllowed={candle.turnsAllowed} turnsUsed={candle.turnsUsed} />
            {onOpenPatronage ? (
              <Button
                accessibilityLabel="Keep the candle burning — see patronage"
                onPress={onOpenPatronage}
                variant="secondary"
              >
                Keep the candle burning
              </Button>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}
