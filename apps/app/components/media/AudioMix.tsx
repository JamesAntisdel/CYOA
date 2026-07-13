/**
 * AudioMix — composes the canvas § 24C five-layer audio stack and applies
 * the ducking schedule computed by `useAudioMix`.
 *
 * Five layers (priority order): narrator → veo → music → ambient → sfx.
 *
 * Playback uses the same web HTMLAudio primitive as the original
 * `AmbientSoundscape` (no new dependencies). On native platforms the
 * component is a no-op; SceneMedia continues to render the visual layers
 * regardless.
 *
 * Narrator is the one exception: its HTMLAudio element is owned by
 * `useNarratorPlayback` (mounted in SceneMedia) so the visible chrome can
 * render a scrub bar / current-time readout. AudioMix still receives the
 * narrator source as input so the ducking schedule applied to the four
 * lower layers (veo/music/ambient/sfx) reflects whether the narrator is
 * speaking — only the actual element creation lives elsewhere.
 */
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { type AudioMixInput, useAudioMix } from "../../hooks/useAudioMix";
import {
  configureNativeAudioMode,
  createNativePlayer,
  type NativeAudioPlayer,
} from "./nativeAudio";

type AudioMixProps = AudioMixInput;

/**
 * The component returns null — audio playback is a side effect, and there
 * is no visual surface for the mix. SceneMedia/VeoCinematic handle visuals.
 *
 * Layer hooks are unrolled (not iterated) so React's Rules of Hooks call
 * order is stable across renders even though some layers may be undefined.
 */
export function AudioMix(props: AudioMixProps): null {
  const mix = useAudioMix(props);

  // Narrator (priority 1) playback is intentionally NOT mounted here —
  // see `useNarratorPlayback` (called from SceneMedia). The mix result
  // for `mix.narrator` still drives the ducking schedule for the lower
  // layers below; it's just not bound to an HTMLAudio element in this
  // component anymore.

  // Veo diegetic audio (priority 2). Tied to the cinematic clip — no loop.
  useLayerPlayback({
    uri: props.veo?.uri,
    id: props.veo?.id,
    loop: props.veo?.loop ?? false,
    volume: mix.veo.volume,
    active: mix.veo.active,
  });

  // Music (priority 3). Per-chapter, per-room — loops by default.
  useLayerPlayback({
    uri: props.music?.uri,
    id: props.music?.id,
    loop: props.music?.loop ?? true,
    volume: mix.music.volume,
    active: mix.music.active,
  });

  // Ambient library loop (priority 4). Always loops.
  useLayerPlayback({
    uri: props.ambient?.uri,
    id: props.ambient?.id,
    loop: true,
    volume: mix.ambient.volume,
    active: mix.ambient.active,
  });

  // SFX (priority 5; MVP omits, but the layer is wired for completeness).
  useLayerPlayback({
    uri: props.sfx?.uri,
    id: props.sfx?.id,
    loop: props.sfx?.loop ?? false,
    volume: mix.sfx.volume,
    active: mix.sfx.active,
  });

  return null;
}

type LayerPlaybackArgs = {
  uri?: string | undefined;
  id?: string | undefined;
  loop: boolean;
  volume: number;
  active: boolean;
};

/**
 * Side-effect playback hook for a single layer.
 *
 * WEB: uses the global `Audio` constructor — same primitive as the original
 * AmbientSoundscape implementation.
 *
 * NATIVE: routes through `expo-audio` (see ./nativeAudio) so the layer keeps
 * playing when the screen locks / the app backgrounds — the reason the app
 * went native. `configureNativeAudioMode()` installs the background-capable
 * audio session on first mount.
 *
 * Both paths re-create the underlying player when the URI changes and update
 * volume on every render so the ducking schedule applies smoothly, pausing /
 * detaching on unmount or when the layer goes inactive. The two platforms use
 * separate refs; only one branch is live per runtime.
 */
function useLayerPlayback({ active, id, loop, uri, volume }: LayerPlaybackArgs): void {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const nativeRef = useRef<NativeAudioPlayer | null>(null);
  const currentUriRef = useRef<string | null>(null);
  const nativeUriRef = useRef<string | null>(null);

  // Create / tear down the audio element when uri changes.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (typeof Audio === "undefined") return;
    // Treat empty strings the same as undefined — `new Audio("")` mounts an
    // element whose subsequent .play() trips the browser's "Invalid URI"
    // error and pollutes the console on every scene transition.
    if (!uri || uri.length === 0) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
        currentUriRef.current = null;
      }
      return;
    }
    if (currentUriRef.current === uri && audioRef.current) return;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    const audio = new Audio(uri);
    audio.loop = loop;
    audio.volume = volume;
    audioRef.current = audio;
    currentUriRef.current = uri;

    return () => {
      audio.pause();
      audio.src = "";
      if (audioRef.current === audio) {
        audioRef.current = null;
        currentUriRef.current = null;
      }
    };
    // `loop` and initial `volume` are intentionally captured at creation;
    // subsequent volume changes flow through the second effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, id]);

  // Apply volume / active changes without recreating the element.
  // `uri` must be in the deps so this effect re-fires after Effect 1
  // creates a fresh Audio element on scene transitions — otherwise the
  // new element sits paused (HTMLAudio default) because active/volume/loop
  // are unchanged from the previous scene's playing state, and the user
  // has to manually pause+resume to nudge it.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = clamp01(volume);
    audio.loop = loop;
    if (active && volume > 0) {
      if (audio.paused) {
        void audio.play().catch(() => undefined);
      }
    } else {
      if (!audio.paused) audio.pause();
    }
  }, [active, loop, volume, uri]);

  // Native Effect 1: create / tear down the expo-audio player when uri
  // changes. Mirrors the web create effect. No-op on web.
  useEffect(() => {
    if (Platform.OS === "web") return;
    configureNativeAudioMode();

    if (!uri || uri.length === 0) {
      if (nativeRef.current) {
        nativeRef.current.pause();
        nativeRef.current.remove();
        nativeRef.current = null;
        nativeUriRef.current = null;
      }
      return;
    }
    if (nativeUriRef.current === uri && nativeRef.current) return;

    if (nativeRef.current) {
      nativeRef.current.pause();
      nativeRef.current.remove();
      nativeRef.current = null;
    }
    const player = createNativePlayer(uri, loop, volume);
    nativeRef.current = player;
    nativeUriRef.current = uri;

    return () => {
      if (player) {
        player.pause();
        player.remove();
      }
      if (nativeRef.current === player) {
        nativeRef.current = null;
        nativeUriRef.current = null;
      }
    };
    // `loop` / initial `volume` are captured at creation; later changes flow
    // through Native Effect 2 below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, id]);

  // Native Effect 2: apply volume / active changes without recreating the
  // player. Mirrors the web volume effect. No-op on web.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const player = nativeRef.current;
    if (!player) return;
    player.volume = clamp01(volume);
    player.loop = loop;
    if (active && volume > 0) {
      player.play();
    } else {
      player.pause();
    }
  }, [active, loop, volume, uri]);
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
