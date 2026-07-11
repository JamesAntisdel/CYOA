import { View } from "react-native";

import { ChoiceList } from "../../choices/ChoiceList";
import { EndingPanel } from "../../death/EndingPanel";
import { CinematicMoment } from "../../media/CinematicMoment";
import { SceneCinematic } from "../../media/SceneCinematic";
import { SceneMedia } from "../../media/SceneMedia";
import { Divider, Stamp, Surface, Text } from "../../primitives";
import { StatsHud } from "../../stats/StatsHud";
import { useAppTheme } from "../../../theme";
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
 * Book — the canvas reading-board default. Single column, generous gutter,
 * serif display title, ledger-style stamp for mode, prose surface with a HUD
 * footer. Mirrors the original ReaderScreen behavior so existing flows are
 * preserved when the user has not selected another layout.
 */
export function BookLayout({
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
  onFreeformSubmit,
  freeformPending = false,
  freeformError = null,
  dialogBlocksEnabled = true,
  accountId,
  recentChoiceEcho = null,
  onRetryCurrentTurn,
}: ReaderLayoutProps) {
  const { tokens } = useAppTheme();
  const showHud = hudMode !== "hidden";
  // Deterministic-fallback branch: the prose + choices on this projection
  // are the deterministic provider's placeholder ("press on into the
  // story") — the reader must NEVER see that as if it were a real scene.
  // Render `<FallbackTurnPanel />` in place of the prose surface + choice
  // list. Defensive: when the retry handler isn't wired we still suppress
  // the fake content (better an empty page than a fake scene).
  const isFallback = projection.scene.isFallback === true;

  return (
    <View style={{ gap: tokens.spacing.lg, maxWidth: 760, width: "100%" }}>
      <View style={{ gap: tokens.spacing.xs }}>
        <Stamp>{projection.mode}</Stamp>
        <Text variant="title">{projection.storyTitle}</Text>
        <Text muted>{projection.scene.title}</Text>
      </View>

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
          />

          <Surface padded style={{ gap: tokens.spacing.lg }}>
            <ProseRenderer
              prose={streamedProse}
              isStreaming={isStreaming}
              dialogBlocksEnabled={dialogBlocksEnabled}
            />
            {showHud ? (
              <>
                <Divider />
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
          </Surface>

          <SceneCinematic
            media={projection.scene.media}
            reducedMotion={reducedMotion}
            videoEnabled={videoEnabled}
          />

          {/*
            Inline "what just changed" pill. Sits between the prose surface
            and the choice list so the reader's eye lands on the consequence
            as they finish reading and reach for the next pick. Renders
            nothing on the first turn or when the echo is neutral/empty.
          */}
          <EffectBadge entry={recentChoiceEcho} reducedMotion={reducedMotion} />

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
                {...endingPanelHandlers({ onOpenEndings, onOpenLibrary, onReturnHome })}
              />
              {/* Story-engagement Wave 3 (R14) — fogged "what might have been"
                  cards for unreached candidate endings. Self-gates on terminal
                  + candidates; renders nothing on live / legacy saves. */}
              <WhatMightHaveBeen
                {...whatMightHaveBeenProps({ projection, onOpenEndings, onReturnHome })}
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
  );
}
