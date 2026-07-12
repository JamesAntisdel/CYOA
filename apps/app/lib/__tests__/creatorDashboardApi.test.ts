// Creator dashboard client (Req 22.4/22.5): BC2 null-mapping adapter + the
// pure render models (quit sparkline bars, peak-turn headline, play-time
// formatting) that app/creator/dashboard.tsx draws.

import { describe, expect, it } from "vitest";

import {
  CREATOR_DASHBOARD_PATHS,
  adaptCreatorSeedStats,
  buildQuitBars,
  formatPlayTime,
  peakQuitTurn,
} from "../creatorDashboardApi";

function serverSeed(overrides: Record<string, unknown> = {}) {
  return {
    seedId: "seed1",
    storyId: "authored_seed:seed1",
    title: "Lantern Market",
    updatedAt: 10,
    plays: 9,
    selfPlays: 1,
    externalPlays: 8,
    inProgress: 1,
    completions: 2,
    deaths: 2,
    safeExits: 1,
    endings: [
      { endingId: "ending-careful", label: "A Clear Route", count: 2 },
      { endingId: "unknown", label: null, count: 1 },
    ],
    forks: 2,
    playSeconds: 640,
    externalPlaySeconds: 501,
    quitPoints: [
      { turnNumber: 3, count: 2 },
      { turnNumber: 6, count: 1 },
    ],
    ...overrides,
  };
}

describe("creatorDashboardApi — path contract (BC1)", () => {
  it("uses the full registered convex path", () => {
    expect(CREATOR_DASHBOARD_PATHS.getSeedStats).toBe("creatorDashboard:getSeedStats");
  });
});

describe("creatorDashboardApi — adaptCreatorSeedStats (BC2)", () => {
  it("maps a full payload, dropping null labels to absent keys (BC4)", () => {
    const [seed] = adaptCreatorSeedStats({ seeds: [serverSeed()] as never });
    expect(seed).toBeDefined();
    expect(seed!.title).toBe("Lantern Market");
    expect(seed!.plays).toBe(9);
    expect(seed!.endings[0]).toEqual({ endingId: "ending-careful", label: "A Clear Route", count: 2 });
    // null label → key absent entirely, not label: undefined.
    expect(seed!.endings[1]).toEqual({ endingId: "unknown", count: 1 });
    expect("label" in seed!.endings[1]!).toBe(false);
    expect(seed!.quitPoints).toEqual([
      { turnNumber: 3, count: 2 },
      { turnNumber: 6, count: 1 },
    ]);
  });

  it("tolerates a missing/garbage payload and malformed rows", () => {
    expect(adaptCreatorSeedStats(null)).toEqual([]);
    expect(adaptCreatorSeedStats(undefined)).toEqual([]);
    expect(adaptCreatorSeedStats({ seeds: null })).toEqual([]);
    expect(
      adaptCreatorSeedStats({
        seeds: [
          null,
          { seedId: 42 },
          serverSeed({ endings: null, quitPoints: null, plays: "many", title: "" }),
        ] as never,
      }),
    ).toEqual([
      expect.objectContaining({
        seedId: "seed1",
        title: "seed1", // empty title falls back to the id
        plays: 0, // garbage count → 0
        endings: [],
        quitPoints: [],
      }),
    ]);
  });
});

describe("creatorDashboardApi — buildQuitBars", () => {
  it("fills zero-count turns so the x-axis reads as story progress", () => {
    const bars = buildQuitBars([
      { turnNumber: 1, count: 2 },
      { turnNumber: 4, count: 4 },
    ]);
    expect(bars.map((bar) => bar.turnNumber)).toEqual([0, 1, 2, 3, 4]);
    expect(bars.map((bar) => bar.count)).toEqual([0, 2, 0, 0, 4]);
    // Ratios scale against the tallest bucket.
    expect(bars[4]!.ratio).toBe(1);
    expect(bars[1]!.ratio).toBe(0.5);
    expect(bars.every((bar) => !bar.overflow)).toBe(true);
  });

  it("folds the long tail into one overflow bucket", () => {
    const bars = buildQuitBars(
      [
        { turnNumber: 2, count: 3 },
        { turnNumber: 40, count: 1 },
        { turnNumber: 55, count: 1 },
      ],
      12,
    );
    expect(bars).toHaveLength(13); // turns 0..11 + the "12+" bucket
    const overflow = bars[bars.length - 1]!;
    expect(overflow).toMatchObject({ turnNumber: 12, count: 2, overflow: true });
  });

  it("returns [] with nothing to draw", () => {
    expect(buildQuitBars([])).toEqual([]);
    expect(buildQuitBars([{ turnNumber: 3, count: 0 }])).toEqual([]);
  });
});

describe("creatorDashboardApi — peakQuitTurn + formatPlayTime", () => {
  it("names the turn where the most readers drifted away", () => {
    expect(
      peakQuitTurn([
        { turnNumber: 2, count: 1 },
        { turnNumber: 5, count: 4 },
        { turnNumber: 9, count: 2 },
      ]),
    ).toBe(5);
    expect(peakQuitTurn([])).toBeNull();
    expect(peakQuitTurn([{ turnNumber: 1, count: 0 }])).toBeNull();
  });

  it("formats attributed play time compactly", () => {
    expect(formatPlayTime(0)).toBe("<1m");
    expect(formatPlayTime(59)).toBe("<1m");
    expect(formatPlayTime(60)).toBe("1m");
    expect(formatPlayTime(59 * 60)).toBe("59m");
    expect(formatPlayTime(2 * 3600 + 5 * 60)).toBe("2h 05m");
    expect(formatPlayTime(Number.NaN)).toBe("<1m");
  });
});
