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
 * IllustratedBook — reading-modes R3 (Wave 2). The Pro "Illustrated Book"
 * reading mode: image-first, a GUARANTEED still per scene.
 *
 * Cloned from `GraphicNovelLayout` and re-weighted so the illustration is the
 * page rather than a garnish:
 *
 *   - the illustration plate sits full-bleed at the TOP as the visual anchor
 *     (edge-to-edge, no dark speech-plate frame),
 *   - the prose reads BENEATH it as a clean book surface (primary, always
 *     readable — the turn never blocks on media, R3.6), and
 *   - the `ChoiceList` renders as QUIET FOOTNOTES in a subdued footer.
 *
 * It consumes the IDENTICAL `ReaderLayoutProps` as every other skin, so the
 * turn pipeline never forks (R3.2) — the endings / HUD / freeform / fallback /
 * Illuminate wiring is byte-for-byte the shared contract. The still-guarantee
 * itself is a SERVER concern (the resolver owns it, RM8); when a still can't be
 * drawn the server emits an out-of-credits signal and `MediaPlate` degrades to
 * a stylized placeholder (R3.4) rather than a bare skeleton — this layout just
 * keeps prose readable over whatever the plate is showing.
 */
export function IllustratedBookLayout({
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
  // Deterministic-fallback branch: suppress the plate + prose + choices and
  // render `<FallbackTurnPanel />` only. Same rationale as the sibling skins.
  const isFallback = projection.scene.isFallback === true;

  return (
    <View
      style={{
        gap: tokens.spacing.md,
        maxWidth: 620,
        width: "100%",
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Stamp>Pro · illustrated</Stamp>
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
          {/* Full-bleed illustration plate — the page's visual anchor. No dark
              speech-plate frame; the illustration is meant to fill the top.
              The guaranteed-still contract lives server-side (RM8); MediaPlate
              degrades to a stylized placeholder on the out-of-credits signal
              (R3.4) so this slot is never a permanent bare skeleton. */}
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

          {/* Prose reads beneath the plate as a clean book surface — primary,
              always readable while the plate loads or degrades (R3.6). */}
          <Surface
            padded
            style={{
              backgroundColor: tokens.colors.surface,
              borderColor: tokens.colors.border,
              borderWidth: tokens.borderWidths.regular,
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
              }}
            />
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
              {choiceHistory && choiceHistory.length > 0 ? (
                <ConsequenceReel entries={choiceHistory} />
              ) : null}
              <WhatMightHaveBeen
                {...whatMightHaveBeenProps({ projection, onOpenEndings, onReturnHome, onFork, onBeginAgain })}
              />
            </>
          ) : (
            /* Choices as quiet footnotes — a subdued footer under the prose so
               the illustration + prose stay the page, and the branch is a
               gentle aside rather than a button wall. */
            <View
              style={{
                backgroundColor: tokens.colors.surfaceMuted,
                borderColor: tokens.colors.border,
                borderTopWidth: tokens.borderWidths.regular,
                opacity: 0.92,
                paddingHorizontal: tokens.spacing.sm,
                paddingVertical: tokens.spacing.xs,
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
