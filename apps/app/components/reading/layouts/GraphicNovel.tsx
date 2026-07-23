import { View } from "react-native";

import { ChoiceList } from "../../choices/ChoiceList";
import { EndingPanel } from "../../death/EndingPanel";
import { CinematicMoment } from "../../media/CinematicMoment";
import { SceneCinematic } from "../../media/SceneCinematic";
import { SceneMedia } from "../../media/SceneMedia";
import { IlluminateButton } from "../IlluminateButton";
import { Stamp, Surface, Text } from "../../primitives";
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

/**
 * GraphicNovel — canvas § 19 B. Pro variant. Full-bleed illustration plate
 * with a small "speech plate" prose card overlay-style and an action rail
 * underneath. On the native runtime we approximate the overlay with stacked
 * surfaces so we don't depend on a web-only positioning primitive.
 */
export function GraphicNovelLayout({
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
  const showHud = hudMode !== "hidden";
  // Deterministic-fallback branch: suppress the plate + speech-plate +
  // choices and render `<FallbackTurnPanel />` only. See `Book.tsx` for
  // the rationale comment.
  const isFallback = projection.scene.isFallback === true;

  return (
    <View
      style={{
        gap: tokens.spacing.sm,
        maxWidth: 540,
        width: "100%",
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Stamp>Pro · plate</Stamp>
        <Text muted variant="caption">
          {projection.storyTitle} · {projection.scene.title}
        </Text>
      </View>

      {isFallback ? (
        <FallbackTurnPanel
          onRetry={onRetryCurrentTurn ?? (() => undefined)}
          reducedMotion={reducedMotion}
        />
      ) : (
        <>
          <View
            style={{
              backgroundColor: tokens.colors.text,
              borderColor: tokens.colors.border,
              borderRadius: tokens.radii.xs,
              borderWidth: tokens.borderWidths.regular,
              padding: tokens.spacing.md,
            }}
          >
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
          </View>

          {saveId && illuminateAuth ? (
            <IlluminateButton saveId={saveId} auth={illuminateAuth} reducedMotion={reducedMotion} />
          ) : null}

          <Surface
            padded
            style={{
              backgroundColor: tokens.colors.surface,
              borderColor: tokens.colors.text,
              borderWidth: tokens.borderWidths.heavy,
              gap: tokens.spacing.sm,
            }}
          >
            <ProseRenderer
              prose={streamedProse}
              isStreaming={isStreaming}
              dialogBlocksEnabled={dialogBlocksEnabled}
              textVariant="subtitle"
              textStyle={{
                fontFamily: tokens.typography.families.serif,
                fontStyle: "italic",
              }}
            />
            {/* Panel-caption style consequence pill — sits inside the speech
                plate so it reads as part of the panel, not chrome between panels. */}
            <EffectBadge entry={recentChoiceEcho} reducedMotion={reducedMotion} />
          </Surface>

          <SceneCinematic
            media={projection.scene.media}
            reducedMotion={reducedMotion}
            videoEnabled={videoEnabled}
          />

          {showHud ? (
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
          ) : null}

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
              {/* "Your choices echoed" — the run's visible-choice recap on the
                  terminal panel. Skipped when this session recorded none. */}
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
            <View
              style={{
                backgroundColor: tokens.colors.surfaceMuted,
                borderColor: tokens.colors.border,
                borderTopWidth: tokens.borderWidths.regular,
                padding: tokens.spacing.sm,
              }}
            >
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
            </View>
          )}
        </>
      )}
    </View>
  );
}
