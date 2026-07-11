import { describe, expect, it } from "vitest";

import {
  adaptDailyResults,
  adaptDailyToday,
  buildDistributionModel,
  countdownParts,
  DAILY_PATHS,
  distributionShareLine,
  formatCountdown,
  msUntilNextUtcMidnight,
  nextDailyCountdown,
} from "../dailyApi";

describe("BC1 — daily convex paths are full registered paths", () => {
  it("prefixes each function with the dailyFunctions directory", () => {
    expect(DAILY_PATHS.getToday).toBe("dailyFunctions:getToday");
    expect(DAILY_PATHS.startDaily).toBe("dailyFunctions:startDaily");
    expect(DAILY_PATHS.getResults).toBe("dailyFunctions:getResults");
  });
});

describe("adaptDailyToday (BC2 null-mapping)", () => {
  it("returns null when there is no Daily for today", () => {
    expect(adaptDailyToday({ daily: null })).toBe(null);
    expect(adaptDailyToday(null)).toBe(null);
    expect(adaptDailyToday(undefined)).toBe(null);
  });

  it("maps a populated Daily to the card model", () => {
    const card = adaptDailyToday({
      daily: {
        dailyId: "d1",
        date: "2026-07-10",
        title: "The Drowned Crown",
        questionTeaser: "Will you keep the ferryman's bargain?",
        played: true,
      },
    });
    expect(card).toEqual({
      dailyId: "d1",
      date: "2026-07-10",
      title: "The Drowned Crown",
      questionTeaser: "Will you keep the ferryman's bargain?",
      played: true,
    });
  });

  it("defaults a missing played flag to false (not yet played)", () => {
    const card = adaptDailyToday({
      daily: { dailyId: "d1", date: "2026-07-10", title: "t", questionTeaser: "q" } as any,
    });
    expect(card?.played).toBe(false);
  });

  it("drops a payload with no dailyId", () => {
    expect(adaptDailyToday({ daily: { title: "t" } as any })).toBe(null);
  });
});

describe("adaptDailyResults (BC2 null-mapping)", () => {
  it("maps null firstAccountName to an absent optional field", () => {
    const model = adaptDailyResults({
      yours: { endingId: "e1", label: "The Drowned Crown" },
      distribution: [
        { endingId: "e1", label: "The Drowned Crown", count: 3, pct: 30, firstAccountName: null },
        { endingId: "e2", label: "The Iron Vow", count: 7, pct: 70, firstAccountName: "Mara" },
      ],
    });
    expect(model.yours).toEqual({ endingId: "e1", label: "The Drowned Crown" });
    expect(model.distribution[0]).not.toHaveProperty("firstAccountName");
    expect(model.distribution[1]!.firstAccountName).toBe("Mara");
  });

  it("tolerates a missing/garbage payload", () => {
    expect(adaptDailyResults(null)).toEqual({ yours: null, distribution: [] });
    expect(adaptDailyResults({ yours: null, distribution: null })).toEqual({
      yours: null,
      distribution: [],
    });
  });

  it("labels yours from the endingId when the server omits a label", () => {
    const model = adaptDailyResults({ yours: { endingId: "e9" } as any, distribution: [] });
    expect(model.yours).toEqual({ endingId: "e9", label: "e9" });
  });
});

describe("countdown math (ms to next UTC 00:00)", () => {
  it("computes the remaining ms until the next UTC midnight", () => {
    // 2026-07-10T22:00:00Z → 2h remain.
    const now = Date.UTC(2026, 6, 10, 22, 0, 0);
    expect(msUntilNextUtcMidnight(now)).toBe(2 * 3600 * 1000);
  });

  it("returns a full day at exactly UTC midnight", () => {
    const now = Date.UTC(2026, 6, 10, 0, 0, 0);
    expect(msUntilNextUtcMidnight(now)).toBe(24 * 3600 * 1000);
  });

  it("breaks a span into whole h/m/s", () => {
    expect(countdownParts(2 * 3600_000 + 5 * 60_000 + 9_000)).toEqual({
      hours: 2,
      minutes: 5,
      seconds: 9,
    });
    expect(countdownParts(-5)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
  });

  it("formats hours+minutes above an hour and minutes+seconds within the last hour", () => {
    expect(formatCountdown(7 * 3600_000 + 23 * 60_000)).toBe("7h 23m");
    expect(formatCountdown(23 * 60_000 + 4_000)).toBe("23m 04s");
    expect(formatCountdown(0)).toBe("0m 00s");
  });

  it("nextDailyCountdown composes the two helpers", () => {
    const now = Date.UTC(2026, 6, 10, 16, 30, 0); // 7h30m to midnight
    expect(nextDailyCountdown(now)).toBe("7h 30m");
  });
});

describe("distribution render model (sorted, rarest + first-finder)", () => {
  const results = {
    yours: { endingId: "e2", label: "The Iron Vow" },
    distribution: [
      { endingId: "e1", label: "The Drowned Crown", count: 10, pct: 50 },
      { endingId: "e2", label: "The Iron Vow", count: 8, pct: 40 },
      { endingId: "e3", label: "The Ashen Road", count: 2, pct: 10, firstAccountName: "Sol" },
    ],
  };

  it("sorts bars most-common-first", () => {
    const model = buildDistributionModel(results);
    expect(model.bars.map((b) => b.endingId)).toEqual(["e1", "e2", "e3"]);
    expect(model.total).toBe(20);
  });

  it("marks the reader's own ending", () => {
    const model = buildDistributionModel(results);
    expect(model.bars.find((b) => b.isYours)?.endingId).toBe("e2");
  });

  it("marks the rarest reached ending and exposes it as a callout", () => {
    const model = buildDistributionModel(results);
    expect(model.rarest?.endingId).toBe("e3");
    expect(model.bars.find((b) => b.isRarest)?.endingId).toBe("e3");
    expect(model.rarest?.hasFirstFinder).toBe(true);
  });

  it("has no rarest when nobody has finished", () => {
    const model = buildDistributionModel({ yours: null, distribution: [] });
    expect(model.rarest).toBe(null);
    expect(model.total).toBe(0);
  });

  it("breaks count ties by label for stable ordering", () => {
    const model = buildDistributionModel({
      yours: null,
      distribution: [
        { endingId: "b", label: "Beta", count: 5, pct: 50 },
        { endingId: "a", label: "Alpha", count: 5, pct: 50 },
      ],
    });
    expect(model.bars.map((b) => b.label)).toEqual(["Alpha", "Beta"]);
  });

  it("renders the share line", () => {
    expect(distributionShareLine({ endingId: "e3", label: "x", count: 2, pct: 9.6 })).toBe(
      "10% of readers found this",
    );
  });
});
