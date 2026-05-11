import { ScrollView, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { ChoiceList } from "../../choices/ChoiceList";
import { EndingPanel } from "../../death/EndingPanel";
import { SceneMedia } from "../../media/SceneMedia";
import { Divider, Stamp, Surface, Text } from "../../primitives";
import { StatsHud } from "../../stats/StatsHud";
import { useStreamingScene } from "../../../hooks/useStreamingScene";
import { useTurn } from "../../../hooks/useTurn";
import { useAppTheme } from "../../../theme";

type MobileReaderLayoutProps = {
  saveId: string;
};

/**
 * Mobile-tuned reading layout. Matches the canvas W.MobileBoard pattern:
 *  - phone-first chrome with a single column and reduced horizontal gutter
 *  - thumb-reachable choices anchored to a sticky bottom area inside the
 *    safe-area inset (≥44pt tap targets through the Choice primitive)
 *  - scrollable scene/prose area above so the reader can swipe and still
 *    reach choices without thumb gymnastics on tall phones
 *
 * The signature mirrors ReaderScreen — a Mobile dispatcher can swap to
 * this component without changing the route.
 */
export function MobileReaderLayout({ saveId }: MobileReaderLayoutProps) {
  const { tokens } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { pendingChoiceId, projection, submitChoice } = useTurn(saveId);
  const { isStreaming, streamedProse } = useStreamingScene(projection.scene);

  const horizontalGutter = tokens.spacing.md; // tighter than the desktop xl gutter

  return (
    <SafeAreaView
      edges={["top"]}
      style={{ backgroundColor: tokens.colors.background, flex: 1 }}
    >
      <ScrollView
        contentContainerStyle={{
          gap: tokens.spacing.md,
          paddingBottom: tokens.spacing.xl,
          paddingHorizontal: horizontalGutter,
          paddingTop: tokens.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
      >
        <View style={{ gap: tokens.spacing.xs }}>
          <Stamp>{projection.mode}</Stamp>
          <Text variant="title">{projection.storyTitle}</Text>
          <Text muted variant="bodySmall">
            {projection.scene.title}
          </Text>
        </View>

        <SceneMedia media={projection.scene.media} />

        <Surface padded style={{ gap: tokens.spacing.md }}>
          <Text
            variant="body"
            accessibilityLiveRegion={isStreaming ? "polite" : "none"}
          >
            {streamedProse}
          </Text>
          <Divider />
          <StatsHud inventory={projection.inventory} stats={projection.stats} />
        </Surface>

        {projection.ending ? <EndingPanel ending={projection.ending} /> : null}
      </ScrollView>

      {projection.ending ? null : (
        <View
          style={{
            backgroundColor: tokens.colors.background,
            borderTopColor: tokens.colors.borderMuted,
            borderTopWidth: tokens.borderWidths.hairline,
            gap: tokens.spacing.sm,
            // sticky bottom that respects the safe-area inset so choices are
            // never pushed under the home indicator on iOS.
            paddingBottom: Math.max(insets.bottom, tokens.spacing.md),
            paddingHorizontal: horizontalGutter,
            paddingTop: tokens.spacing.md,
          }}
        >
          <ChoiceList
            choices={projection.choices}
            disabled={isStreaming}
            onChoose={submitChoice}
            pendingChoiceId={pendingChoiceId}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

export default MobileReaderLayout;
