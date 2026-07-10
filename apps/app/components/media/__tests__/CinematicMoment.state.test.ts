import { describe, expect, it } from "vitest";

import {
  NATIVE_AUDIO_DUCK,
  resolveCinematicAudio,
  resolveCinematicMomentState,
  type CinematicAudioInput,
  type CinematicMomentInput,
} from "../cinematicMomentState";

// The resolver is the public surface under test — the CinematicMoment view
// is a thin render of this pure state machine (same discipline as the
// MediaPlate reducer test in this directory).

const base: CinematicMomentInput = {
  status: undefined,
  hasVideo: false,
  hasStill: false,
  reducedMotion: false,
  playRequested: false,
  videoReady: false,
};

describe("CinematicMoment state machine", () => {
  it("holds the poster and never offers play under reduced motion", () => {
    const resolved = resolveCinematicMomentState({
      ...base,
      status: "ready",
      hasVideo: true,
      hasStill: true,
      reducedMotion: true,
      playRequested: true, // even an intent to play must not move
      videoReady: true,
    });
    expect(resolved.state).toBe("poster");
    expect(resolved.canPlay).toBe(false);
  });

  it("shows a skeleton while generating with no still to hold", () => {
    const resolved = resolveCinematicMomentState({ ...base, status: "generating" });
    expect(resolved.state).toBe("skeleton");
  });

  it("falls back to the endpoint still while the cinematic generates", () => {
    const resolved = resolveCinematicMomentState({
      ...base,
      status: "generating",
      hasStill: true,
    });
    expect(resolved.state).toBe("poster");
    expect(resolved.canPlay).toBe(false);
  });

  it("offers a play control on a ready cinematic at rest (motion on)", () => {
    const resolved = resolveCinematicMomentState({
      ...base,
      status: "ready",
      hasVideo: true,
      hasStill: true,
    });
    expect(resolved.state).toBe("poster");
    expect(resolved.canPlay).toBe(true);
  });

  it("buffers then plays after the reader presses play", () => {
    const buffering = resolveCinematicMomentState({
      ...base,
      status: "ready",
      hasVideo: true,
      hasStill: true,
      playRequested: true,
      videoReady: false,
    });
    expect(buffering.state).toBe("buffering");

    const playing = resolveCinematicMomentState({
      ...base,
      status: "ready",
      hasVideo: true,
      hasStill: true,
      playRequested: true,
      videoReady: true,
    });
    expect(playing.state).toBe("playing");
  });

  it("shows the failure notice when failed/blocked with nothing to hold", () => {
    expect(resolveCinematicMomentState({ ...base, status: "failed" }).state).toBe(
      "failed",
    );
    expect(resolveCinematicMomentState({ ...base, status: "blocked" }).state).toBe(
      "failed",
    );
    // Reduced motion still surfaces the notice (never a black gap).
    expect(
      resolveCinematicMomentState({ ...base, status: "failed", reducedMotion: true }).state,
    ).toBe("failed");
  });

  it("hides only when there is no cinematic asset at all", () => {
    expect(resolveCinematicMomentState({ ...base, status: undefined }).state).toBe(
      "hidden",
    );
  });

  it("keeps the still visible even when a cinematic failed but a poster remains", () => {
    const resolved = resolveCinematicMomentState({
      ...base,
      status: "failed",
      hasStill: true,
    });
    expect(resolved.state).toBe("poster");
    expect(resolved.canPlay).toBe(false);
  });
});

// --- Native audio + narrator mix (Req 6.2 / 6.3) --------------------------

const audioBase: CinematicAudioInput = {
  state: "playing",
  hasAudio: true,
  muted: false,
  audioEnabled: true,
  narratorPlaying: false,
};

describe("CinematicMoment audio mix", () => {
  it("emits the native soundscape at full volume while playing (audio allowed)", () => {
    const a = resolveCinematicAudio(audioBase);
    expect(a.nativeAudioActive).toBe(true);
    expect(a.videoMuted).toBe(false);
    expect(a.nativeVolume).toBe(1);
    expect(a.narratorActive).toBe(true);
  });

  it("plays silent when the reader has muted", () => {
    const a = resolveCinematicAudio({ ...audioBase, muted: true });
    expect(a.nativeAudioActive).toBe(false);
    expect(a.videoMuted).toBe(true);
    expect(a.narratorActive).toBe(false);
  });

  it("plays silent when the reader disabled audio", () => {
    const a = resolveCinematicAudio({ ...audioBase, audioEnabled: false });
    expect(a.videoMuted).toBe(true);
    expect(a.narratorActive).toBe(false);
  });

  it("plays silent when the cinematic carries no native track (no audio config)", () => {
    const a = resolveCinematicAudio({ ...audioBase, hasAudio: false });
    expect(a.nativeAudioActive).toBe(false);
    expect(a.videoMuted).toBe(true);
    // Narrator may still ride over a silent clip if a URI is wired.
    expect(a.narratorActive).toBe(true);
  });

  it("is silent outside the playing state (poster / reduced-motion hold)", () => {
    const a = resolveCinematicAudio({ ...audioBase, state: "poster" });
    expect(a.nativeAudioActive).toBe(false);
    expect(a.videoMuted).toBe(true);
    expect(a.narratorActive).toBe(false);
  });

  it("ducks the native track while the narrator speaks, then restores", () => {
    const ducked = resolveCinematicAudio({ ...audioBase, narratorPlaying: true });
    expect(ducked.nativeVolume).toBe(NATIVE_AUDIO_DUCK);
    expect(ducked.nativeAudioActive).toBe(true);

    const restored = resolveCinematicAudio({ ...audioBase, narratorPlaying: false });
    expect(restored.nativeVolume).toBe(1);
  });
});
