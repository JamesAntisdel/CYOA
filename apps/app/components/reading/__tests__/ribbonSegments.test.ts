// Matrix coverage for the PURE StoryRibbon render model (design §1/§5, R3.1/
// R3.4). Runs the real `buildRibbonSegments` — no React, no I/O. Exercises:
// pursuit-first ordering (U1), each signal independently, the ≥80% two-stage
// candle segment (U4), and the all-absent ⇒ [] contract (RC2).
//
// Run: vitest (co-located config) —
//   convex/node_modules/.bin/vitest run -c apps/app/vitest.config.ts \
//     components/reading/__tests__/ribbonSegments.test.ts

import { describe, expect, it } from "vitest";

import {
  buildRibbonSegments,
  CANDLE_LOW_BURN,
  PAGE_COLUMN_MAX,
  PURSUIT_MAX,
  truncatePursuit,
} from "../chrome/ribbonSegments";

const keys = (input: Parameters<typeof buildRibbonSegments>[0]) =>
  buildRibbonSegments(input).map((s) => s.key);

const labelFor = (input: Parameters<typeof buildRibbonSegments>[0], key: string) =>
  buildRibbonSegments(input).find((s) => s.key === key)?.label;

describe("buildRibbonSegments — shared constants", () => {
  it("caps the page column at the widest layout (760, RC9)", () => {
    expect(PAGE_COLUMN_MAX).toBe(760);
  });
  it("the ribbon candle stage opens at 80% burn (U4 two-stage)", () => {
    expect(CANDLE_LOW_BURN).toBe(0.8);
  });
});

describe("buildRibbonSegments — all absent ⇒ []", () => {
  it("returns [] for an empty input (RC2, zero layout shift)", () => {
    expect(buildRibbonSegments({})).toEqual([]);
  });
  it("returns [] for arc-less / non-daily / door-less signals at zero", () => {
    expect(buildRibbonSegments({ threadsPending: 0, doorsCount: 0 })).toEqual([]);
    expect(buildRibbonSegments({ pursuit: "   " })).toEqual([]);
    expect(buildRibbonSegments({ pulseLine: "" })).toEqual([]);
  });
});

describe("buildRibbonSegments — each signal independently", () => {
  it("pursuit alone", () => {
    expect(keys({ pursuit: "Find the bell" })).toEqual(["pursuit"]);
    expect(labelFor({ pursuit: "Find the bell" }, "pursuit")).toBe("Find the bell");
  });
  it("threads alone, singular vs plural", () => {
    expect(labelFor({ threadsPending: 1 }, "threads")).toBe("1 thread");
    expect(labelFor({ threadsPending: 3 }, "threads")).toBe("3 threads");
  });
  it("doors alone, singular vs plural", () => {
    expect(labelFor({ doorsCount: 1 }, "doors")).toBe("1 door");
    expect(labelFor({ doorsCount: 4 }, "doors")).toBe("4 doors");
  });
  it("pulse alone renders its line verbatim", () => {
    const line = "62% of today's readers walked this way";
    expect(labelFor({ pulseLine: line }, "pulse")).toBe(line);
  });
});

describe("buildRibbonSegments — pursuit-first ordering (U1)", () => {
  it("pursuit leads, then compact counts", () => {
    expect(
      keys({ pursuit: "Find the bell", threadsPending: 2, doorsCount: 3, pulseLine: "62% walked" }),
    ).toEqual(["pursuit", "threads", "doors", "pulse"]);
  });
});

describe("buildRibbonSegments — two-stage candle (U4)", () => {
  it("no candle segment below 80% burn (only the top-bar wick applies)", () => {
    expect(keys({ candle: { turnsUsed: 6, turnsAllowed: 12 } })).toEqual([]);
    expect(keys({ candle: { turnsUsed: 9, turnsAllowed: 12 } })).toEqual([]); // 75%
  });
  it("candle segment appears at exactly 80% burn", () => {
    expect(keys({ candle: { turnsUsed: 8, turnsAllowed: 10 } })).toEqual(["candle"]);
  });
  it("candle segment LEADS the pursuit and counts when burned ≥80%", () => {
    expect(
      keys({
        candle: { turnsUsed: 10, turnsAllowed: 12 },
        pursuit: "Find the bell",
        threadsPending: 2,
      }),
    ).toEqual(["candle", "pursuit", "threads"]);
  });
  it("book-voice copy names the turns remaining, singular at one left", () => {
    expect(labelFor({ candle: { turnsUsed: 10, turnsAllowed: 12 } }, "candle")).toBe(
      "the candle burns low — 2 turns left",
    );
    expect(labelFor({ candle: { turnsUsed: 11, turnsAllowed: 12 } }, "candle")).toBe(
      "the candle burns low — 1 turn left",
    );
  });
  it("a zero-allowance candle never divides by zero", () => {
    expect(keys({ candle: { turnsUsed: 0, turnsAllowed: 0 } })).toEqual([]);
  });
});

describe("truncatePursuit — ≈40ch budget (R3.1)", () => {
  it("leaves a short phrase untouched", () => {
    expect(truncatePursuit("Find the bell before dawn")).toBe("Find the bell before dawn");
  });
  it("truncates an overlong phrase to the budget with a single ellipsis", () => {
    const long = "Will she reach the drowned bell before the tide swallows the last of the light?";
    const out = truncatePursuit(long);
    expect(out.length).toBeLessThanOrEqual(PURSUIT_MAX);
    expect(out.endsWith("…")).toBe(true);
  });
  it("respects an explicit budget", () => {
    expect(truncatePursuit("abcdefghij", 5)).toBe("abcd…");
  });
});
