import { describe, expect, it } from "vitest";

import {
  diffVisibleStats,
  filterVisibleStats,
  statsHudModeFromSetting,
} from "../types";

describe("statsHudModeFromSetting", () => {
  it("maps the three settings values onto the four design modes", () => {
    expect(statsHudModeFromSetting("full")).toBe("persistent");
    expect(statsHudModeFromSetting("quiet")).toBe("peekDrawer");
    expect(statsHudModeFromSetting("hidden")).toBe("contextual");
  });

  it("uses PeekDrawer as the conservative default (canvas: 'best balance')", () => {
    const fallback = statsHudModeFromSetting(
      "garbage" as unknown as "full" | "quiet" | "hidden",
    );
    expect(fallback).toBe("peekDrawer");
  });
});

describe("filterVisibleStats", () => {
  const stats = { vitality: 4, nerve: 3, insight: 2 } as const;

  it("returns every stat when none are hidden", () => {
    const out = filterVisibleStats(stats, undefined);
    expect(out.map((entry) => entry.key)).toEqual(["vitality", "nerve", "insight"]);
  });

  it("omits stats flagged hidden by id", () => {
    const out = filterVisibleStats(stats, ["insight"]);
    expect(out.map((entry) => entry.key)).toEqual(["vitality", "nerve"]);
    expect(out.some((entry) => entry.key === "insight")).toBe(false);
  });

  it("treats unknown hidden ids as no-ops", () => {
    const out = filterVisibleStats(stats, ["resolve"]);
    expect(out).toHaveLength(3);
  });
});

describe("diffVisibleStats", () => {
  const previous = { vitality: 4, nerve: 3, insight: 2 } as const;

  it("returns empty when there is no previous snapshot (first render)", () => {
    expect(diffVisibleStats(null, previous, undefined)).toEqual([]);
  });

  it("returns empty when stats are unchanged", () => {
    expect(diffVisibleStats(previous, previous, undefined)).toEqual([]);
  });

  it("returns signed deltas with current values", () => {
    const next = { vitality: 2, nerve: 4, insight: 2 };
    const diffs = diffVisibleStats(previous, next, undefined);
    expect(diffs).toHaveLength(2);
    const vitality = diffs.find((diff) => diff.key === "vitality");
    const nerve = diffs.find((diff) => diff.key === "nerve");
    expect(vitality?.delta).toBe(-2);
    expect(vitality?.value).toBe(2);
    expect(nerve?.delta).toBe(1);
    expect(nerve?.value).toBe(4);
  });

  it("never surfaces hidden stats in deltas", () => {
    const next = { vitality: 4, nerve: 3, insight: 5 };
    const diffs = diffVisibleStats(previous, next, ["insight"]);
    expect(diffs).toEqual([]);
  });
});
