import { useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";

import { AppNav, BackToSceneButton } from "../../../../components/navigation";
import { MediaPlate } from "../../../../components/media/MediaPlate";
import { Divider, Text } from "../../../../components/primitives";
import { ProseRenderer } from "../../../../components/reading/ProseRenderer";
import { useGuestSession } from "../../../../hooks/useGuestSession";
import { useReaderSettings } from "../../../../hooks/useReaderSettings";
import { useRunHistory } from "../../../../hooks/useRunHistory";
import { type RemoteRunHistoryTurn } from "../../../../lib/gameApi";
import { useAppTheme } from "../../../../theme";

/**
 * Read-runs-as-books — re-read a run you have LIVED as a clean, paged,
 * choice-free book (reading-modes R2).
 *
 * This route is a pure PRESENTATION surface over the exact same read-back
 * the scene archive uses: it loads through `useRunHistory`
 * (`game:getRunHistory`, owner-authed + entitlement-free — RM9) and issues
 * NO mutation. It is READ-ONLY BY CONSTRUCTION — it never imports the
 * rewind/trim mutation the archive route uses (enforced by
 * `__tests__/bookRoute.test.mjs`), reading is FREE, and it generates
 * nothing (no Imagen/Veo/TTS, no ledger writes — R2.5).
 *
 * Presentation vs the archive:
 *  - prose flows CONTINUOUSLY, chapter after chapter — no per-turn card
 *    chrome, no "Turn N" label, no "You chose:" chip, no rewind controls.
 *  - each scene's inbound choice renders as a subtle italic transition
 *    line ("— you chose to …") derived from `turn.choice.choiceLabel`
 *    (OQ5 default — safer for continuity than dropping it, since each
 *    scene was authored assuming the prior choice), preceded by a thin
 *    scene-break divider.
 *  - typography is lifted from `Book.tsx`'s tokens: a serif display title
 *    and a single generous-gutter column (maxWidth 760).
 *
 * In-progress framing (R2.6): a save that hasn't ended is framed as the
 * tale "so far," never as a finished book. The finished/in-progress fact
 * arrives via the `finished` route param from the entry point (the ending
 * panel and finished-save library rows pass `finished=1`); absent, we take
 * the SAFE default of in-progress framing so an unfinished run is never
 * mis-framed as complete.
 *
 * 200-turn cap (R2.8): when `getRunHistory` truncates a very long run
 * (`hasMore`), we show an explicit "earlier chapters not shown" notice —
 * never a silent omission of the opening.
 */
export default function BookRoute() {
  const params = useLocalSearchParams<{ saveId?: string; finished?: string }>();
  const guest = useGuestSession();
  const { tokens } = useAppTheme();
  const { settings } = useReaderSettings();
  const saveId = typeof params.saveId === "string" ? params.saveId : "";
  // Entry points that know the run is complete (ending panel, finished-save
  // rows) pass `finished=1`; absent ⇒ in-progress "so far" framing (R2.6).
  const finished = params.finished === "1" || params.finished === "true";
  const accountId = guest.session?.accountId;
  const { state } = useRunHistory(accountId, saveId);

  return (
    <ScrollView
      contentContainerStyle={{
        alignItems: "center",
        backgroundColor: tokens.colors.background,
        flexGrow: 1,
        gap: tokens.spacing.lg,
        padding: tokens.spacing.lg,
      }}
    >
      <View style={{ maxWidth: 760, width: "100%", gap: tokens.spacing.lg }}>
        <AppNav current="library" />

        <View style={{ gap: tokens.spacing.sm }}>
          <Text
            style={{
              color: tokens.colors.textMuted,
              fontFamily: tokens.typography.families.mono,
              fontWeight: "800",
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
            variant="caption"
          >
            Read as a book
          </Text>
          <Text
            style={{ fontFamily: tokens.typography.families.serif }}
            variant="title"
          >
            {state.status === "ready" ? state.history.storyTitle : "Your tale"}
          </Text>
          <Text muted style={{ fontStyle: "italic" }} variant="bodySmall">
            {bookSubtitle({ finished, ready: state.status === "ready" })}
          </Text>
          <BackToSceneButton fallbackHref={`/read/${saveId}`} />
        </View>

        {state.status === "loading" ? (
          <Text muted variant="bodySmall">
            Turning to the first page…
          </Text>
        ) : null}

        {state.status === "error" ? (
          <Text muted variant="bodySmall">
            {state.message}
          </Text>
        ) : null}

        {state.status === "empty" ? (
          <Text muted variant="bodySmall">
            Reading as a book is only available when connected to a remote save.
          </Text>
        ) : null}

        {state.status === "ready" && state.history.turns.length === 0 ? (
          <Text muted variant="bodySmall">
            This tale hasn’t been written yet — there are no scenes to read.
          </Text>
        ) : null}

        {/* Cap notice (R2.8): getRunHistory surfaces the 200 most-recent
            turns; when it truncated, say so explicitly rather than silently
            dropping the opening chapters. */}
        {state.status === "ready" && state.history.hasMore ? (
          <Text muted style={{ fontStyle: "italic" }} variant="caption">
            Earlier chapters are not shown — this book begins partway through a
            long run (the 200 most-recent scenes).
          </Text>
        ) : null}

        {state.status === "ready"
          ? state.history.turns.map((turn, index) => (
              <BookChapter
                dialogBlocksEnabled={settings.dialogBlocksEnabled}
                isFirst={index === 0}
                key={`${turn.turnNumber}:${turn.nodeId}`}
                reducedMotion={settings.reduceMotion}
                turn={turn}
              />
            ))
          : null}
      </View>
    </ScrollView>
  );
}

/**
 * Book-voiced subtitle. In-progress runs read "so far"; finished runs read
 * as a complete tale (R2.6). Pure — mirrored in the route test.
 */
export function bookSubtitle(input: { finished: boolean; ready: boolean }): string {
  if (!input.ready) return "Read your run back as one continuous tale.";
  return input.finished
    ? "The tale, read start to finish."
    : "Your tale so far — read back as one continuous story.";
}

/**
 * The subtle italic transition line for a chapter's inbound choice (OQ5
 * default). Returns null for the opening turn (no inbound choice) or when
 * the label is empty. Pure — mirrored in the route test.
 */
export function chapterTransition(turn: RemoteRunHistoryTurn): string | null {
  const label = turn.choice?.choiceLabel?.trim();
  if (!label) return null;
  return `— you chose to ${label}`;
}

type BookChapterProps = {
  turn: RemoteRunHistoryTurn;
  isFirst: boolean;
  dialogBlocksEnabled: boolean;
  reducedMotion: boolean;
};

/**
 * One chapter of the book: a thin scene-break divider + subtle italic
 * transition line (for turns with an inbound choice), an optional inline
 * still, then the scene prose flowing continuously. Deliberately NO card
 * frame, NO "Turn N" label, NO "You chose:" chip, NO rewind controls.
 */
function BookChapter({
  turn,
  isFirst,
  dialogBlocksEnabled,
  reducedMotion,
}: BookChapterProps) {
  const { tokens } = useAppTheme();

  // Same ready-only image-plate projection the archive uses; narrator audio
  // and video are intentionally omitted — this is a silent, paged read.
  const imageUri = turn.media?.imageUri;
  const media = imageUri
    ? ({
        status: "ready" as const,
        kind: "image" as const,
        uri: imageUri,
        imageUri,
        alt: `Illustration for ${turn.sceneTitle}`,
      } as const)
    : undefined;

  const transition = chapterTransition(turn);

  return (
    <View style={{ gap: tokens.spacing.md }}>
      {!isFirst ? (
        <View style={{ gap: tokens.spacing.sm }}>
          <Divider />
          {transition ? (
            <Text
              muted
              style={{ fontStyle: "italic", textAlign: "center" }}
              variant="bodySmall"
            >
              {transition}
            </Text>
          ) : null}
        </View>
      ) : null}

      {media ? (
        <MediaPlate media={media} reducedMotion={reducedMotion} />
      ) : null}

      {turn.prose.length > 0 ? (
        <ProseRenderer
          dialogBlocksEnabled={dialogBlocksEnabled}
          isStreaming={false}
          prose={turn.prose}
        />
      ) : (
        <Text muted style={{ fontStyle: "italic" }} variant="bodySmall">
          {turn.streamStatus === "blocked"
            ? "(This scene was withheld by safety review.)"
            : turn.streamStatus === "failed"
              ? "(This scene failed to generate.)"
              : "(This scene has no prose recorded.)"}
        </Text>
      )}
    </View>
  );
}
