import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { computeMediaStrategy, omniEnabledFromEnv, type MediaStrategy } from "../media/mediaStrategy";

type Input = Parameters<typeof computeMediaStrategy>[0];

function base(overrides: Partial<Input> = {}): Input {
  return {
    imagesEnabled: true,
    videoEnabled: true,
    isPro: true,
    omniEnabled: true,
    ...overrides,
  };
}

describe("computeMediaStrategy", () => {
  it("defaults to per_scene_legacy when cinematicMode is absent (preserve current behavior)", () => {
    expect(computeMediaStrategy(base())).toBe<MediaStrategy>("per_scene_legacy");
  });

  it("caps at off when imagesEnabled is false, regardless of anything else", () => {
    expect(computeMediaStrategy(base({ imagesEnabled: false }))).toBe("off");
    expect(
      computeMediaStrategy(base({ imagesEnabled: false, cinematicMode: "endpoint_cinematic" })),
    ).toBe("off");
    expect(
      computeMediaStrategy(base({ imagesEnabled: false, cinematicMode: "per_scene_legacy", videoEnabled: false })),
    ).toBe("off");
  });

  it("honors an explicit off cinematicMode", () => {
    expect(computeMediaStrategy(base({ cinematicMode: "off" }))).toBe("off");
  });

  it("honors stills_only cinematicMode", () => {
    expect(computeMediaStrategy(base({ cinematicMode: "stills_only" }))).toBe("stills_only");
    // video toggle is irrelevant to a stills-only desire
    expect(computeMediaStrategy(base({ cinematicMode: "stills_only", videoEnabled: false }))).toBe(
      "stills_only",
    );
  });

  it("caps per_scene_legacy at stills_only when video is disabled", () => {
    expect(computeMediaStrategy(base({ cinematicMode: "per_scene_legacy" }))).toBe("per_scene_legacy");
    expect(
      computeMediaStrategy(base({ cinematicMode: "per_scene_legacy", videoEnabled: false })),
    ).toBe("stills_only");
    // default (absent) path caps the same way
    expect(computeMediaStrategy(base({ videoEnabled: false }))).toBe("stills_only");
  });

  it("grants endpoint_cinematic only when Pro AND omni are both present", () => {
    expect(computeMediaStrategy(base({ cinematicMode: "endpoint_cinematic" }))).toBe(
      "endpoint_cinematic",
    );
  });

  it("degrades endpoint_cinematic to per_scene_legacy when not Pro", () => {
    expect(
      computeMediaStrategy(base({ cinematicMode: "endpoint_cinematic", isPro: false })),
    ).toBe("per_scene_legacy");
  });

  it("degrades endpoint_cinematic to per_scene_legacy when omni is not enabled", () => {
    expect(
      computeMediaStrategy(base({ cinematicMode: "endpoint_cinematic", omniEnabled: false })),
    ).toBe("per_scene_legacy");
  });

  it("caps endpoint_cinematic at stills_only when video is disabled (even for Pro + omni)", () => {
    expect(
      computeMediaStrategy(base({ cinematicMode: "endpoint_cinematic", videoEnabled: false })),
    ).toBe("stills_only");
  });

  it("caps a would-be-degraded endpoint_cinematic at stills_only when video is disabled", () => {
    expect(
      computeMediaStrategy(
        base({ cinematicMode: "endpoint_cinematic", isPro: false, videoEnabled: false }),
      ),
    ).toBe("stills_only");
  });
});

describe("omniEnabledFromEnv", () => {
  const saved = { OMNI_ENABLED: process.env.OMNI_ENABLED, GEMINI_API_KEY: process.env.GEMINI_API_KEY };

  beforeEach(() => {
    delete process.env.OMNI_ENABLED;
    process.env.GEMINI_API_KEY = "test-key";
  });

  afterEach(() => {
    if (saved.OMNI_ENABLED === undefined) delete process.env.OMNI_ENABLED;
    else process.env.OMNI_ENABLED = saved.OMNI_ENABLED;
    if (saved.GEMINI_API_KEY === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved.GEMINI_API_KEY;
  });

  it("is DISABLED by default (explicit opt-in) even when a key is present and the switch is unset", () => {
    // Dark launch: a Gemini key already exists everywhere for images/Veo, so
    // Omni must NOT auto-enable. OMNI_ENABLED must be explicitly set.
    expect(omniEnabledFromEnv()).toBe(false);
  });

  it("stays disabled for 0 / false / any non-enable value", () => {
    process.env.OMNI_ENABLED = "0";
    expect(omniEnabledFromEnv()).toBe(false);
    process.env.OMNI_ENABLED = "false";
    expect(omniEnabledFromEnv()).toBe(false);
    process.env.OMNI_ENABLED = "yes";
    expect(omniEnabledFromEnv()).toBe(false);
  });

  it("enables only for an explicit 1 / true", () => {
    process.env.OMNI_ENABLED = "1";
    expect(omniEnabledFromEnv()).toBe(true);
    process.env.OMNI_ENABLED = "true";
    expect(omniEnabledFromEnv()).toBe(true);
    process.env.OMNI_ENABLED = "TRUE";
    expect(omniEnabledFromEnv()).toBe(true);
  });

  it("is disabled when no key is configured, even if the switch is on", () => {
    delete process.env.GEMINI_API_KEY;
    process.env.OMNI_ENABLED = "1";
    expect(omniEnabledFromEnv()).toBe(false);
  });
});
