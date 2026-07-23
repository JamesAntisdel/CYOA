import { useWindowDimensions, View } from "react-native";

import { ChoiceList } from "../../choices/ChoiceList";
import { EndingPanel } from "../../death/EndingPanel";
import { CinematicMoment } from "../../media/CinematicMoment";
import { SceneCinematic } from "../../media/SceneCinematic";
import { SceneMedia } from "../../media/SceneMedia";
import { IlluminateButton } from "../IlluminateButton";
import { Divider, Stamp, Surface, Text } from "../../primitives";
import { StatsHud } from "../../stats/StatsHud";
import { useAppTheme } from "../../../theme";
import { ConsequenceReel } from "../ConsequenceReel";
import { EffectBadge } from "../EffectBadge";
import { FallbackTurnPanel } from "../FallbackTurnPanel";
import { ProseRenderer } from "../ProseRenderer";
import { WhatMightHaveBeen } from "../WhatMightHaveBeen";
import {
  endingPanelHandlers,
  endingVariantProps,
  whatMightHaveBeenProps,
  type ReaderLayoutProps,
} from "./types";

const RAIL_BREAKPOINT = 760;

/**
 * ModernApp — canvas § 19 C. Chapters rail · prose · HUD rail. The chapters
 * rail and the HUD rail collapse below 760px so the layout remains usable on
 * phone widths without forking the projection.
 */
export function ModernAppLayout({
  projection,
  streamedProse,
  isStreaming,
  pendingChoiceId,
  onChoose,
  hudMode,
  reducedMotion,
  onOpenEndings,
  onOpenLibrary,
  onReturnHome,
  onBeginAgain,
  onSeeMap,
  onShareEnding,
  onReadAsBook,
  onFork,
  choiceHistory,
  endingTier,
  cinematicUri,
  endingIsFirstFind,
  endingCinematic,
  muted = false,
  imagesEnabled = true,
  audioEnabled = true,
  videoEnabled = true,
  narratorPlaybackRate = 1,
  onNarratorPlaybackRateChange,
  onNarrationActiveChange,
  onFreeformSubmit,
  freeformPending = false,
  freeformError = null,
  dialogBlocksEnabled = true,
  accountId,
  recentChoiceEcho = null,
  onRetryCurrentTurn,
  saveId,
  illuminateAuth,
}: ReaderLayoutProps) {
  const { tokens } = useAppTheme();
  const { width } = useWindowDimensions();
  const showRails = width >= RAIL_BREAKPOINT;
  const showHud = hudMode !== "hidden";
  // Deterministic-fallback branch: suppress the prose surface + choices,
  // render `<FallbackTurnPanel />` only in the center column. The chapter
  // / HUD rails stay mounted so the reader doesn't lose orientation.
  const isFallback = projection.scene.isFallback === true;

  return (
    <View style={{ flexDirection: showRails ? "row" : "column", gap: tokens.spacing.lg, width: "100%" }}>
      {showRails ? (
        <Surface
          style={{
            flexBasis: 168,
            flexShrink: 0,
            gap: tokens.spacing.sm,
            padding: tokens.spacing.md,
          }}
          variant="muted"
        >
          <RailLabel>Chapters</RailLabel>
          <ChapterStub label={projection.scene.title} active />
          <Text muted variant="caption">
            Save · just now
          </Text>
        </Surface>
      ) : null}

      <View style={{ flex: 1, gap: tokens.spacing.md, minWidth: 0 }}>
        <RailLabel>{projection.storyTitle}</RailLabel>
        <Text variant="title">{projection.scene.title}</Text>
        {isFallback ? (
          <FallbackTurnPanel
            onRetry={onRetryCurrentTurn ?? (() => undefined)}
            reducedMotion={reducedMotion}
          />
        ) : (
          <>
            <SceneMedia
              media={projection.scene.media}
              reducedMotion={reducedMotion}
              sceneId={projection.scene.id}
              imagesEnabled={imagesEnabled}
              audioEnabled={audioEnabled}
              narratorPlaybackRate={narratorPlaybackRate}
              {...(onNarratorPlaybackRateChange ? { onNarratorPlaybackRateChange } : {})}
              {...(onNarrationActiveChange ? { onNarrationActiveChange } : {})}
            />
            {saveId && illuminateAuth ? (
              <IlluminateButton saveId={saveId} auth={illuminateAuth} reducedMotion={reducedMotion} />
            ) : null}
            <Surface padded style={{ gap: tokens.spacing.md }}>
              <ProseRenderer
                prose={streamedProse}
                isStreaming={isStreaming}
                dialogBlocksEnabled={dialogBlocksEnabled}
              />
            </Surface>
            {/* Inline consequence pill — sits between prose and cinematic in
                the center column where the reader's focus already is. */}
            <EffectBadge entry={recentChoiceEcho} reducedMotion={reducedMotion} />
            <SceneCinematic
              media={projection.scene.media}
              reducedMotion={reducedMotion}
              videoEnabled={videoEnabled}
            />
            {projection.ending ? (
              <>
                {endingCinematic ? (
                  <CinematicMoment
                    cinematic={endingCinematic}
                    reducedMotion={reducedMotion}
                    muted={muted}
                    {...(projection.scene.media?.imageUri
                      ? { posterFallbackUri: projection.scene.media.imageUri }
                      : {})}
                  />
                ) : null}
                <EndingPanel
                  ending={projection.ending}
                  {...endingVariantProps({
                    projection,
                    ...(endingTier !== undefined ? { tier: endingTier } : {}),
                    ...(cinematicUri !== undefined ? { cinematicUri } : {}),
                    ...(endingIsFirstFind !== undefined ? { isFirstFind: endingIsFirstFind } : {}),
                  })}
                  {...endingPanelHandlers({ onOpenEndings, onOpenLibrary, onReturnHome, onBeginAgain, onSeeMap, onShareEnding, onReadAsBook })}
                />
                {/* "Your choices echoed" — the run's visible-choice recap on
                    the terminal panel. Skipped when this session recorded
                    none. */}
                {choiceHistory && choiceHistory.length > 0 ? (
                  <ConsequenceReel entries={choiceHistory} />
                ) : null}
                {/* Story-engagement Wave 3 (R14) — fogged "what might have been"
                    cards for unreached candidate endings. Self-gates on terminal
                    + candidates; renders nothing on live / legacy saves. */}
                <WhatMightHaveBeen
                  {...whatMightHaveBeenProps({ projection, onOpenEndings, onReturnHome, onFork, onBeginAgain })}
                />
              </>
            ) : (
              <ChoiceList
                choices={projection.choices}
                disabled={isStreaming}
                onChoose={onChoose}
                pendingChoiceId={pendingChoiceId}
                reducedMotion={reducedMotion}
                {...(onFreeformSubmit ? { onFreeformSubmit } : {})}
                freeformPending={freeformPending}
                freeformError={freeformError}
              />
            )}
          </>
        )}
      </View>

      {showRails && showHud ? (
        <Surface
          style={{
            flexBasis: 168,
            flexShrink: 0,
            gap: tokens.spacing.sm,
            padding: tokens.spacing.md,
          }}
          variant="muted"
        >
          <RailLabel>You</RailLabel>
          <StatsHud
            inventory={projection.inventory}
            // HUD reads mode from useReaderSettings itself
            {...(projection.npcs ? { npcs: projection.npcs } : {})}
            stats={projection.stats}
            {...(accountId ? { accountId } : {})}
            saveId={projection.saveId}
            {...(projection.codex ? { codex: projection.codex } : {})}
            {...(projection.recentDiffs ? { recentDiffs: projection.recentDiffs } : {})}
            {...(projection.turnNumber !== undefined ? { turnNumber: projection.turnNumber } : {})}
          />
        </Surface>
      ) : !showRails && showHud ? (
        <>
          <Divider />
          <Stamp>You</Stamp>
          <StatsHud
            inventory={projection.inventory}
            // HUD reads mode from useReaderSettings itself
            {...(projection.npcs ? { npcs: projection.npcs } : {})}
            stats={projection.stats}
            {...(accountId ? { accountId } : {})}
            saveId={projection.saveId}
            {...(projection.codex ? { codex: projection.codex } : {})}
            {...(projection.recentDiffs ? { recentDiffs: projection.recentDiffs } : {})}
            {...(projection.turnNumber !== undefined ? { turnNumber: projection.turnNumber } : {})}
          />
        </>
      ) : null}
    </View>
  );
}

function RailLabel({ children }: { children: string }) {
  const { tokens } = useAppTheme();
  return (
    <Text
      style={{
        color: tokens.colors.textFaint,
        fontFamily: tokens.typography.families.mono,
        letterSpacing: 2,
        textTransform: "uppercase",
      }}
      variant="caption"
    >
      {children}
    </Text>
  );
}

function ChapterStub({ label, active }: { label: string; active?: boolean }) {
  const { tokens } = useAppTheme();
  return (
    <Text
      style={{
        color: active ? tokens.colors.accent : tokens.colors.text,
        fontFamily: tokens.typography.families.serif,
        fontStyle: "italic",
        fontWeight: active ? "700" : "400",
      }}
      variant="bodySmall"
    >
      {label}
    </Text>
  );
}
