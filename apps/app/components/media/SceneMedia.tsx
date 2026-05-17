import type { StreamingScene } from "../../hooks/useStreamingScene";
import { useMediaPreferences } from "../../hooks/useMediaPreferences";
import { AmbientSoundscape } from "./AmbientSoundscape";
import { MediaPlate } from "./MediaPlate";

type SceneMediaProps = {
  media: StreamingScene["media"];
  muted?: boolean;
  appActive?: boolean;
  reducedMotion?: boolean;
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
  media,
  muted,
  reducedMotion,
}: SceneMediaProps) {
  const preferences = useMediaPreferences();
  const resolvedReducedMotion = reducedMotion ?? preferences.reducedMotion;
  // Mute when ANY signal asks for it: caller override, user mute, OR
  // native-background. `??` would short-circuit on the first defined
  // boolean (preferences.muted is always boolean), leaving the
  // nativeBackground branch unreachable.
  const resolvedMuted = (muted ?? preferences.muted) || preferences.nativeBackground;
  const resolvedAppActive = appActive ?? preferences.appActive;

  // Audio-only scenes with a ready narrator clip should still render the
  // audio layers even if `media.status === "idle"` for the visual plate.
  // We only short-circuit on idle when there is no narrator to play, since
  // the narrator slot is what makes the page audibly "alive" once TTS is
  // ready (visual media may still be queued).
  if (!media) return null;
  if (media.status === "idle" && !media.narrator) return null;

  const ambient = (
    <AmbientSoundscape
      appActive={resolvedAppActive}
      loop={media.ambient}
      // Narrator is forwarded straight through to AudioMix's priority-1 slot.
      // Backend sets this only when Google Cloud TTS has finished generating
      // the clip for the save's pinned voiceId — until then narrator is
      // undefined and AudioMix simply doesn't mount the narrator layer.
      narrator={media.narrator}
      muted={resolvedMuted}
      reducedMotion={resolvedReducedMotion}
    />
  );

  // Audio-only scenes don't render a visual plate — just the audio mix.
  if (media.kind === "audio") return ambient;

  return (
    <>
      {ambient}
      <MediaPlate media={media} reducedMotion={resolvedReducedMotion} />
    </>
  );
}
