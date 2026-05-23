import { useWindowDimensions, View } from "react-native";

import { ChoiceList } from "../../choices/ChoiceList";
import { EndingPanel } from "../../death/EndingPanel";
import { SceneCinematic } from "../../media/SceneCinematic";
import { SceneMedia } from "../../media/SceneMedia";
import { Divider, Stamp, Surface, Text } from "../../primitives";
import { StatsHud } from "../../stats/StatsHud";
import { useAppTheme } from "../../../theme";
import { endingPanelHandlers, endingVariantProps, type ReaderLayoutProps } from "./types";

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
  endingTier,
  cinematicUri,
  endingIsFirstFind,
  imagesEnabled = true,
  audioEnabled = true,
  videoEnabled = true,
  narratorPlaybackRate = 1,
  onNarratorPlaybackRateChange,
  onFreeformSubmit,
  freeformPending = false,
  freeformError = null,
}: ReaderLayoutProps) {
  const { tokens } = useAppTheme();
  const { width } = useWindowDimensions();
  const showRails = width >= RAIL_BREAKPOINT;
  const showHud = hudMode !== "hidden";

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
        <SceneMedia
          media={projection.scene.media}
          reducedMotion={reducedMotion}
          sceneId={projection.scene.id}
          imagesEnabled={imagesEnabled}
          audioEnabled={audioEnabled}
          narratorPlaybackRate={narratorPlaybackRate}
          {...(onNarratorPlaybackRateChange ? { onNarratorPlaybackRateChange } : {})}
        />
        <Surface padded style={{ gap: tokens.spacing.md }}>
          <Text accessibilityLiveRegion={isStreaming ? "polite" : "none"} variant="body">
            {streamedProse}
          </Text>
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
            stats={projection.stats}
          />
        </Surface>
      ) : !showRails && showHud ? (
        <>
          <Divider />
          <Stamp>You</Stamp>
          <StatsHud
            inventory={projection.inventory}
            // HUD reads mode from useReaderSettings itself
            stats={projection.stats}
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
