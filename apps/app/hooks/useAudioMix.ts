/**
 * useAudioMix — central state for the canvas § 24C five-layer audio mix.
 *
 * Layers, in priority order:
 *   1. narrator      (TTS, never ducked)
 *   2. veo           (diegetic video audio; mutes under narrator)
 *   3. music         (generated music; ducks 70% under narrator)
 *   4. ambient       (library loop; ducks 50% under narrator)
 *   5. sfx           (MVP omits; modeled for completeness, ducks 50%)
 *
 * The ducking decision is a pure function (`computeMix`) so the priority
 * matrix can be tested in isolation without a React tree or an audio engine.
 *
 * Honors:
 *   - system mute / user mute  → every layer volume forced to 0
 *   - native background        → every layer volume forced to 0
 *   - reduced motion           → veo audio forced to 0 (never autoplay)
 */
import { useMemo } from "react";

import type { AmbientLoop } from "./useStreamingScene";

/** Caller-supplied source descriptors for each layer (all optional). */
export type AudioSource = {
  /** Stable id for keyed audio elements; required when the source exists. */
  id: string;
  /** Resource URI. */
  uri: string;
  /** Whether to loop playback. */
  loop?: boolean;
  /** Base volume in [0, 1] before ducking. */
  volume: number;
};

export type AudioMixInput = {
  /** Narrator TTS source (priority 1). */
  narrator?: AudioSource | undefined;
  /**
   * Whether narrator is currently speaking. The narrator audio element drives
   * this — the hook treats it as an external signal so that streaming or
   * paragraph-by-paragraph TTS can flip the schedule on/off without resetting
   * the rest of the mix.
   */
  narratorActive?: boolean;
  /** Veo diegetic audio source (priority 2). */
  veo?: AudioSource | undefined;
  /** Whether the cinematic video is currently playing. */
  veoPlaying?: boolean;
  /** Generated music (Lyria) source (priority 3). */
  music?: AudioSource | undefined;
  /** Library ambient loop (priority 4). */
  ambient?: AmbientLoop | undefined;
  /** SFX source (priority 5; MVP omits but we model it). */
  sfx?: AudioSource | undefined;
  /** True when either user mute or system/native mute is set. */
  muted: boolean;
  /** True when reduced-motion accessibility preference is set. */
  reducedMotion: boolean;
  /** True when the app is foregrounded; native background → false. */
  appActive: boolean;
};

export type LayerKey = "narrator" | "veo" | "music" | "ambient" | "sfx";

/** Computed per-layer volume + whether the layer should play. */
export type AudioLayerState = {
  /** Base volume from the source (before ducking). */
  base: number;
  /** Effective volume after ducking, mute, motion gates. */
  volume: number;
  /** True iff the layer has a source and effective volume > 0. */
  active: boolean;
};

export type AudioMix = {
  narrator: AudioLayerState;
  veo: AudioLayerState;
  music: AudioLayerState;
  ambient: AudioLayerState;
  sfx: AudioLayerState;
};

/**
 * Ducking percentages (effective volume = base * factor).
 * Values lifted from canvas § 24C lane notes.
 */
export const DUCK_FACTORS = {
  /** Narrator never ducks. */
  narrator: 1,
  /** Veo "mutes under narrator" — taken as full duck. */
  veoUnderNarrator: 0,
  /** Music ducks 70% under narrator → 30% remaining. */
  musicUnderNarrator: 0.3,
  /** Music ducks under Veo "motion dominates" — match music-under-narrator. */
  musicUnderVeo: 0.3,
  /** Ambient ducks 50% under narrator. */
  ambientUnderNarrator: 0.5,
  /** Ambient ducks under Veo motion. */
  ambientUnderVeo: 0.3,
  /** SFX ducks 50% under narrator. */
  sfxUnderNarrator: 0.5,
  /** SFX ducks under Veo motion. */
  sfxUnderVeo: 0.3,
} as const;

const SILENT: AudioLayerState = { base: 0, volume: 0, active: false };

function silent(base: number): AudioLayerState {
  return { base, volume: 0, active: false };
}

function layer(base: number, volume: number): AudioLayerState {
  // Clamp into [0, 1] so downstream <audio>.volume assignment is safe.
  const clamped = volume < 0 ? 0 : volume > 1 ? 1 : volume;
  return { base, volume: clamped, active: clamped > 0 };
}

/**
 * Pure ducking function. Returns the effective volume schedule for each
 * layer given the current sources and system flags.
 *
 * Priority rules (canvas § 24C):
 *   - Narrator: always full when present.
 *   - Veo: mutes entirely under narrator; reduced-motion blocks autoplay.
 *   - Music: ducks 70% under narrator; ducks under Veo motion.
 *   - Ambient: ducks 50% under narrator; ducks further under Veo motion.
 *   - SFX: same shape as ambient.
 *
 * Global gates:
 *   - muted or !appActive → every layer silent.
 */
export function computeMix(input: AudioMixInput): AudioMix {
  const { muted, reducedMotion, appActive } = input;

  // Bases — the source's base volume, or 0 if missing.
  const nb = input.narrator?.volume ?? 0;
  const vb = input.veo?.volume ?? 0;
  const mb = input.music?.volume ?? 0;
  const ab = input.ambient?.volume ?? 0;
  const xb = input.sfx?.volume ?? 0;

  // Global mute / background — everything silent regardless of priority.
  if (muted || !appActive) {
    return {
      narrator: input.narrator ? silent(nb) : SILENT,
      veo: input.veo ? silent(vb) : SILENT,
      music: input.music ? silent(mb) : SILENT,
      ambient: input.ambient ? silent(ab) : SILENT,
      sfx: input.sfx ? silent(xb) : SILENT,
    };
  }

  const narratorOn = Boolean(input.narrator && input.narratorActive);
  // Veo motion dominates the lower layers only when Veo audio is allowed
  // to play. Reduced motion blocks Veo audio, so motion can't dominate.
  const veoOn = Boolean(input.veo && input.veoPlaying && !reducedMotion);

  // Narrator: always full, never ducked by anything else.
  const narrator: AudioLayerState = input.narrator
    ? layer(nb, nb * DUCK_FACTORS.narrator)
    : SILENT;

  // Veo: blocked under reduced motion; mutes under narrator.
  let veo: AudioLayerState;
  if (!input.veo) {
    veo = SILENT;
  } else if (reducedMotion) {
    veo = silent(vb);
  } else if (narratorOn) {
    veo = layer(vb, vb * DUCK_FACTORS.veoUnderNarrator);
  } else {
    veo = layer(vb, vb);
  }

  // Music: under narrator takes precedence over under-Veo (narrator is louder).
  let music: AudioLayerState;
  if (!input.music) {
    music = SILENT;
  } else if (narratorOn) {
    music = layer(mb, mb * DUCK_FACTORS.musicUnderNarrator);
  } else if (veoOn) {
    music = layer(mb, mb * DUCK_FACTORS.musicUnderVeo);
  } else {
    music = layer(mb, mb);
  }

  // Ambient: same shape as music, with a deeper ambient-under-veo duck.
  let ambient: AudioLayerState;
  if (!input.ambient) {
    ambient = SILENT;
  } else if (narratorOn) {
    ambient = layer(ab, ab * DUCK_FACTORS.ambientUnderNarrator);
  } else if (veoOn) {
    ambient = layer(ab, ab * DUCK_FACTORS.ambientUnderVeo);
  } else {
    ambient = layer(ab, ab);
  }

  // SFX: same priority shape.
  let sfx: AudioLayerState;
  if (!input.sfx) {
    sfx = SILENT;
  } else if (narratorOn) {
    sfx = layer(xb, xb * DUCK_FACTORS.sfxUnderNarrator);
  } else if (veoOn) {
    sfx = layer(xb, xb * DUCK_FACTORS.sfxUnderVeo);
  } else {
    sfx = layer(xb, xb);
  }

  return { narrator, veo, music, ambient, sfx };
}

/** React hook wrapper for `computeMix` — memoizes on the shaped input. */
export function useAudioMix(input: AudioMixInput): AudioMix {
  return useMemo(
    () => computeMix(input),
    // Each primitive flag and each source reference is memoization-stable.
    [
      input.narrator,
      input.narratorActive,
      input.veo,
      input.veoPlaying,
      input.music,
      input.ambient,
      input.sfx,
      input.muted,
      input.reducedMotion,
      input.appActive,
    ],
  );
}
