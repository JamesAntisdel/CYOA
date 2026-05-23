import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import type { StreamingScene } from "../../hooks/useStreamingScene";
import { useMediaPreferences } from "../../hooks/useMediaPreferences";
import { useNarratorLoading } from "../../hooks/useNarratorLoading";
import { useNarratorPlayback } from "../../hooks/useNarratorPlayback";
import { AmbientSoundscape } from "./AmbientSoundscape";
import { MediaPlate } from "./MediaPlate";
import { NarratorControl } from "./NarratorControl";
import { useAppTheme } from "../../theme";

type SceneMediaProps = {
  media: StreamingScene["media"];
  /**
   * Stable id of the scene the media belongs to. When supplied, the narrator
   * loading-pip inference resets across scene transitions. When omitted,
   * the narrator field's own identity is used as a fallback signal.
   */
  sceneId?: string;
  muted?: boolean;
  appActive?: boolean;
  reducedMotion?: boolean;
  /**
   * When false, suppresses the MediaPlate (image illustration) — useful on
   * slow mobile connections. Backend asset queueing is unaffected; flipping
   * back to true brings the plate in immediately. Defaults to true.
   */
  imagesEnabled?: boolean;
  /**
   * When false, suppresses narrator TTS playback, the NarratorControl
   * chrome, AND the AmbientSoundscape audio layers. Independent of the
   * `muted` prop (which only affects volume). Defaults to true.
   */
  audioEnabled?: boolean;
};

/**
 * SceneMedia is now a thin orchestrator:
 *
 *   - <AmbientSoundscape />  drives the audio ride-along (Audio agent owns).
 *   - <MediaPlate />         renders the four-state visual plate (task 28).
 *
 * Public surface is preserved so callers in components/reading/* keep working.
 */
export function SceneMedia({
  appActive,
  audioEnabled = true,
  imagesEnabled = true,
  media,
  muted,
  reducedMotion,
  sceneId,
}: SceneMediaProps) {
  const preferences = useMediaPreferences();
  const { tokens } = useAppTheme();
  const resolvedReducedMotion = reducedMotion ?? preferences.reducedMotion;
  // Mute when ANY signal asks for it: caller override, user mute, OR
  // native-background. `??` would short-circuit on the first defined
  // boolean (preferences.muted is always boolean), leaving the
  // nativeBackground branch unreachable.
  const resolvedMuted = (muted ?? preferences.muted) || preferences.nativeBackground;
  const resolvedAppActive = appActive ?? preferences.appActive;

  // Narrator pause is a per-scene preference — when the scene id changes
  // (new prose), reset to playing so the next clip auto-starts.
  const [narratorPaused, setNarratorPaused] = useState(false);
  // Use the narrator field's identity as a fallback when the caller did
  // not supply sceneId; both reset the pause state when narration crosses
  // a real boundary.
  const narratorIdentity = sceneId ?? media?.narrator?.id;
  useEffect(() => {
    setNarratorPaused(false);
  }, [narratorIdentity]);
  const onTogglePaused = useCallback(() => {
    setNarratorPaused((prev) => !prev);
  }, []);

  // Loading inference must run unconditionally to keep hook order stable
  // across the early-return branches below.
  const narratorLoading = useNarratorLoading({
    sceneId: sceneId ?? media?.narrator?.id,
    narratorPresent: Boolean(media?.narrator),
  });

  // Narrator playback owns its own HTMLAudio element so the visible
  // chrome (NarratorControl) can render a scrub bar with currentTime /
  // duration and seek through TTS playback. AudioMix no longer mounts a
  // narrator element of its own; it only consumes the ducking input.
  //
  // `volume` is held at 1 — the narrator never ducks, and the pause /
  // mute gates are applied inside the hook itself.
  //
  // When `audioEnabled` is false we pass `uri: undefined` so the hook's
  // own tear-down branch fires (see useNarratorPlayback effect 1's
  // `if (!uri)` path), releasing any previously mounted HTMLAudio. This
  // keeps the audio-off gate independent of mute (volume=0) — flipping
  // the toggle off actually stops the network fetch and frees the
  // element, not just silences it.
  const narratorPlayback = useNarratorPlayback({
    uri: audioEnabled ? media?.narrator?.uri : undefined,
    paused: narratorPaused,
    muted: resolvedMuted,
    volume: 1,
  });

  // Audio-only scenes with a ready narrator clip should still render the
  // audio layers even if `media.status === "idle"` for the visual plate.
  // We only short-circuit on idle when there is no narrator to play, since
  // the narrator slot is what makes the page audibly "alive" once TTS is
  // ready (visual media may still be queued).
  if (!media) return null;
  // When audio is disabled by the user, "audio-only" scenes have nothing
  // to render. Treat the narrator loading/ready state as absent for the
  // idle short-circuit too — otherwise we'd render an empty fragment.
  const effectiveNarratorLoading = audioEnabled ? narratorLoading : false;
  const effectiveHasNarrator = audioEnabled && Boolean(media.narrator);
  if (media.status === "idle" && !effectiveHasNarrator && !effectiveNarratorLoading) return null;

  const ambient = audioEnabled ? (
    <AmbientSoundscape
      appActive={resolvedAppActive}
      loop={media.ambient}
      // Narrator is forwarded straight through to AudioMix's priority-1 slot.
      // Backend sets this only when Google Cloud TTS has finished generating
      // the clip for the save's pinned voiceId — until then narrator is
      // undefined and AudioMix simply doesn't mount the narrator layer.
      narrator={media.narrator}
      narratorPaused={narratorPaused}
      muted={resolvedMuted}
      reducedMotion={resolvedReducedMotion}
    />
  ) : null;

  // Loading pip + pause/resume control. The control hides itself entirely
  // when there is neither a loading state nor a ready narrator clip, so
  // scenes without narration don't grow any new chrome.
  //
  // When `audioEnabled` is false the control is suppressed too — there is
  // nothing for the user to pause / scrub, and showing a stale pip would
  // be confusing.
  const narratorControl = audioEnabled ? (
    <View style={{ paddingTop: tokens.spacing.xs }}>
      <NarratorControl
        hasNarrator={Boolean(media.narrator)}
        loading={narratorLoading}
        paused={narratorPaused}
        onTogglePaused={onTogglePaused}
        currentTime={narratorPlayback.currentTime}
        duration={narratorPlayback.duration}
        onSeek={narratorPlayback.seek}
      />
    </View>
  ) : null;

  // Audio-only scenes don't render a visual plate — just the audio mix
  // and the narrator control (so users can still pause TTS when only
  // ambient + narrator are in play). When audio is disabled there is
  // nothing to show for these scenes; render null so callers don't see
  // an empty fragment.
  if (media.kind === "audio") {
    if (!audioEnabled) return null;
    return (
      <>
        {ambient}
        {narratorControl}
      </>
    );
  }

  return (
    <>
      {ambient}
      {imagesEnabled ? <MediaPlate media={media} reducedMotion={resolvedReducedMotion} /> : null}
      {narratorControl}
    </>
  );
}
