import { View } from "react-native";

import { ChoiceList } from "../../choices/ChoiceList";
import { EndingPanel } from "../../death/EndingPanel";
import { CinematicMoment } from "../../media/CinematicMoment";
import { SceneCinematic } from "../../media/SceneCinematic";
import { SceneMedia } from "../../media/SceneMedia";
import { Stamp, Surface, Text } from "../../primitives";
import { StatsHud } from "../../stats/StatsHud";
import { useAppTheme } from "../../../theme";
import { EffectBadge } from "../EffectBadge";
import { FallbackTurnPanel } from "../FallbackTurnPanel";
import { ProseRenderer } from "../ProseRenderer";
import { endingPanelHandlers, endingVariantProps, type ReaderLayoutProps } from "./types";

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
            />
          </View>

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
                {...endingPanelHandlers({ onOpenEndings, onOpenLibrary, onReturnHome })}
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
