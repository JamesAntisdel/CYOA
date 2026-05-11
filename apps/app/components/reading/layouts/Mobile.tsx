import { View } from "react-native";

import { ChoiceList } from "../../choices/ChoiceList";
import { EndingPanel } from "../../death/EndingPanel";
import { SceneMedia } from "../../media/SceneMedia";
import { Surface, Text } from "../../primitives";
import { StatsHud } from "../../stats/StatsHud";
import { useAppTheme } from "../../../theme";
import { endingPanelHandlers, type ReaderLayoutProps } from "./types";

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
  onOpenEndings,
  onOpenLibrary,
  onReturnHome,
}: ReaderLayoutProps) {
  const { tokens } = useAppTheme();
  const showHud = hudMode !== "hidden";

  return (
    <View style={{ gap: tokens.spacing.sm, maxWidth: 420, width: "100%" }}>
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

      <SceneMedia media={projection.scene.media} />

      <Surface padded style={{ gap: tokens.spacing.sm }}>
        <Text
          accessibilityLiveRegion={isStreaming ? "polite" : "none"}
          style={{
            fontFamily: tokens.typography.families.serif,
          }}
          variant="body"
        >
          {streamedProse}
        </Text>
      </Surface>

      {projection.ending ? (
        <EndingPanel
          ending={projection.ending}
          {...endingPanelHandlers({ onOpenEndings, onOpenLibrary, onReturnHome })}
        />
      ) : (
        <ChoiceList
          choices={projection.choices}
          disabled={isStreaming}
          onChoose={onChoose}
          pendingChoiceId={pendingChoiceId}
        />
      )}

      {showHud ? (
        <View style={{ paddingTop: tokens.spacing.xs }}>
          <StatsHud
            inventory={projection.inventory}
            mode="quiet"
            stats={projection.stats}
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
