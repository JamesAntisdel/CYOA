/**
 * Unit tests for the `computeMix` ducking schedule (canvas § 24C). The app
 * does not have a JS test runner wired into `pnpm test` for hooks yet (see
 * apps/app/package.json), so this file is a self-contained module that
 * runs its assertions when invoked directly via `node --import tsx`. Each
 * helper is a pure function so the checks are deterministic.
 *
 * Run:
 *   pnpm --filter @cyoa/app exec node --import tsx hooks/__tests__/useAudioMix.test.ts
 */
import { computeMix, DUCK_FACTORS, type AudioMixInput } from "../useAudioMix";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`assert failed: ${message}`);
  }
}

function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

function baseInput(overrides: Partial<AudioMixInput> = {}): AudioMixInput {
  return {
    muted: false,
    reducedMotion: false,
    appActive: true,
    ...overrides,
  };
}

const narratorSrc = { id: "n", uri: "x://n", volume: 0.9 };
const veoSrc = { id: "v", uri: "x://v", volume: 0.8 };
const musicSrc = { id: "m", uri: "x://m", volume: 0.6 };
const ambientLoop = { id: "a", uri: "x://a", label: "amb", tags: ["x"], volume: 0.5 };
const sfxSrc = { id: "s", uri: "x://s", volume: 0.4 };

export function runUseAudioMixTests(): void {
  // 1. Empty input — every layer silent, no source.
  {
    const mix = computeMix(baseInput());
    assert(mix.narrator.active === false, "no narrator source → inactive");
    assert(mix.veo.active === false, "no veo source → inactive");
    assert(mix.music.active === false, "no music source → inactive");
    assert(mix.ambient.active === false, "no ambient source → inactive");
    assert(mix.sfx.active === false, "no sfx source → inactive");
  }

  // 2. Narrator alone plays at full base volume.
  {
    const mix = computeMix(baseInput({ narrator: narratorSrc, narratorActive: true }));
    assert(approx(mix.narrator.volume, 0.9), "narrator at full base");
    assert(mix.narrator.active === true, "narrator active");
  }

  // 3. Narrator never gets ducked even when every other layer is loud.
  {
    const mix = computeMix(
      baseInput({
        narrator: narratorSrc,
        narratorActive: true,
        veo: veoSrc,
        veoPlaying: true,
        music: musicSrc,
        ambient: ambientLoop,
        sfx: sfxSrc,
      }),
    );
    assert(approx(mix.narrator.volume, 0.9), "narrator stays at base when others play");
  }

  // 4. Veo audio mutes entirely under narrator (canvas: "mutes under narrator").
  {
    const mix = computeMix(
      baseInput({
        narrator: narratorSrc,
        narratorActive: true,
        veo: veoSrc,
        veoPlaying: true,
      }),
    );
    assert(approx(mix.veo.volume, 0), "veo silent under narrator");
    assert(mix.veo.active === false, "veo inactive under narrator");
  }

  // 5. Veo audio plays at base when narrator is silent and motion is allowed.
  {
    const mix = computeMix(baseInput({ veo: veoSrc, veoPlaying: true }));
    assert(approx(mix.veo.volume, 0.8), "veo at base with motion + no narrator");
  }

  // 6. Music ducks 70% under narrator → 30% of base.
  {
    const mix = computeMix(
      baseInput({
        narrator: narratorSrc,
        narratorActive: true,
        music: musicSrc,
      }),
    );
    assert(
      approx(mix.music.volume, 0.6 * DUCK_FACTORS.musicUnderNarrator),
      "music ducked to 30% under narrator",
    );
  }

  // 7. Music ducks under Veo motion when narrator is silent.
  {
    const mix = computeMix(
      baseInput({
        veo: veoSrc,
        veoPlaying: true,
        music: musicSrc,
      }),
    );
    assert(
      approx(mix.music.volume, 0.6 * DUCK_FACTORS.musicUnderVeo),
      "music ducked under veo motion",
    );
  }

  // 8. Music plays at base when nothing else is active.
  {
    const mix = computeMix(baseInput({ music: musicSrc }));
    assert(approx(mix.music.volume, 0.6), "music at base alone");
  }

  // 9. Ambient ducks 50% under narrator.
  {
    const mix = computeMix(
      baseInput({
        narrator: narratorSrc,
        narratorActive: true,
        ambient: ambientLoop,
      }),
    );
    assert(
      approx(mix.ambient.volume, 0.5 * DUCK_FACTORS.ambientUnderNarrator),
      "ambient ducked 50% under narrator",
    );
  }

  // 10. Ambient ducks deeper under Veo motion.
  {
    const mix = computeMix(
      baseInput({
        veo: veoSrc,
        veoPlaying: true,
        ambient: ambientLoop,
      }),
    );
    assert(
      approx(mix.ambient.volume, 0.5 * DUCK_FACTORS.ambientUnderVeo),
      "ambient ducked under veo motion",
    );
  }

  // 11. SFX follows the same priority shape as ambient.
  {
    const narrating = computeMix(
      baseInput({ narrator: narratorSrc, narratorActive: true, sfx: sfxSrc }),
    );
    assert(
      approx(narrating.sfx.volume, 0.4 * DUCK_FACTORS.sfxUnderNarrator),
      "sfx ducked under narrator",
    );
    const motion = computeMix(baseInput({ veo: veoSrc, veoPlaying: true, sfx: sfxSrc }));
    assert(
      approx(motion.sfx.volume, 0.4 * DUCK_FACTORS.sfxUnderVeo),
      "sfx ducked under veo",
    );
  }

  // 12. Narrator-priority wins when both narrator and veo are active —
  //     other layers get the narrator-duck, not the veo-duck.
  {
    const mix = computeMix(
      baseInput({
        narrator: narratorSrc,
        narratorActive: true,
        veo: veoSrc,
        veoPlaying: true,
        music: musicSrc,
        ambient: ambientLoop,
      }),
    );
    assert(
      approx(mix.music.volume, 0.6 * DUCK_FACTORS.musicUnderNarrator),
      "music takes narrator-duck even with motion",
    );
    assert(
      approx(mix.ambient.volume, 0.5 * DUCK_FACTORS.ambientUnderNarrator),
      "ambient takes narrator-duck even with motion",
    );
  }

  // 13. System / user mute silences every layer regardless of priority.
  {
    const mix = computeMix(
      baseInput({
        muted: true,
        narrator: narratorSrc,
        narratorActive: true,
        veo: veoSrc,
        veoPlaying: true,
        music: musicSrc,
        ambient: ambientLoop,
        sfx: sfxSrc,
      }),
    );
    assert(mix.narrator.volume === 0, "narrator silent under mute");
    assert(mix.veo.volume === 0, "veo silent under mute");
    assert(mix.music.volume === 0, "music silent under mute");
    assert(mix.ambient.volume === 0, "ambient silent under mute");
    assert(mix.sfx.volume === 0, "sfx silent under mute");
    assert(mix.narrator.active === false, "narrator inactive under mute");
    assert(mix.ambient.active === false, "ambient inactive under mute");
  }

  // 14. Native background (!appActive) silences every layer.
  {
    const mix = computeMix(
      baseInput({
        appActive: false,
        narrator: narratorSrc,
        narratorActive: true,
        ambient: ambientLoop,
      }),
    );
    assert(mix.narrator.volume === 0, "narrator silent in background");
    assert(mix.ambient.volume === 0, "ambient silent in background");
  }

  // 15. Reduced motion blocks Veo audio entirely (Req 18.5).
  {
    const mix = computeMix(
      baseInput({
        reducedMotion: true,
        veo: veoSrc,
        veoPlaying: true,
      }),
    );
    assert(mix.veo.volume === 0, "veo silent under reduced motion");
    assert(mix.veo.active === false, "veo inactive under reduced motion");
  }

  // 16. Reduced motion + veoPlaying → music/ambient don't get veo-duck
  //     (motion can't "dominate" if veo audio is muted).
  {
    const mix = computeMix(
      baseInput({
        reducedMotion: true,
        veo: veoSrc,
        veoPlaying: true,
        music: musicSrc,
        ambient: ambientLoop,
      }),
    );
    assert(approx(mix.music.volume, 0.6), "music undimmed when reduced-motion silences veo");
    assert(approx(mix.ambient.volume, 0.5), "ambient undimmed when reduced-motion silences veo");
  }

  // 17. narratorActive=false means no duck even when narrator source exists.
  {
    const mix = computeMix(
      baseInput({
        narrator: narratorSrc,
        narratorActive: false,
        music: musicSrc,
        ambient: ambientLoop,
      }),
    );
    assert(approx(mix.music.volume, 0.6), "music undimmed when narrator silent");
    assert(approx(mix.ambient.volume, 0.5), "ambient undimmed when narrator silent");
  }

  // 18. Layer with zero base volume reports inactive even when "playing".
  {
    const mix = computeMix(
      baseInput({
        music: { id: "m", uri: "x://m", volume: 0 },
      }),
    );
    assert(mix.music.active === false, "zero-volume music inactive");
  }
}

if (typeof require !== "undefined" && require.main === module) {
  runUseAudioMixTests();
  // eslint-disable-next-line no-console
  console.log("useAudioMix tests passed");
}
