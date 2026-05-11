import { useRouter } from "expo-router";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppNav } from "../navigation";
import { useReaderSettings } from "../../hooks/useReaderSettings";
import { useStreamingScene } from "../../hooks/useStreamingScene";
import { useTurn } from "../../hooks/useTurn";
import { useAppTheme } from "../../theme";
import { ChapterEnd } from "./ChapterEnd";
import { READER_LAYOUTS } from "./layouts";

type ReaderScreenProps = {
  saveId: string;
};

/**
 * ReaderScreen is now a thin shell: it owns the scene-state pipeline (useTurn
 * + useStreamingScene) and dispatches on the user's persisted layout setting.
 * All five layouts under `./layouts` receive the same projection, so a single
 * setting change re-renders the chrome without touching turn state.
 */
export function ReaderScreen({ saveId }: ReaderScreenProps) {
  const router = useRouter();
  const { reduceMotion, tokens } = useAppTheme();
  const { settings } = useReaderSettings();
  const {
    pendingChoiceId,
    projection,
    submitChoice,
    chapterBoundary,
    acknowledgeChapter,
  } = useTurn(saveId);
  const { isStreaming, streamedProse } = useStreamingScene(projection.scene, {
    reducedMotion: reduceMotion || settings.reduceMotion,
  });

  const Layout = READER_LAYOUTS[settings.layout] ?? READER_LAYOUTS.book;

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          alignItems: "center",
          gap: tokens.spacing.lg,
          padding: tokens.spacing.lg,
          width: "100%",
        }}
      >
        <View style={{ alignSelf: "stretch" }}>
          <AppNav />
        </View>
        {chapterBoundary ? (
          <ChapterEnd
            chapterIndex={chapterBoundary.index}
            entries={chapterBoundary.entries}
            nextChapterHint={projection.scene.title}
            onContinue={acknowledgeChapter}
            onSaveAndClose={() => router.push("/library")}
            storyTitle={projection.storyTitle}
          />
        ) : (
          <Layout
            hudMode={settings.hudMode}
            isStreaming={isStreaming}
            onChoose={submitChoice}
            onOpenEndings={() => router.push("/endings")}
            onOpenLibrary={() => router.push("/library")}
            onReturnHome={() => router.push("/")}
            pendingChoiceId={pendingChoiceId}
            projection={projection}
            reducedMotion={reduceMotion || settings.reduceMotion}
            streamedProse={streamedProse}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
