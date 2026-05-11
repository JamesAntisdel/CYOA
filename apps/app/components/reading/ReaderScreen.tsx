import { useRouter } from "expo-router";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ChoiceList } from "../choices/ChoiceList";
import { EndingPanel } from "../death/EndingPanel";
import { SceneMedia } from "../media/SceneMedia";
import { AppNav } from "../navigation";
import { Divider, Stamp, Surface, Text } from "../primitives";
import { StatsHud } from "../stats/StatsHud";
import { useReaderSettings } from "../../hooks/useReaderSettings";
import { useStreamingScene } from "../../hooks/useStreamingScene";
import { useTurn } from "../../hooks/useTurn";
import { useAppTheme } from "../../theme";

type ReaderScreenProps = {
  saveId: string;
};

export function ReaderScreen({ saveId }: ReaderScreenProps) {
  const router = useRouter();
  const { reduceMotion, tokens } = useAppTheme();
  const { settings } = useReaderSettings();
  const { pendingChoiceId, projection, submitChoice } = useTurn(saveId);
  const { isStreaming, streamedProse } = useStreamingScene(projection.scene, {
    reducedMotion: reduceMotion || settings.reduceMotion,
  });
  const maxWidth = settings.layoutMode === "focus" ? 620 : 760;
  const showHud = settings.hudMode !== "hidden";

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          gap: tokens.spacing.lg,
          marginHorizontal: "auto",
          maxWidth,
          padding: tokens.spacing.lg,
          width: "100%",
        }}
      >
        <View style={{ gap: tokens.spacing.xs }}>
          <AppNav />
          <Stamp>{projection.mode}</Stamp>
          <Text variant="title">{projection.storyTitle}</Text>
          <Text muted>{projection.scene.title}</Text>
        </View>

        <SceneMedia media={projection.scene.media} />

        <Surface padded style={{ gap: tokens.spacing.lg }}>
          <Text variant="body" accessibilityLiveRegion={isStreaming ? "polite" : "none"}>
            {streamedProse}
          </Text>
          {showHud ? (
            <>
              <Divider />
              <StatsHud
                inventory={projection.inventory}
                mode={settings.hudMode === "quiet" ? "quiet" : "full"}
                stats={projection.stats}
              />
            </>
          ) : null}
        </Surface>

        {projection.ending ? (
          <EndingPanel
            ending={projection.ending}
            onOpenEndings={() => router.push("/endings")}
            onOpenLibrary={() => router.push("/library")}
            onReturnHome={() => router.push("/")}
          />
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
