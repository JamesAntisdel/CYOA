import { View } from "react-native";

import { ChoiceList } from "../../choices/ChoiceList";
import { EndingPanel } from "../../death/EndingPanel";
import { CinematicMoment } from "../../media/CinematicMoment";
import { SceneCinematic } from "../../media/SceneCinematic";
import { SceneMedia } from "../../media/SceneMedia";
import { Surface, Text } from "../../primitives";
import { StatsHud } from "../../stats/StatsHud";
import { useAppTheme } from "../../../theme";
import { EffectBadge } from "../EffectBadge";
import { FallbackTurnPanel } from "../FallbackTurnPanel";
import { ProseRenderer } from "../ProseRenderer";
import { endingPanelHandlers, endingVariantProps, type ReaderLayoutProps } from "./types";

/**
 * Mobile — canvas § 19 A. Tight gutter, drop-cap-style title row, a peek-
 * drawer affordance below the choices. Optimized for thumb reach: choices
 * always sit above the bottom rail, stats sit in a one-row chip strip.
 */
export function MobileLayout({
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
  // Deterministic-fallback branch: suppress prose + choices, render the
  // FallbackTurnPanel only. See `Book.tsx` for the rationale comment.
  const isFallback = projection.scene.isFallback === true;

  return (
    // maxWidth bumped from 420 → 560 so the Mobile layout still reads as
    // "phone chrome" but doesn't artificially shrink to a 420-px column
    // on the 414–560 phone-landscape / small-tablet band. On a 375px
    // viewport the parent ScrollView's padding caps the effective width
    // well below 560 anyway, so the visual on the iPhone-class portrait
    // is unchanged.
    <View style={{ gap: tokens.spacing.sm, maxWidth: 560, width: "100%" }}>
      <View
        style={{
          alignItems: "baseline",
          borderColor: tokens.colors.borderMuted,
          borderBottomWidth: tokens.borderWidths.hairline,
          flexDirection: "row",
          justifyContent: "space-between",
          paddingBottom: tokens.spacing.sm,
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            muted
            style={{
              fontFamily: tokens.typography.families.mono,
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
            variant="caption"
          >
            {projection.storyTitle}
          </Text>
          <Text
            style={{
              fontFamily: tokens.typography.families.serif,
              fontStyle: "italic",
            }}
            variant="subtitle"
          >
            {projection.scene.title}
          </Text>
        </View>
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

          <Surface padded style={{ gap: tokens.spacing.sm }}>
            <ProseRenderer
              prose={streamedProse}
              isStreaming={isStreaming}
              dialogBlocksEnabled={dialogBlocksEnabled}
              textStyle={{ fontFamily: tokens.typography.families.serif }}
            />
          </Surface>

          {/* Inline consequence pill — sits between prose and cinematic so a
              thumb-scrolling reader passes it on the way to the choice list. */}
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
                {...endingPanelHandlers({ onOpenEndings, onOpenLibrary, onReturnHome })}
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

      {showHud ? (
        <View style={{ paddingTop: tokens.spacing.xs }}>
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
        </View>
      ) : null}

      <View
        accessibilityHint="Peek drawer handle"
        style={{
          alignSelf: "center",
          backgroundColor: tokens.colors.borderMuted,
          borderRadius: tokens.radii.pill,
          height: 4,
          marginTop: tokens.spacing.xs,
          width: 60,
        }}
      />
    </View>
  );
}
