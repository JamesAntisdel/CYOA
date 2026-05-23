import { View } from "react-native";

import { ChoiceList } from "../../choices/ChoiceList";
import { EndingPanel } from "../../death/EndingPanel";
import { SceneCinematic } from "../../media/SceneCinematic";
import { SceneMedia } from "../../media/SceneMedia";
import { Divider, Stamp, Surface, Text } from "../../primitives";
import { StatsHud } from "../../stats/StatsHud";
import { useAppTheme } from "../../../theme";
import { endingPanelHandlers, endingVariantProps, type ReaderLayoutProps } from "./types";

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
  imagesEnabled = true,
  audioEnabled = true,
  videoEnabled = true,
  onFreeformSubmit,
  freeformPending = false,
  freeformError = null,
}: ReaderLayoutProps) {
  const { tokens } = useAppTheme();
  const showHud = hudMode !== "hidden";

  return (
    <View style={{ gap: tokens.spacing.lg, maxWidth: 760, width: "100%" }}>
      <View style={{ gap: tokens.spacing.xs }}>
        <Stamp>{projection.mode}</Stamp>
        <Text variant="title">{projection.storyTitle}</Text>
        <Text muted>{projection.scene.title}</Text>
      </View>

      <SceneMedia
        media={projection.scene.media}
        reducedMotion={reducedMotion}
        sceneId={projection.scene.id}
        imagesEnabled={imagesEnabled}
        audioEnabled={audioEnabled}
      />

      <Surface padded style={{ gap: tokens.spacing.lg }}>
        <Text variant="body" accessibilityLiveRegion={isStreaming ? "polite" : "none"}>
          {streamedProse}
        </Text>
        {showHud ? (
          <>
            <Divider />
            <StatsHud
              inventory={projection.inventory}
              // HUD reads mode from useReaderSettings itself
              stats={projection.stats}
            />
          </>
        ) : null}
      </Surface>

      <SceneCinematic
        media={projection.scene.media}
        reducedMotion={reducedMotion}
        videoEnabled={videoEnabled}
      />

      {projection.ending ? (
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
      ) : (
        <ChoiceList
          choices={projection.choices}
          disabled={isStreaming}
          onChoose={onChoose}
          pendingChoiceId={pendingChoiceId}
          {...(onFreeformSubmit ? { onFreeformSubmit } : {})}
          freeformPending={freeformPending}
          freeformError={freeformError}
        />
      )}
    </View>
  );
}
