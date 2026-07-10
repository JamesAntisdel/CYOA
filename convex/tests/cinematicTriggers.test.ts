// Pure unit tests for the cinematic-trigger predicates (omni-cinematics P1).
// No Convex DB — these pin the trigger contract (ending + opening only; no
// chapter/arc-beat per build-corrections C1/C2) and the dedupe key (C5).

import { describe, expect, it } from "vitest";

import {
  cinematicAlreadyExists,
  chapterCinematicExistsForScene,
  countChapterCinematics,
  detectChapterCinematicTrigger,
  detectEndingCinematicTrigger,
  shouldFireOpeningCinematic,
  CHAPTER_CINEMATIC_TURNS,
  MAX_CHAPTER_CINEMATICS_PER_RUN,
  type CinematicAssetLike,
} from "../media/cinematicTriggers";

describe("detectEndingCinematicTrigger", () => {
  it("returns 'ending' for a death terminal", () => {
    expect(detectEndingCinematicTrigger({}, { kind: "death", endingId: "e1" })).toBe("ending");
  });

  it("returns 'ending' for success and safe terminals (kind-agnostic)", () => {
    expect(detectEndingCinematicTrigger({}, { kind: "success", endingId: "win" })).toBe("ending");
    expect(detectEndingCinematicTrigger({}, { kind: "safe", endingId: "ending-safe" })).toBe("ending");
  });

  it("returns 'ending' when only an endingId is present", () => {
    expect(detectEndingCinematicTrigger({}, { endingId: "e9" })).toBe("ending");
  });

  it("returns null when there is no terminal", () => {
    expect(detectEndingCinematicTrigger({}, null)).toBeNull();
    expect(detectEndingCinematicTrigger({}, undefined)).toBeNull();
  });

  it("returns null for a malformed empty terminal", () => {
    expect(detectEndingCinematicTrigger({}, {})).toBeNull();
  });
});

describe("shouldFireOpeningCinematic (C3)", () => {
  it("is false before any turn-1 anchor has landed", () => {
    expect(shouldFireOpeningCinematic({})).toBe(false);
    expect(shouldFireOpeningCinematic({ turnNumber: 1 })).toBe(false);
  });

  it("fires once the protagonist anchor id is present", () => {
    expect(shouldFireOpeningCinematic({ anchorProtagonistAssetId: "a1" })).toBe(true);
  });

  it("fires on the setting anchor alone too", () => {
    expect(shouldFireOpeningCinematic({ anchorSettingAssetId: "s1" })).toBe(true);
  });
});

describe("cinematicAlreadyExists (dedupe, C5)", () => {
  const opening: CinematicAssetLike = {
    kind: "cinematic",
    status: "queued",
    cinematicTrigger: "opening",
  };
  const endingE1: CinematicAssetLike = {
    kind: "cinematic",
    status: "ready",
    cinematicTrigger: "ending",
    endingId: "e1",
  };

  it("dedupes a second opening", () => {
    expect(cinematicAlreadyExists([opening], { trigger: "opening" })).toBe(true);
  });

  it("dedupes an ending by (trigger, endingId)", () => {
    expect(cinematicAlreadyExists([endingE1], { trigger: "ending", endingId: "e1" })).toBe(true);
  });

  it("does NOT dedupe a different ending in the same save", () => {
    expect(cinematicAlreadyExists([endingE1], { trigger: "ending", endingId: "e2" })).toBe(false);
  });

  it("ignores failed rows so they can be re-queued", () => {
    const failed: CinematicAssetLike = { ...endingE1, status: "failed" };
    expect(cinematicAlreadyExists([failed], { trigger: "ending", endingId: "e1" })).toBe(false);
  });

  it("ignores non-cinematic asset rows", () => {
    const image: CinematicAssetLike = { kind: "image", status: "ready" };
    expect(cinematicAlreadyExists([image], { trigger: "opening" })).toBe(false);
  });

  it("does not cross-match trigger types", () => {
    expect(cinematicAlreadyExists([opening], { trigger: "ending", endingId: "e1" })).toBe(false);
  });
});

describe("detectChapterCinematicTrigger (P2 server cadence, C1)", () => {
  it("fires on the server turn-number cadence, not the client CHAPTER_TURNS=4", () => {
    // The client notion is every 4 turns; the SERVER cadence is deliberately
    // different (and larger) so stingers stay rare and Convex-detectable.
    expect(CHAPTER_CINEMATIC_TURNS).toBeGreaterThan(4);
    expect(detectChapterCinematicTrigger({ turnNumber: CHAPTER_CINEMATIC_TURNS })).toBe("chapter");
    expect(detectChapterCinematicTrigger({ turnNumber: CHAPTER_CINEMATIC_TURNS * 2 })).toBe("chapter");
    // A client-chapter boundary (turn 4) is NOT a server-cadence boundary.
    expect(detectChapterCinematicTrigger({ turnNumber: 4 })).toBeNull();
  });

  it("never fires on the opening turn or between boundaries", () => {
    expect(detectChapterCinematicTrigger({ turnNumber: 0 })).toBeNull();
    expect(detectChapterCinematicTrigger({ turnNumber: CHAPTER_CINEMATIC_TURNS - 1 })).toBeNull();
    expect(detectChapterCinematicTrigger({ turnNumber: CHAPTER_CINEMATIC_TURNS + 1 })).toBeNull();
  });

  it("is null for missing / invalid turn numbers", () => {
    expect(detectChapterCinematicTrigger({})).toBeNull();
    expect(detectChapterCinematicTrigger({ turnNumber: -6 })).toBeNull();
    expect(detectChapterCinematicTrigger({ turnNumber: Number.NaN })).toBeNull();
  });
});

describe("chapter cap + per-scene dedupe (Req 8.2 / C5)", () => {
  const chapterAt = (sceneId: string, status = "ready"): CinematicAssetLike => ({
    kind: "cinematic",
    status,
    cinematicTrigger: "chapter",
    sceneId,
  });

  it("counts only non-failed chapter cinematics", () => {
    expect(countChapterCinematics([])).toBe(0);
    expect(
      countChapterCinematics([chapterAt("s1"), chapterAt("s2", "failed"), chapterAt("s3", "generating")]),
    ).toBe(2);
    // Openings / endings never count toward the chapter cap.
    expect(
      countChapterCinematics([
        { kind: "cinematic", status: "ready", cinematicTrigger: "opening" },
        chapterAt("s1"),
      ]),
    ).toBe(1);
  });

  it("caps the run at MAX_CHAPTER_CINEMATICS_PER_RUN", () => {
    const atCap = Array.from({ length: MAX_CHAPTER_CINEMATICS_PER_RUN }, (_, i) => chapterAt(`s${i}`));
    expect(countChapterCinematics(atCap) >= MAX_CHAPTER_CINEMATICS_PER_RUN).toBe(true);
  });

  it("dedupes a re-fire at the SAME scene but allows the next boundary", () => {
    const existing = [chapterAt("scene-6")];
    expect(chapterCinematicExistsForScene(existing, "scene-6")).toBe(true);
    expect(chapterCinematicExistsForScene(existing, "scene-12")).toBe(false);
    // A failed chapter at the scene doesn't block a re-queue.
    expect(chapterCinematicExistsForScene([chapterAt("scene-6", "failed")], "scene-6")).toBe(false);
    // No sceneId → nothing to dedupe against.
    expect(chapterCinematicExistsForScene(existing, undefined)).toBe(false);
  });
});
