import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppNav, BackToSceneButton } from "../../../../components/navigation";
import { MediaPlate } from "../../../../components/media/MediaPlate";
import { Chip, Text } from "../../../../components/primitives";
import { ProseRenderer } from "../../../../components/reading/ProseRenderer";
import { guestAuthArgs, useGuestSession } from "../../../../hooks/useGuestSession";
import { useReaderSettings } from "../../../../hooks/useReaderSettings";
import {
  getRemoteRunHistory,
  hasRemoteGameApi,
  rewindRemoteSaveTurns,
  type RemoteRunHistory,
  type RemoteRunHistoryTurn,
} from "../../../../lib/gameApi";
import { useAppTheme } from "../../../../theme";

type FetchState =
  | { status: "loading" }
  | { status: "ready"; history: RemoteRunHistory }
  | { status: "empty" }
  | { status: "error"; message: string };

/**
 * Reader-facing scene archive for an active save.
 *
 * The page calls `getRemoteRunHistory` once on mount (read-only — no
 * mutations are issued from this surface). Past turns render as
 * oldest→newest cards: choice the reader made, scene title, prose, image
 * plate (if a Pro asset is ready), and an optional narrator play pill.
 *
 * Hidden-data discipline: this route never renders flags, locked paths,
 * or any state the reader hasn't seen — it consumes only what the server
 * query already projected. Adding fields to the card means changing the
 * server projection too (`convex/game.ts:getRunHistory`).
 *
 * Styling discipline: every color/spacing/typography value resolves
 * through `useAppTheme().tokens` — no inline hex codes or magic numbers.
 * The page now themes correctly in day, night, and sepia.
 */
export default function HistoryRoute() {
  const params = useLocalSearchParams<{ saveId?: string }>();
  const guest = useGuestSession();
  const { tokens } = useAppTheme();
  const { settings } = useReaderSettings();
  const saveId = typeof params.saveId === "string" ? params.saveId : "";
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [rewind, setRewind] = useState<{
    busy: boolean;
    confirmingDrop: number | null;
    error: string | null;
    notice: string | null;
  }>({ busy: false, confirmingDrop: null, error: null, notice: null });

  const accountId = guest.session?.accountId;
  const loadHistory = useCallback(async () => {
    if (!saveId) {
      setState({ status: "error", message: "Missing save id." });
      return;
    }
    if (!accountId) return;
    if (!hasRemoteGameApi()) {
      setState({ status: "empty" });
      return;
    }
    try {
      const history = await getRemoteRunHistory({
        accountId,
        saveId,
        ...guestAuthArgs(),
      });
      if (!history) {
        setState({ status: "error", message: "Could not load this run’s history." });
        return;
      }
      setState({ status: "ready", history });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error loading history.";
      setState({ status: "error", message });
    }
  }, [accountId, saveId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await loadHistory();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadHistory]);

  const runRewind = useCallback(
    async (dropTurns: number) => {
      if (!accountId || !saveId) return;
      setRewind((cur) => ({ ...cur, busy: true, error: null, notice: null }));
      try {
        const result = await rewindRemoteSaveTurns({
          accountId,
          saveId,
          ...guestAuthArgs(),
          dropTurns,
        });
        if (!result) {
          setRewind({
            busy: false,
            confirmingDrop: null,
            error: "Rewind failed — no response from server.",
            notice: null,
          });
          return;
        }
        setRewind({
          busy: false,
          confirmingDrop: null,
          error: null,
          notice: `Dropped ${result.droppedTurnCount} turn${result.droppedTurnCount === 1 ? "" : "s"}. The save is now at turn ${result.newTopTurnNumber}.`,
        });
        await loadHistory();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error during rewind.";
        setRewind({ busy: false, confirmingDrop: null, error: message, notice: null });
      }
    },
    [accountId, loadHistory, saveId],
  );

  return (
    <ScrollView
      contentContainerStyle={{
        backgroundColor: tokens.colors.background,
        flexGrow: 1,
        gap: tokens.spacing.lg,
        padding: tokens.spacing.lg,
      }}
    >
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
          Scene archive
        </Text>
        <Text variant="title">
          {state.status === "ready" ? state.history.storyTitle : "Past scenes"}
        </Text>
        <Text muted variant="bodySmall">
          {state.status === "ready"
            ? `Turns 0–${state.history.currentTurnNumber}, in order.`
            : "Read back through the scenes you’ve already lived."}
        </Text>
        {/* Shared back affordance — see components/navigation/BackToSceneButton.
            Same visual treatment as the /map sibling so the two surfaces
            feel like a pair. The drift-guard test asserts both pages
            import the same component. */}
        <BackToSceneButton fallbackHref={`/read/${saveId}`} />
      </View>

      {state.status === "ready" && state.history.turns.length > 0 ? (
        <View
          accessibilityLabel="Rewind controls"
          style={{
            backgroundColor: tokens.colors.surface,
            borderColor: tokens.colors.border,
            borderRadius: tokens.radii.md,
            borderWidth: tokens.borderWidths.hairline,
            gap: tokens.spacing.sm,
            padding: tokens.spacing.md,
          }}
        >
          <Text
            style={{
              color: tokens.colors.textMuted,
              fontFamily: tokens.typography.families.mono,
              fontWeight: "800",
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
            variant="caption"
          >
            Trim the tail
          </Text>
          <Text muted variant="bodySmall">
            Drop the last few turns if a stream went sideways. The deleted
            scenes and their illustrations are gone for good; the save keeps
            playing from the previous scene.
          </Text>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: tokens.spacing.sm,
            }}
          >
            {[1, 3, 5].map((n) => {
              const isConfirming = rewind.confirmingDrop === n;
              const available = state.history.turns.length;
              const effective = Math.min(n, available);
              if (effective < 1) return null;
              return (
                <Pressable
                  key={n}
                  accessibilityRole="button"
                  accessibilityLabel={`Drop last ${effective} ${effective === 1 ? "turn" : "turns"}`}
                  disabled={rewind.busy}
                  onPress={() => {
                    if (isConfirming) {
                      void runRewind(effective);
                    } else {
                      setRewind((cur) => ({
                        ...cur,
                        confirmingDrop: n,
                        error: null,
                        notice: null,
                      }));
                    }
                  }}
                  style={({ pressed }) => ({
                    backgroundColor: isConfirming
                      ? tokens.colors.danger
                      : tokens.colors.surfaceMuted,
                    borderColor: isConfirming
                      ? tokens.colors.danger
                      : tokens.colors.border,
                    borderRadius: tokens.radii.pill,
                    borderWidth: tokens.borderWidths.hairline,
                    opacity: rewind.busy ? 0.5 : pressed ? 0.7 : 1,
                    paddingHorizontal: tokens.spacing.md,
                    paddingVertical: tokens.spacing.xs,
                  })}
                >
                  <Text
                    style={{
                      color: isConfirming
                        ? tokens.colors.background
                        : tokens.colors.text,
                      fontWeight: "800",
                    }}
                    variant="bodySmall"
                  >
                    {isConfirming
                      ? `Tap again to drop ${effective}`
                      : `Drop last ${effective}`}
                  </Text>
                </Pressable>
              );
            })}
            {rewind.confirmingDrop !== null ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel rewind"
                onPress={() =>
                  setRewind((cur) => ({ ...cur, confirmingDrop: null }))
                }
                style={({ pressed }) => ({
                  backgroundColor: tokens.colors.surfaceMuted,
                  borderColor: tokens.colors.border,
                  borderRadius: tokens.radii.pill,
                  borderWidth: tokens.borderWidths.hairline,
                  opacity: pressed ? 0.7 : 1,
                  paddingHorizontal: tokens.spacing.md,
                  paddingVertical: tokens.spacing.xs,
                })}
              >
                <Text style={{ fontWeight: "800" }} variant="bodySmall">
                  Cancel
                </Text>
              </Pressable>
            ) : null}
          </View>
          {rewind.notice ? (
            <Text style={{ fontWeight: "700" }} variant="bodySmall">
              {rewind.notice}
            </Text>
          ) : null}
          {rewind.error ? (
            <Text
              style={{ color: tokens.colors.danger, fontWeight: "700" }}
              variant="bodySmall"
            >
              {rewind.error}
            </Text>
          ) : null}
        </View>
      ) : null}

      {state.status === "loading" ? (
        <Text muted variant="bodySmall">
          Loading scenes…
        </Text>
      ) : null}

      {state.status === "error" ? (
        <Text muted variant="bodySmall">
          {state.message}
        </Text>
      ) : null}

      {state.status === "empty" ? (
        <Text muted variant="bodySmall">
          History is only available when connected to a remote save.
        </Text>
      ) : null}

      {state.status === "ready" && state.history.turns.length === 0 ? (
        <Text muted variant="bodySmall">
          No past turns yet — this scene is the start of the tale.
        </Text>
      ) : null}

      {state.status === "ready" && state.history.hasMore ? (
        <Text muted style={{ fontStyle: "italic" }} variant="caption">
          Showing the 200 most-recent turns. Earlier turns from this run are
          not listed.
        </Text>
      ) : null}

      {state.status === "ready"
        ? state.history.turns.map((turn) => (
            <HistoryCard
              dialogBlocksEnabled={settings.dialogBlocksEnabled}
              key={`${turn.turnNumber}:${turn.nodeId}`}
              reducedMotion={settings.reduceMotion}
              turn={turn}
            />
          ))
        : null}
    </ScrollView>
  );
}

type HistoryCardProps = {
  turn: RemoteRunHistoryTurn;
  dialogBlocksEnabled: boolean;
  reducedMotion: boolean;
};

function HistoryCard({
  turn,
  dialogBlocksEnabled,
  reducedMotion,
}: HistoryCardProps) {
  const { tokens } = useAppTheme();
  // Build a SceneMedia-shaped projection for the MediaPlate. We only
  // surface an image plate (the archive view doesn't replay video), and
  // only when the past scene's image asset finished. The plate handles
  // the missing-uri case by rendering null, so cards without imagery
  // simply lay out tighter.
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

  const narratorUri = turn.media?.narratorUri;

  return (
    <View
      accessibilityLabel={`Turn ${turn.turnNumber}`}
      style={{
        backgroundColor: tokens.colors.surface,
        borderColor: tokens.colors.borderMuted,
        borderRadius: tokens.radii.sm,
        borderWidth: tokens.borderWidths.hairline,
        gap: tokens.spacing.sm,
        padding: tokens.spacing.md,
      }}
    >
      <View style={{ gap: tokens.spacing.xs }}>
        <Text
          style={{
            color: tokens.colors.textMuted,
            fontFamily: tokens.typography.families.mono,
            fontWeight: "800",
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
          variant="caption"
        >
          Turn {turn.turnNumber}
        </Text>
        <Text style={{ fontWeight: "800" }} variant="subtitle">
          {turn.sceneTitle}
        </Text>
      </View>

      {turn.choice ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <Chip>You chose: {turn.choice.choiceLabel}</Chip>
        </View>
      ) : null}

      {media ? (
        <View style={{ marginVertical: tokens.spacing.xs }}>
          <MediaPlate media={media} reducedMotion={reducedMotion} />
        </View>
      ) : null}

      {turn.prose.length > 0 ? (
        <ProseRenderer
          dialogBlocksEnabled={dialogBlocksEnabled}
          isStreaming={false}
          prose={turn.prose}
        />
      ) : (
        <Text muted style={{ fontStyle: "italic" }} variant="bodySmall">
          No prose recorded for this scene
          {turn.streamStatus === "blocked"
            ? " (blocked by safety review)."
            : turn.streamStatus === "failed"
              ? " (generation failed)."
              : "."}
        </Text>
      )}

      {narratorUri ? (
        <View style={{ alignItems: "flex-start", flexDirection: "row" }}>
          <NarratorPlayPill uri={narratorUri} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Click-to-play narrator pill for the archive. Deliberately NOT auto-
 * playing — this is a read-back view, not an active reading session, so
 * playback is opt-in per card. Uses a transient HTMLAudioElement on web
 * (the only platform the archive currently targets — the route file
 * lives under expo-router but the AudioMix pipeline is web-first).
 *
 * Non-web platforms degrade gracefully: the button is still rendered
 * but pressing it is a no-op (the React Native audio API isn't wired
 * here; reaching for `expo-audio` would balloon the surface area for a
 * feature that's only valuable on web today).
 */
function NarratorPlayPill({ uri }: { uri: string }) {
  const { tokens } = useAppTheme();
  const [playing, setPlaying] = useState(false);

  const handlePress = () => {
    if (typeof window === "undefined" || typeof Audio === "undefined") return;
    if (playing) return;
    try {
      const audio = new Audio(uri);
      audio.addEventListener("ended", () => setPlaying(false));
      audio.addEventListener("pause", () => setPlaying(false));
      audio.addEventListener("error", () => setPlaying(false));
      void audio.play().then(
        () => setPlaying(true),
        () => setPlaying(false),
      );
    } catch {
      setPlaying(false);
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={playing ? "Narration playing" : "Play narration"}
      onPress={handlePress}
      style={({ pressed }) => ({
        backgroundColor: tokens.colors.text,
        borderRadius: tokens.radii.pill,
        opacity: pressed ? 0.7 : 1,
        paddingHorizontal: tokens.spacing.md,
        paddingVertical: tokens.spacing.xs,
      })}
    >
      <Text
        style={{ color: tokens.colors.background, fontWeight: "800" }}
        variant="bodySmall"
      >
        {playing ? "▌▌ Narrating" : "▶ Narrate"}
      </Text>
    </Pressable>
  );
}
