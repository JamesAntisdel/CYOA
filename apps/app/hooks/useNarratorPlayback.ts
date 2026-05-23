/**
 * useNarratorPlayback — owns the HTMLAudio element for the narrator (TTS)
 * layer so the visible chrome in `NarratorControl` can render a scrub bar
 * and seek through playback.
 *
 * Why this is split out of AudioMix's `useLayerPlayback`:
 *   - `useLayerPlayback` is hermetic — it exposes no `currentTime`,
 *     `duration`, or `seek` handle. Adding a scrub bar requires those
 *     three pieces of state to flow up to React (so they can render) and
 *     a seek handle to flow down (so taps on the bar can move the head).
 *   - Forking only the narrator layer keeps the rest of AudioMix
 *     hermetic; the four lower layers (veo/music/ambient/sfx) still have
 *     no externally visible UI, so they don't need to lift any state.
 *
 * Behavior mirrors `useLayerPlayback` for the bits we still need:
 *   - Web-only via `Platform.OS === 'web'` + `typeof Audio !== 'undefined'`.
 *     Native is a no-op; the returned state stays at `{ isPlaying: false,
 *     currentTime: 0, duration: 0, seek: noop }`.
 *   - Re-creates the `Audio` element when `uri` changes (scene transitions),
 *     and re-asserts play() in the same effect — the bug we fixed in
 *     AudioMix.tsx where the deps array missed `uri` cannot recur here
 *     because the create/play effect depends on `uri` directly.
 *   - Honors `paused` and `muted` by calling `pause()` and dropping
 *     `volume` to 0; volume is restored to the caller-supplied value when
 *     resumed/unmuted.
 *
 * Note: this hook owns its own HTMLAudio element. AudioMix's narrator
 * `useLayerPlayback` call must be removed (or this hook will fight it for
 * the same URI). See `AudioMix.tsx` for the deletion.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

export type NarratorPlaybackInput = {
  /** Narrator clip URI. Absent → playback is idle. */
  uri: string | undefined;
  /** User-driven pause; flips on/off without recreating the audio element. */
  paused: boolean;
  /** Global mute (caller's resolved mute state). When true, audio is paused. */
  muted: boolean;
  /** Base volume in [0, 1]. Multiplied by 0 when muted. */
  volume: number;
};

export type NarratorPlaybackState = {
  /** True while the underlying element reports `!paused && !ended`. */
  isPlaying: boolean;
  /** Current playback offset in seconds. Always 0 on native. */
  currentTime: number;
  /** Clip duration in seconds. 0 until `loadedmetadata` fires. Always 0 on native. */
  duration: number;
  /** Seek to a specific time (seconds). No-op on native or when no element. */
  seek: (time: number) => void;
};

const NOOP_STATE: NarratorPlaybackState = {
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  seek: () => undefined,
};

export function useNarratorPlayback(input: NarratorPlaybackInput): NarratorPlaybackState {
  const { muted, paused, uri, volume } = input;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentUriRef = useRef<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Effect 1: create / tear down the audio element when uri changes.
  //
  // Critical: this effect must depend on `uri` directly (not on derived
  // active/volume flags) so scene transitions force a fresh element AND
  // the auto-play branch fires. The previous AudioMix bug was that the
  // play() call lived in a separate effect whose deps didn't change
  // across scene transitions — so the new element sat paused at t=0.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (typeof Audio === "undefined") return;

    if (!uri) {
      const existing = audioRef.current;
      if (existing) {
        existing.pause();
        existing.src = "";
        audioRef.current = null;
        currentUriRef.current = null;
      }
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    if (currentUriRef.current === uri && audioRef.current) return;

    // Tear down any previous element before mounting the new one.
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }

    const audio = new Audio(uri);
    audio.loop = false;
    audio.volume = muted ? 0 : clamp01(volume);
    audioRef.current = audio;
    currentUriRef.current = uri;

    // Reset transport state; the listeners below will refill it as the
    // browser loads the clip.
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    const handleLoadedMetadata = () => {
      const d = Number.isFinite(audio.duration) ? audio.duration : 0;
      setDuration(d > 0 ? d : 0);
    };
    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(audio.duration || 0);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("durationchange", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);

    // Auto-play unless explicitly paused or muted. We only call play()
    // when the user has not opted into pause and the global mute isn't
    // set — same gate as the ducking schedule applied for the rest of
    // the layers in AudioMix.
    if (!paused && !muted) {
      void audio.play().catch(() => undefined);
    }

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("durationchange", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.pause();
      audio.src = "";
      if (audioRef.current === audio) {
        audioRef.current = null;
        currentUriRef.current = null;
      }
    };
    // `paused`, `muted`, and `volume` are intentionally captured at
    // element creation; subsequent changes flow through Effect 2 below
    // without recreating the element (so currentTime / duration are
    // preserved across pause toggles and volume tweaks).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  // Effect 2: apply pause / mute / volume changes without recreating
  // the element. Mirrors `useLayerPlayback`'s second effect.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const audio = audioRef.current;
    if (!audio) return;

    const effective = muted ? 0 : clamp01(volume);
    audio.volume = effective;

    if (paused || muted) {
      if (!audio.paused) audio.pause();
    } else {
      if (audio.paused) {
        void audio.play().catch(() => undefined);
      }
    }
  }, [paused, muted, volume]);

  const seek = useCallback((time: number) => {
    if (Platform.OS !== "web") return;
    const audio = audioRef.current;
    if (!audio) return;
    if (!Number.isFinite(time)) return;
    const d = Number.isFinite(audio.duration) ? audio.duration : 0;
    const clamped = Math.max(0, Math.min(d > 0 ? d : time, time));
    try {
      audio.currentTime = clamped;
    } catch {
      // Some browsers throw when seeking before metadata is loaded;
      // swallow — the next timeupdate will reconcile state.
      return;
    }
    setCurrentTime(clamped);
  }, []);

  if (Platform.OS !== "web") return NOOP_STATE;

  return { isPlaying, currentTime, duration, seek };
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
