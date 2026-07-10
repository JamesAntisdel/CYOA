import type { CinematicStatus } from "../../lib/cinematicApi";

/**
 * Pure state machine for the full-bleed `CinematicMoment` surface, kept
 * free of any React Native import so it can be unit-tested in the `node`
 * vitest environment (mirrors the `reduceMediaPlate` pattern that backs
 * `MediaPlate`). The `.tsx` view is a thin render of this resolver.
 *
 * The four visible states (Req 7.2):
 *
 *   skeleton   Generation in flight and no still to hold — paper frame +
 *              "Cinematic loading…" pip.
 *   poster     A still is shown: either the ready cinematic's poster frame
 *              (with a play control) or the endpoint key still while the
 *              cinematic is still generating (no play control yet).
 *   buffering  The reader pressed play; the video is loading.
 *   playing    The video is playing.
 *
 * Plus `hidden` — failed/blocked with nothing to show — where the caller
 * renders nothing and the surrounding ending still carries the page.
 */
export type CinematicMomentState =
  | "hidden"
  | "skeleton"
  | "poster"
  | "buffering"
  | "playing"
  // The job failed/blocked and there is no still to hold — show a small,
  // non-alarming "cinematic unavailable" notice rather than nothing, so the
  // reader gets feedback when a story's cinematic can't be generated.
  | "failed";

export type CinematicMomentInput = {
  /** Status of the cinematic asset, if any. */
  status: CinematicStatus | undefined;
  /** A ready, playable video URL is present. */
  hasVideo: boolean;
  /** A poster frame or endpoint fallback still is available. */
  hasStill: boolean;
  /** Reader has reduced-motion set — hold the poster, never autoplay. */
  reducedMotion: boolean;
  /** Reader has pressed the play control (or replay). */
  playRequested: boolean;
  /** The underlying video element has loaded enough to play. */
  videoReady: boolean;
};

export type CinematicMomentResolved = {
  state: CinematicMomentState;
  /** Whether to show an interactive play control on the poster. */
  canPlay: boolean;
};

/**
 * Resolve the visible state. Reduced-motion always collapses to a held
 * poster with no play control (Req 6.3 / 7.4 — never autoplay, never move).
 */
export function resolveCinematicMomentState(
  input: CinematicMomentInput,
): CinematicMomentResolved {
  const { status, hasVideo, hasStill, reducedMotion, playRequested, videoReady } =
    input;

  const ready = status === "ready" && hasVideo;
  const inFlight = status === "queued" || status === "generating";

  const failedOrBlocked = status === "failed" || status === "blocked";

  // Reduced motion: hold the poster if we have anything to show, else the
  // skeleton while it generates. No play control, no video.
  if (reducedMotion) {
    if (ready || hasStill) return { state: "poster", canPlay: false };
    if (inFlight) return { state: "skeleton", canPlay: false };
    if (failedOrBlocked) return { state: "failed", canPlay: false };
    return { state: "hidden", canPlay: false };
  }

  // Motion on: a ready cinematic the reader has asked to play.
  if (ready && playRequested) {
    return { state: videoReady ? "playing" : "buffering", canPlay: true };
  }
  // Ready but at rest — poster with a play control.
  if (ready) return { state: "poster", canPlay: true };
  // Still generating (or otherwise not ready) but we have a fallback still.
  if (hasStill) return { state: "poster", canPlay: false };
  // Nothing to show yet, but a job is in flight.
  if (inFlight) return { state: "skeleton", canPlay: false };
  // Failed / blocked with no still — show a small unavailable notice.
  if (failedOrBlocked) return { state: "failed", canPlay: false };
  // No cinematic asset at all — render nothing.
  return { state: "hidden", canPlay: false };
}

/**
 * Volume the Omni native soundscape ducks to while the ending-prose narrator
 * speaks over it (Req 6.2 — "reduced audio duck"). Mirrors the AudioMix
 * discipline where the narrator (priority 1) presses the lower layers down
 * rather than silencing them.
 */
export const NATIVE_AUDIO_DUCK = 0.25;

export type CinematicAudioInput = {
  /** Resolved visible state (only `playing` emits audio). */
  state: CinematicMomentState;
  /** The cinematic carries an Omni native synchronized audio track. */
  hasAudio: boolean;
  /** Reader mute preference. */
  muted: boolean;
  /** Reader master audio toggle (settings.audioEnabled). */
  audioEnabled: boolean;
  /** The ending-prose narrator is mid-sentence (drives the duck). */
  narratorPlaying: boolean;
};

export type CinematicAudioResolved = {
  /** Emit the native soundscape — i.e. leave the `<video>` unmuted. */
  nativeAudioActive: boolean;
  /** The `<video>` element's `muted` attribute (true ⇒ silent playback). */
  videoMuted: boolean;
  /** Native-track volume in [0, 1] after ducking under the narrator. */
  nativeVolume: number;
  /** Whether the ending-prose narrator should play over the cinematic. */
  narratorActive: boolean;
};

/**
 * Pure audio-mix decision for the cinematic surface (Req 6.2 / 6.3), kept
 * here (not in the `.tsx`) so it's unit-testable without React.
 *
 * Gates, in order:
 *   - audio plays ONLY in the `playing` state (reduced-motion holds a poster,
 *     never reaches `playing`, so it is always silent — Req 6.3);
 *   - the reader must allow audio (`audioEnabled && !muted`) — muted ⇒ the
 *     `<video>` is muted outright (silent);
 *   - the native track is emitted only when the cinematic actually carries one
 *     (`hasAudio`); no native track ⇒ silent playback, never an error (the
 *     "no audio config" degrade path);
 *   - while the narrator speaks, the native soundscape ducks to
 *     {@link NATIVE_AUDIO_DUCK} instead of going silent.
 */
export function resolveCinematicAudio(
  input: CinematicAudioInput,
): CinematicAudioResolved {
  const { state, hasAudio, muted, audioEnabled, narratorPlaying } = input;
  const audioAllowed = audioEnabled && !muted;
  const isPlaying = state === "playing";

  const nativeAudioActive = isPlaying && audioAllowed && hasAudio;
  const narratorActive = isPlaying && audioAllowed;
  const nativeVolume = nativeAudioActive && narratorPlaying ? NATIVE_AUDIO_DUCK : 1;

  return {
    nativeAudioActive,
    videoMuted: !nativeAudioActive,
    nativeVolume,
    narratorActive,
  };
}
