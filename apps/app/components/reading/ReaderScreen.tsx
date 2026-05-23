import { useRouter } from "expo-router";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppNav } from "../navigation";
import { useAccountProfile } from "../../hooks/useAccountProfile";
import { useReaderSettings } from "../../hooks/useReaderSettings";
import { guestAuthArgs, useGuestSession } from "../../hooks/useGuestSession";
import { useSceneMedia } from "../../hooks/useSceneMedia";
import { useStreamingScene } from "../../hooks/useStreamingScene";
import { useTurn } from "../../hooks/useTurn";
import { PATRON_TIERS_BY_ID, resolvePatronTier } from "../../lib/billingConfig";
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
    submitFreeformChoice,
    supportsFreeform,
    freeformPending,
    freeformError,
    chapterBoundary,
    acknowledgeChapter,
  } = useTurn(saveId);
  const { isStreaming, streamedProse } = useStreamingScene(projection.scene, {
    reducedMotion: reduceMotion || settings.reduceMotion,
  });

  // Live Pro-media projection. Polls the Convex assets table for an Imagen
  // job tied to the active scene. When ready, replaces the projection's
  // media field so MediaPlate can advance from Skeleton → Image. Falls
  // through to whatever the projection already carries when no remote
  // backend is wired (in-memory tutorial).
  const guest = useGuestSession();
  const liveMedia = useSceneMedia(
    saveId,
    guest.session
      ? { accountId: guest.session.accountId, ...guestAuthArgs() }
      : undefined,
    // Pass scene id so polling resets when the user advances to a new
    // scene — otherwise we'd sit on the previous scene's settled backoff
    // (up to 60s) and the new scene's queued media wouldn't surface.
    projection.scene.id,
  );
  const projectionWithLiveMedia = liveMedia
    ? { ...projection, scene: { ...projection.scene, media: liveMedia } }
    : projection;

  // Resolve the death-variant props the layouts forward to <EndingPanel>.
  //  - tier: derived from useAccountProfile so the Cinematic gate matches
  //    the live entitlement.
  //  - cinematicUri: only set when useSceneMedia has a ready video asset —
  //    Cinematic falls back to Brutal when the URI is absent.
  //  - isFirstFind: TODO(Wave E) — real lookup against `endings_unlocked`.
  //    Until then pass `true` so eligible tier+asset reads can still fire
  //    Cinematic in QA without re-playing on the wrong account.
  const { profile } = useAccountProfile();
  const endingTier = profile
    ? resolvePatronTier({
        entitlement: profile.entitlementTier,
        isClaimed: profile.kind !== "guest",
      })
    : PATRON_TIERS_BY_ID.wanderer;
  const cinematicUri =
    liveMedia && liveMedia.kind === "video" && liveMedia.status === "ready" && liveMedia.uri
      ? liveMedia.uri
      : undefined;
  const endingIsFirstFind = true;

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
            projection={projectionWithLiveMedia}
            reducedMotion={reduceMotion || settings.reduceMotion}
            streamedProse={streamedProse}
            endingTier={endingTier}
            {...(cinematicUri ? { cinematicUri } : {})}
            endingIsFirstFind={endingIsFirstFind}
            // Per-user media gates — see settings → "Reader preferences".
            // Backend asset queueing is unaffected; these only suppress
            // rendering on the client so toggling back on lights up the
            // already-queued assets immediately.
            imagesEnabled={settings.imagesEnabled}
            audioEnabled={settings.audioEnabled}
            videoEnabled={settings.videoEnabled}
            // Free-form ("Option D") affordance. Only wired for remote
            // LLM-driven saves — supportsFreeform is false for scripted /
            // tutorial saves, where omitting the callback keeps ChoiceList
            // on its previous 3-choices-only render.
            {...(supportsFreeform ? { onFreeformSubmit: submitFreeformChoice } : {})}
            freeformPending={freeformPending}
            freeformError={freeformError}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
