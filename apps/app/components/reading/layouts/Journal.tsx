import { View } from "react-native";

import { ChoiceList } from "../../choices/ChoiceList";
import { EndingPanel } from "../../death/EndingPanel";
import { SceneCinematic } from "../../media/SceneCinematic";
import { Stamp, Surface, Text } from "../../primitives";
import { StatsHud } from "../../stats/StatsHud";
import { useAppTheme } from "../../../theme";
import { endingPanelHandlers, endingVariantProps, type ReaderLayoutProps } from "./types";

/**
 * Journal — canvas § 19 D. Ruled-paper feel with a red margin rule, mono
 * entry meta, serif italic title, and mono-flavored body. Prose lives in a
 * full-bleed surface that mimics a diary page; media is intentionally
 * de-emphasized (no plate) — only the SceneMedia status text appears.
 */
export function JournalLayout({
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
  // Journal intentionally renders no SceneMedia plate (canvas § 19 D —
  // media is de-emphasized in this layout), so imagesEnabled / audioEnabled
  // are accepted but ignored. videoEnabled still gates the lower slot.
  videoEnabled = true,
}: ReaderLayoutProps) {
  const { tokens } = useAppTheme();
  const showHud = hudMode !== "hidden";

  return (
    <View style={{ gap: tokens.spacing.md, maxWidth: 560, width: "100%" }}>
      <View
        style={{
          alignItems: "baseline",
          flexDirection: "row",
          justifyContent: "space-between",
        }}
      >
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
          muted
          style={{
            fontFamily: tokens.typography.families.mono,
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
          variant="caption"
        >
          Entry · turn {projection.scene.id.slice(0, 6)}
        </Text>
      </View>

      <Surface
        padded
        style={{
          // Red margin rule on the left echoes the canvas journal artwork.
          borderLeftColor: tokens.colors.accent,
          borderLeftWidth: tokens.borderWidths.heavy,
          gap: tokens.spacing.md,
        }}
        variant="muted"
      >
        <Text
          style={{
            fontFamily: tokens.typography.families.serif,
            fontStyle: "italic",
          }}
          variant="title"
        >
          {projection.scene.title}
        </Text>
        <Text
          accessibilityLiveRegion={isStreaming ? "polite" : "none"}
          style={{
            fontFamily: tokens.typography.families.mono,
          }}
          variant="body"
        >
          {streamedProse}
        </Text>
      </Surface>

      <SceneCinematic
        media={projection.scene.media}
        reducedMotion={reducedMotion}
        videoEnabled={videoEnabled}
      />

      {showHud ? (
        <View style={{ gap: tokens.spacing.xs }}>
          <Stamp>Margins</Stamp>
          <StatsHud
            inventory={projection.inventory}
            // HUD reads mode from useReaderSettings itself
            stats={projection.stats}
          />
        </View>
      ) : null}

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
        <View
          style={{
            borderColor: tokens.colors.borderMuted,
            borderStyle: "dashed",
            borderTopWidth: tokens.borderWidths.regular,
            paddingTop: tokens.spacing.sm,
          }}
        >
          <ChoiceList
            choices={projection.choices}
            disabled={isStreaming}
            onChoose={onChoose}
            pendingChoiceId={pendingChoiceId}
          />
        </View>
      )}
    </View>
  );
}
