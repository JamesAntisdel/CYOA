/**
 * AmbientSoundscape — thin wrapper around `AudioMix` that exposes only the
 * library ambient layer. Existing callers (`SceneMedia`, death, library)
 * continue to import this component with the same prop signature; new
 * reader surfaces should use `<AudioMix>` directly and compose every layer.
 *
 * Behavior matches the original pre-task-39 contract:
 *   - plays when there is a loop, the app is active, and neither user mute
 *     nor reduced motion is set
 *   - reduced motion gates ambient (mirrors `ambientPlaybackAllowed` in
 *     `convex/media/audio.ts` — the backend treats reduced motion as an
 *     ambient block too, not just a video-audio block)
 *
 * With no other layers present the AudioMix ducking schedule reduces to
 * "ambient at base volume", so audible output is unchanged.
 */
import type { AmbientLoop } from "../../hooks/useStreamingScene";

import { AudioMix } from "./AudioMix";

type AmbientSoundscapeProps = {
  loop?: AmbientLoop | undefined;
  muted: boolean;
  reducedMotion: boolean;
  appActive: boolean;
};

export function AmbientSoundscape({
  appActive,
  loop,
  muted,
  reducedMotion,
}: AmbientSoundscapeProps) {
  // Fold reducedMotion into the mute gate so the wrapper preserves the
  // historical "no ambient under reduced motion" guarantee even though
  // the AudioMix ducking schedule itself only gates Veo audio on motion.
  return (
    <AudioMix
      ambient={loop}
      muted={muted || reducedMotion}
      reducedMotion={reducedMotion}
      appActive={appActive}
    />
  );
}
