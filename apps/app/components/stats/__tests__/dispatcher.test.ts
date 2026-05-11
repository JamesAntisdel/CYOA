import { describe, expect, it } from "vitest";

import {
  diffVisibleStats,
  shouldBubbleReceiptsAtDispatcher,
  statsHudModeFromSetting,
} from "../types";

describe("StatsHud dispatcher logic", () => {
  it("switches modes based on the persisted setting", () => {
    expect(statsHudModeFromSetting("full")).toBe("persistent");
    expect(statsHudModeFromSetting("quiet")).toBe("peekDrawer");
    expect(statsHudModeFromSetting("hidden")).toBe("contextual");
  });

  it("bubbles stat pips at the dispatcher in every mode except Contextual", () => {
    expect(shouldBubbleReceiptsAtDispatcher("persistent")).toBe(true);
    expect(shouldBubbleReceiptsAtDispatcher("peekDrawer")).toBe(true);
    expect(shouldBubbleReceiptsAtDispatcher("fullSheet")).toBe(true);
    // Contextual mode renders its own inline pips. Suppress duplicates.
    expect(shouldBubbleReceiptsAtDispatcher("contextual")).toBe(false);
  });

  it("renders a pip for every visible stat that changed", () => {
    const previous = { vitality: 20, nerve: 3, insight: 2 };
    const next = { vitality: 15, nerve: 4, insight: 2 };
    const diffs = diffVisibleStats(previous, next, undefined);
    expect(
      diffs.map((diff) => ({ key: diff.key, delta: diff.delta, value: diff.value })),
    ).toEqual([
      { key: "vitality", delta: -5, value: 15 },
      { key: "nerve", delta: 1, value: 4 },
    ]);
  });

  it("never produces a pip for a hidden stat — even if it changes", () => {
    const previous = { vitality: 20, nerve: 3, insight: 2 };
    const next = { vitality: 20, nerve: 3, insight: 9 };
    const diffs = diffVisibleStats(previous, next, ["insight"]);
    expect(diffs).toEqual([]);
  });
});
