/**
 * AmbientSoundscape — thin wrapper around `AudioMix` that exposes the
 * library ambient layer plus an optional narrator pass-through. Existing
 * callers (`SceneMedia`, death, library) continue to import this component
 * with the same prop signature; new reader surfaces should use `<AudioMix>`
 * directly and compose every layer.
 *
 * Behavior matches the original pre-task-39 contract:
 *   - plays when there is a loop, the app is active, and neither user mute
 *     nor reduced motion is set
 *   - reduced motion gates ambient (mirrors `ambientPlaybackAllowed` in
 *     `convex/media/audio.ts` — the backend treats reduced motion as an
 *     ambient block too, not just a video-audio block)
 *
 * Narrator (when supplied) is forwarded straight into AudioMix's priority-1
 * slot and is gated only by the global muted/appActive flags inside
 * AudioMix — reduced motion does NOT silence narration (TTS is accessibility-
 * positive, not motion-driven).
 *
 * With no other layers present the AudioMix ducking schedule reduces to
 * "ambient at base volume", so audible output is unchanged when no narrator
 * is attached.
 */
import type { AmbientLoop, NarratorClip } from "../../hooks/useStreamingScene";

import { AudioMix } from "./AudioMix";

/** Base volume for the narrator layer before ducking. Narrator never ducks. */
const NARRATOR_BASE_VOLUME = 1;

type AmbientSoundscapeProps = {
  loop?: AmbientLoop | undefined;
  /**
   * Narrator TTS clip for the current scene's prose. When supplied the
   * underlying AudioMix mounts a narrator audio element and plays it at
   * priority 1 (never ducked). Absent → the narrator layer stays inactive.
   */
  narrator?: NarratorClip | undefined;
  /**
   * User-driven pause for the narrator layer. When true the narrator
   * source is still mounted (so HTMLAudio retains `currentTime` for a
   * smooth resume) but its `active` flag is forced false in the ducking
   * schedule. Defaults to false.
   */
  narratorPaused?: boolean;
  muted: boolean;
  reducedMotion: boolean;
  appActive: boolean;
};

export function AmbientSoundscape({
  appActive,
  loop,
  narrator,
  narratorPaused = false,
  muted,
  reducedMotion,
}: AmbientSoundscapeProps) {
  // Build the narrator AudioSource shape inline. We only pass the prop
  // when narrator is defined so AudioMix sees `undefined` rather than a
  // half-populated source — useAudioMix.computeMix treats `undefined`
  // narrator as "no narrator layer", which is the desired fallback when
  // TTS is disabled or the asset is not yet ready.
  //
  // Pause gate: when the user has paused narration we drop the source
  // volume to 0. computeMix derives `active = clamped > 0`, so volume 0
  // yields `narrator.active = false`. `useLayerPlayback` then calls
  // `audio.pause()` on the underlying HTMLAudio element while leaving
  // the element mounted at the same URI — HTMLAudio preserves
  // `currentTime` across pause, so toggling back to volume 1 (active
  // again) resumes from the same offset. We also flip the
  // `narratorActive` ducking flag to false so the lower layers
  // (music/ambient) rise back to full volume while paused.
  const narratorBaseVolume = narratorPaused ? 0 : NARRATOR_BASE_VOLUME;
  const narratorSource = narrator
    ? { id: narrator.id, uri: narrator.uri, volume: narratorBaseVolume, loop: false }
    : undefined;

  // Reduced motion silences the ambient layer (historical contract: see
  // `ambientPlaybackAllowed` in convex/media/audio.ts). When a narrator is
  // also attached we can't apply that gate globally — the user opted into
  // narration and reduced-motion is a motion-accessibility flag, not an
  // audio one. So we strip the ambient source instead of muting the mix.
  const ambientLoop = reducedMotion ? undefined : loop;

  // narratorActive controls downstream ducking. When the user has paused
  // narration we also want music/ambient to un-duck, so flip this false
  // in lockstep with the volume drop.
  const narratorActive = narratorSource ? !narratorPaused : false;

  return (
    <AudioMix
      ambient={ambientLoop}
      {...(narratorSource ? { narrator: narratorSource, narratorActive } : {})}
      muted={muted}
      reducedMotion={reducedMotion}
      appActive={appActive}
    />
  );
}
