/**
 * Tests for the AudioMix composition surface — verifies that the inputs
 * the React component receives map onto the expected ducking output for
 * the priority matrix in canvas § 24C.
 *
 * The component itself is a side-effect bridge over web `Audio` elements;
 * its meaningful behavior is the ducking schedule, which is delegated to
 * the pure `computeMix` function and exercised here under the input
 * shapes that real callers (SceneMedia, AmbientSoundscape) build.
 *
 * Run:
 *   pnpm --filter @cyoa/app exec node --import tsx components/media/__tests__/AudioMix.test.ts
 */
import { computeMix, type AudioMixInput } from "../../../hooks/useAudioMix";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`assert failed: ${message}`);
  }
}

const ambient = { id: "a", uri: "x://a", label: "lib", tags: ["x"], volume: 0.4 };
const narrator = { id: "n", uri: "x://n", volume: 0.9 };
const veo = { id: "v", uri: "x://v", volume: 0.8 };

function ambientOnly(muted: boolean, reducedMotion: boolean, appActive: boolean): AudioMixInput {
  // Shape mirrors what `AmbientSoundscape` forwards into `AudioMix`:
  // muted is the union of user mute and reducedMotion (legacy gate).
  return {
    ambient,
    muted: muted || reducedMotion,
    reducedMotion,
    appActive,
  };
}

export function runAudioMixTests(): void {
  // 1. AmbientSoundscape happy path → ambient plays at base.
  {
    const mix = computeMix(ambientOnly(false, false, true));
    assert(mix.ambient.active === true, "ambient active when allowed");
    assert(mix.ambient.volume === 0.4, "ambient at base volume");
  }

  // 2. User mute pauses ambient (preserves legacy AmbientSoundscape contract).
  {
    const mix = computeMix(ambientOnly(true, false, true));
    assert(mix.ambient.active === false, "user mute silences ambient");
    assert(mix.ambient.volume === 0, "user mute → volume 0");
  }

  // 3. Reduced motion pauses ambient through the wrapper (legacy behavior
  //    in `convex/media/audio.ts: ambientPlaybackAllowed`).
  {
    const mix = computeMix(ambientOnly(false, true, true));
    assert(mix.ambient.active === false, "reduced motion silences ambient via wrapper");
  }

  // 4. Native background pauses ambient.
  {
    const mix = computeMix(ambientOnly(false, false, false));
    assert(mix.ambient.active === false, "background silences ambient");
  }

  // 5. Full 5-layer scenario: narrator + veo + ambient, narrator wins.
  {
    const mix = computeMix({
      narrator,
      narratorActive: true,
      veo,
      veoPlaying: true,
      ambient,
      muted: false,
      reducedMotion: false,
      appActive: true,
    });
    assert(mix.narrator.active === true, "narrator active");
    assert(mix.narrator.volume === 0.9, "narrator at full base — never ducks");
    assert(mix.veo.active === false, "veo silent under narrator");
    // ambient ducks to 50% of base.
    assert(Math.abs(mix.ambient.volume - 0.4 * 0.5) < 1e-9, "ambient ducked 50% under narrator");
  }

  // 6. Veo-only motion: ambient gets the veo-duck, not the narrator-duck.
  {
    const mix = computeMix({
      veo,
      veoPlaying: true,
      ambient,
      muted: false,
      reducedMotion: false,
      appActive: true,
    });
    assert(mix.veo.active === true, "veo audio active without narrator");
    assert(mix.veo.volume === 0.8, "veo at full base when narrator silent");
    assert(
      Math.abs(mix.ambient.volume - 0.4 * 0.3) < 1e-9,
      "ambient ducked under veo motion",
    );
  }

  // 7. Reduced motion → no autoplay video audio even with full layer set.
  {
    const mix = computeMix({
      narrator,
      narratorActive: false,
      veo,
      veoPlaying: true,
      ambient,
      muted: false,
      reducedMotion: true,
      appActive: true,
    });
    assert(mix.veo.active === false, "veo blocked by reduced motion");
    assert(mix.veo.volume === 0, "veo volume 0 under reduced motion");
  }
}

if (typeof require !== "undefined" && require.main === module) {
  runAudioMixTests();
  // eslint-disable-next-line no-console
  console.log("AudioMix tests passed");
}
