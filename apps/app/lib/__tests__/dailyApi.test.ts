import { describe, expect, it } from "vitest";

import {
  adaptChoicePulse,
  adaptChoicePulseResult,
  adaptDailyResults,
  adaptDailyToday,
  buildDistributionModel,
  buildOpeningForkTiles,
  countdownParts,
  DAILY_PATHS,
  distributionShareLine,
  formatCountdown,
  msUntilNextUtcMidnight,
  newestCommittedPulse,
  nextDailyCountdown,
  openingChoicesFromRunHistory,
  pulseChipLabel,
  type RemotePulseEntry,
} from "../dailyApi";

describe("BC1 — daily convex paths are full registered paths", () => {
  it("prefixes each function with the dailyFunctions directory", () => {
    expect(DAILY_PATHS.getToday).toBe("dailyFunctions:getToday");
    expect(DAILY_PATHS.startDaily).toBe("dailyFunctions:startDaily");
    expect(DAILY_PATHS.getResults).toBe("dailyFunctions:getResults");
    // Daily Killcam — full BC1 path.
    expect(DAILY_PATHS.getChoicePulse).toBe("dailyFunctions:getChoicePulse");
  });
});

describe("adaptChoicePulse (Daily Killcam — BC2/BC5 tolerance)", () => {
  it("maps a well-formed payload 1:1 and sorts by turn number", () => {
    const pulses = adaptChoicePulse({
      pulses: [
        { turnNumber: 3, sharePct: 12, sameCount: 6, totalReaders: 50, phrase: "the road less traveled" },
        { turnNumber: 1, sharePct: 62, sameCount: 31, totalReaders: 50, phrase: "the well-worn path" },
      ],
    });
    expect(pulses.map((p) => p.turnNumber)).toEqual([1, 3]);
    expect(pulses[0]).toEqual({
      turnNumber: 1,
      sharePct: 62,
      sameCount: 31,
      totalReaders: 50,
      phrase: "the well-worn path",
    });
  });

  it("returns an empty array for any malformed / missing payload", () => {
    expect(adaptChoicePulse(null)).toEqual([]);
    expect(adaptChoicePulse(undefined)).toEqual([]);
    expect(adaptChoicePulse({ pulses: null })).toEqual([]);
    expect(adaptChoicePulse({ pulses: "nope" as any })).toEqual([]);
  });

  it("drops individual malformed buckets rather than surfacing them", () => {
    const pulses = adaptChoicePulse({
      pulses: [
        { turnNumber: 1, sharePct: 40, sameCount: 4, totalReaders: 10, phrase: "a common thread" },
        { turnNumber: 2, sharePct: Number.NaN, sameCount: 2, totalReaders: 10, phrase: "x" } as any,
        { turnNumber: 3, sharePct: 20, sameCount: 2, totalReaders: 10 } as any, // no phrase
        null as any,
      ],
    });
    expect(pulses.map((p) => p.turnNumber)).toEqual([1]);
  });

  it("clamps sharePct into 0–100 without re-deriving it (DK5)", () => {
    const pulses = adaptChoicePulse({
      pulses: [
        { turnNumber: 1, sharePct: 140, sameCount: 1, totalReaders: 10, phrase: "p" },
        { turnNumber: 2, sharePct: -5, sameCount: 1, totalReaders: 10, phrase: "p" },
      ],
    });
    expect(pulses[0]!.sharePct).toBe(100);
    expect(pulses[1]!.sharePct).toBe(0);
  });

  it("defaults non-finite counts to zero", () => {
    const pulses = adaptChoicePulse({
      pulses: [{ turnNumber: 1, sharePct: 50, sameCount: Number.NaN, totalReaders: Infinity, phrase: "p" } as any],
    });
    expect(pulses[0]!.sameCount).toBe(0);
    expect(pulses[0]!.totalReaders).toBe(0);
  });
});

describe("pulseChipLabel (R3.4 — copy scoped to 'today's readers', verbatim %)", () => {
  it("renders the percentage verbatim joined to the server phrase", () => {
    const entry: RemotePulseEntry = {
      turnNumber: 1,
      sharePct: 62,
      sameCount: 31,
      totalReaders: 50,
      phrase: "the well-worn path",
    };
    expect(pulseChipLabel(entry)).toBe("62% of today's readers · the well-worn path");
  });

  it("always scopes the claim to today's readers, never 'all readers'", () => {
    const label = pulseChipLabel({
      turnNumber: 2,
      sharePct: 8,
      sameCount: 4,
      totalReaders: 50,
      phrase: "the road less traveled",
    });
    expect(label).toContain("today's readers");
    expect(label).not.toContain("all readers");
  });
});

describe("newestCommittedPulse (chip gating — self-hide on uncommitted turn)", () => {
  const pulses: RemotePulseEntry[] = [
    { turnNumber: 1, sharePct: 62, sameCount: 31, totalReaders: 50, phrase: "a" },
    { turnNumber: 2, sharePct: 40, sameCount: 20, totalReaders: 50, phrase: "b" },
    { turnNumber: 3, sharePct: 10, sameCount: 5, totalReaders: 50, phrase: "c" },
  ];

  it("returns the highest-turn entry at or below the completed turn", () => {
    expect(newestCommittedPulse(pulses, 2)?.turnNumber).toBe(2);
    expect(newestCommittedPulse(pulses, 5)?.turnNumber).toBe(3);
  });

  it("returns null when every entry is for an uncommitted turn", () => {
    expect(newestCommittedPulse(pulses, 0)).toBe(null);
  });

  it("returns null on an empty pulse list", () => {
    expect(newestCommittedPulse([], 3)).toBe(null);
  });
});

describe("buildOpeningForkTiles (R3.2 — reader's own label ⋈ pulse, hide-when-empty)", () => {
  const pulses: RemotePulseEntry[] = [
    { turnNumber: 1, sharePct: 62, sameCount: 31, totalReaders: 50, phrase: "the well-worn path" },
    { turnNumber: 2, sharePct: 40, sameCount: 20, totalReaders: 50, phrase: "a common thread" },
  ];

  it("joins the reader's own label to each pulse bucket by turn, sorted by turn", () => {
    const tiles = buildOpeningForkTiles(
      [
        { turnNumber: 2, choiceLabel: "Row toward the dark" },
        { turnNumber: 1, choiceLabel: "Answer the signal" },
      ],
      pulses,
    );
    expect(tiles.map((t) => t.turnNumber)).toEqual([1, 2]);
    expect(tiles[0]!.label).toBe("Answer the signal");
    expect(tiles[0]!.entry.phrase).toBe("the well-worn path");
  });

  it("omits a pulse bucket with no matching reader label (inner join)", () => {
    const tiles = buildOpeningForkTiles([{ turnNumber: 1, choiceLabel: "Answer the signal" }], pulses);
    expect(tiles.map((t) => t.turnNumber)).toEqual([1]);
  });

  it("prefers the reader's latest label for a replayed (rewound) turn", () => {
    const tiles = buildOpeningForkTiles(
      [
        { turnNumber: 1, choiceLabel: "Old choice" },
        { turnNumber: 1, choiceLabel: "Re-chosen after rewind" },
      ],
      [pulses[0]!],
    );
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.label).toBe("Re-chosen after rewind");
  });

  it("hides (empty result) when the pulse is empty or no labels match", () => {
    expect(buildOpeningForkTiles([{ turnNumber: 1, choiceLabel: "x" }], [])).toEqual([]);
    expect(buildOpeningForkTiles([], pulses)).toEqual([]);
    expect(buildOpeningForkTiles([{ turnNumber: 9, choiceLabel: "x" }], pulses)).toEqual([]);
  });
});

describe("adaptChoicePulseResult (4.3 — pulses + reader's own save id)", () => {
  it("maps the pulses and coerces a present readerSaveId", () => {
    const out = adaptChoicePulseResult({
      pulses: [{ turnNumber: 1, sharePct: 62, sameCount: 31, totalReaders: 50, phrase: "the well-worn path" }],
      readerSaveId: "save-abc",
    });
    expect(out.readerSaveId).toBe("save-abc");
    expect(out.pulses).toHaveLength(1);
    expect(out.pulses[0]!.turnNumber).toBe(1);
  });

  it("degrades a missing / empty / garbage readerSaveId to null (strip self-skips)", () => {
    expect(adaptChoicePulseResult({ pulses: null, readerSaveId: null }).readerSaveId).toBeNull();
    expect(adaptChoicePulseResult({ pulses: [], readerSaveId: "" }).readerSaveId).toBeNull();
    expect(adaptChoicePulseResult({ pulses: [], readerSaveId: 42 as any }).readerSaveId).toBeNull();
    expect(adaptChoicePulseResult(null).readerSaveId).toBeNull();
    expect(adaptChoicePulseResult(undefined).pulses).toEqual([]);
  });
});

describe("openingChoicesFromRunHistory (4.3 — reader's OWN labels from history, BC10)", () => {
  it("projects each turn's inbound choice label to {turnNumber, choiceLabel}", () => {
    const out = openingChoicesFromRunHistory({
      turns: [
        { turnNumber: 1, choice: { choiceLabel: "Answer the signal" } },
        { turnNumber: 2, choice: { choiceLabel: "Row toward the dark" } },
        { turnNumber: 3, choice: { choiceLabel: "Wait on the shore" } },
      ],
    });
    expect(out).toEqual([
      { turnNumber: 1, choiceLabel: "Answer the signal" },
      { turnNumber: 2, choiceLabel: "Row toward the dark" },
      { turnNumber: 3, choiceLabel: "Wait on the shore" },
    ]);
  });

  it("drops turns with no inbound choice (e.g. the opening) or an empty label", () => {
    const out = openingChoicesFromRunHistory({
      turns: [
        { turnNumber: 0 },
        { turnNumber: 1, choice: { choiceLabel: "" } },
        { turnNumber: 2, choice: { choiceLabel: "Kept" } },
      ],
    });
    expect(out).toEqual([{ turnNumber: 2, choiceLabel: "Kept" }]);
  });

  it("tolerates a missing / malformed history (BC2 → empty list, strip hides)", () => {
    expect(openingChoicesFromRunHistory(null)).toEqual([]);
    expect(openingChoicesFromRunHistory(undefined)).toEqual([]);
    expect(openingChoicesFromRunHistory({})).toEqual([]);
    expect(openingChoicesFromRunHistory({ turns: "nope" as any })).toEqual([]);
  });

  it("round-trips through buildOpeningForkTiles to the reader's own tiles", () => {
    const pulses: RemotePulseEntry[] = [
      { turnNumber: 1, sharePct: 62, sameCount: 31, totalReaders: 50, phrase: "the well-worn path" },
    ];
    const choices = openingChoicesFromRunHistory({
      turns: [
        { turnNumber: 0 },
        { turnNumber: 1, choice: { choiceLabel: "Answer the signal" } },
      ],
    });
    const tiles = buildOpeningForkTiles(choices, pulses);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.label).toBe("Answer the signal");
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
