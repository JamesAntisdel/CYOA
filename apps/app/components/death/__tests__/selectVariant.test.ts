import { describe, expect, it } from "vitest";

import { selectDeathVariant } from "../selectVariant";

const proTier = { canPlayCinematicDeath: true };
const freeTier = { canPlayCinematicDeath: false };

describe("selectDeathVariant", () => {
  it("renders Brutal by default for a death ending on a free tier", () => {
    expect(
      selectDeathVariant({
        tier: freeTier,
        isFirstFind: true,
        cinematicAvailable: true,
        endingKind: "death",
      }),
    ).toBe("brutal");
  });

  it("renders Bookish for tonal stories on a free tier", () => {
    expect(
      selectDeathVariant({
        tier: freeTier,
        isFirstFind: true,
        cinematicAvailable: false,
        storyTone: "bookish",
        endingKind: "death",
      }),
    ).toBe("bookish");
  });

  it("renders Cinematic for first-find death on Pro with a ready asset", () => {
    expect(
      selectDeathVariant({
        tier: proTier,
        isFirstFind: true,
        cinematicAvailable: true,
        endingKind: "death",
      }),
    ).toBe("cinematic");
  });

  it("never replays Cinematic for an already-seen ending", () => {
    expect(
      selectDeathVariant({
        tier: proTier,
        isFirstFind: false,
        cinematicAvailable: true,
        endingKind: "death",
      }),
    ).toBe("brutal");
  });

  it("never plays Cinematic when the Veo asset is not ready", () => {
    expect(
      selectDeathVariant({
        tier: proTier,
        isFirstFind: true,
        cinematicAvailable: false,
        endingKind: "death",
      }),
    ).toBe("brutal");
  });

  it("falls back to Bookish for tonal stories on Pro when Cinematic is ineligible", () => {
    expect(
      selectDeathVariant({
        tier: proTier,
        isFirstFind: false,
        cinematicAvailable: true,
        storyTone: "bookish",
        endingKind: "death",
      }),
    ).toBe("bookish");
  });

  it("never plays Cinematic for non-death endings", () => {
    expect(
      selectDeathVariant({
        tier: proTier,
        isFirstFind: true,
        cinematicAvailable: true,
        endingKind: "safe",
      }),
    ).toBe("brutal");
  });

  it("prefers Cinematic over tonal Bookish on first find at Pro", () => {
    expect(
      selectDeathVariant({
        tier: proTier,
        isFirstFind: true,
        cinematicAvailable: true,
        storyTone: "bookish",
        endingKind: "death",
      }),
    ).toBe("cinematic");
  });

  it("rejects Cinematic on a non-pro tier even with first-find + asset ready", () => {
    expect(
      selectDeathVariant({
        tier: freeTier,
        isFirstFind: true,
        cinematicAvailable: true,
        endingKind: "death",
      }),
    ).toBe("brutal");
  });
});
