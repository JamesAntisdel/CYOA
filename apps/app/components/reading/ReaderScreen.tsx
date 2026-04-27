import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ChoiceList } from "../choices/ChoiceList";
import { EndingPanel } from "../death/EndingPanel";
import { SceneMedia } from "../media/SceneMedia";
import { Divider, Stamp, Surface, Text } from "../primitives";
import { StatsHud } from "../stats/StatsHud";
import { useStreamingScene } from "../../hooks/useStreamingScene";
import { useTurn } from "../../hooks/useTurn";
import { useAppTheme } from "../../theme";

type ReaderScreenProps = {
  saveId: string;
};

export function ReaderScreen({ saveId }: ReaderScreenProps) {
  const { tokens } = useAppTheme();
  const { pendingChoiceId, projection, submitChoice } = useTurn(saveId);
  const { isStreaming, streamedProse } = useStreamingScene(projection.scene);

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          gap: tokens.spacing.lg,
          marginHorizontal: "auto",
          maxWidth: 760,
          padding: tokens.spacing.lg,
          width: "100%",
        }}
      >
        <View style={{ gap: tokens.spacing.xs }}>
          <Stamp>{projection.mode}</Stamp>
          <Text variant="title">{projection.storyTitle}</Text>
          <Text muted>{projection.scene.title}</Text>
        </View>

        <SceneMedia media={projection.scene.media} />

        <Surface padded style={{ gap: tokens.spacing.lg }}>
          <Text variant="body" accessibilityLiveRegion={isStreaming ? "polite" : "none"}>
            {streamedProse}
          </Text>
          <Divider />
          <StatsHud inventory={projection.inventory} stats={projection.stats} />
        </Surface>

        {projection.ending ? (
          <EndingPanel ending={projection.ending} />
        ) : (
          <ChoiceList
            choices={projection.choices}
            disabled={isStreaming}
            onChoose={submitChoice}
            pendingChoiceId={pendingChoiceId}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
