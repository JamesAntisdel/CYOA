// reader-chrome-declutter 3.4 (RB-COUNTS) — the collapsed StoryRibbon contract
// for the counts this task threads. Runs the REAL buildRibbonSegments (the
// render model StoryRibbon feeds from) to prove the doors + daily-pulse
// segments the reporter callbacks surface (a) appear when present and (b) omit
// at zero-state (RC2 — zero layout shift). Pure, no React, no I/O.
//
// Run: convex/node_modules/.bin/vitest run -c apps/app/vitest.config.ts \
//   components/reading/__tests__/ribbonCounts.test.ts

import { describe, expect, it } from "vitest";

import { buildRibbonSegments } from "../chrome/ribbonSegments";

const keys = (input: Parameters<typeof buildRibbonSegments>[0]) =>
  buildRibbonSegments(input).map((s) => s.key);
const labelFor = (input: Parameters<typeof buildRibbonSegments>[0], key: string) =>
  buildRibbonSegments(input).find((s) => s.key === key)?.label;

describe("RB-COUNTS — DoorsJournal count → collapsed doors segment", () => {
  it("shows the doors segment when the reporter surfaces a positive count", () => {
    expect(labelFor({ doorsCount: 3 }, "doors")).toBe("3 doors");
    expect(labelFor({ doorsCount: 1 }, "doors")).toBe("1 door");
  });

  it("omits the doors segment at the zero-state the reporter fires (RC2)", () => {
    // onCount(0) — no doors, transport failure, or no remote auth.
    expect(keys({ doorsCount: 0 })).not.toContain("doors");
    // Never threaded (undefined) — arc-less/local save.
    expect(keys({})).not.toContain("doors");
  });
});

describe("RB-COUNTS — DailyPulseChip compact line → collapsed pulse segment", () => {
  it("shows the compact percentage line the chip surfaces (§3 mock '· 62%')", () => {
    expect(labelFor({ pulseLine: "62%" }, "pulse")).toBe("62%");
  });

  it("omits the pulse segment when no committed entry fired a line (RC2)", () => {
    // The chip never fires at zero-state, so pulseLine stays undefined.
    expect(keys({})).not.toContain("pulse");
    // Defensive: an empty string still self-hides.
    expect(keys({ pulseLine: "" })).not.toContain("pulse");
  });
});

describe("RB-COUNTS — the §3 mock collapsed row assembles from the threaded counts", () => {
  it("pursuit · threads · doors · pulse, in order", () => {
    const segs = buildRibbonSegments({
      pursuit: "Find the bell before dawn",
      threadsPending: 2,
      doorsCount: 3,
      pulseLine: "62%",
    });
    expect(segs.map((s) => s.label)).toEqual([
      "Find the bell before dawn",
      "2 threads",
      "3 doors",
      "62%",
    ]);
  });
});
