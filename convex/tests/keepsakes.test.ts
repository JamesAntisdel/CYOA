import { describe, expect, it } from "vitest";

import {
  KEEPSAKE_CARRIED,
  KEEPSAKE_GRANTED,
  STREAK_KEEPSAKE_INTERVAL,
  deriveDefaultKeepsake,
  dedupeKeepsakes,
  streakKeepsake,
  validateKeepsake,
} from "../keepsakes";

describe("deriveDefaultKeepsake (W3-M1)", () => {
  it("derives id/label/description from the ending", () => {
    const k = deriveDefaultKeepsake({ id: "The Drowned Crown", label: "The Drowned Crown", hint: "You wore it once." });
    expect(k).toEqual({
      id: "the-drowned-crown",
      label: "The Drowned Crown",
      description: "You wore it once.",
    });
  });

  it("falls back to a themed description when the ending has no hint", () => {
    const k = deriveDefaultKeepsake({ id: "triumph", label: "Hard-won Triumph" });
    expect(k.id).toBe("triumph");
    expect(k.label).toBe("Hard-won Triumph");
    expect(k.description).toContain("Hard-won Triumph");
  });

  it("clamps an over-long label + description and never yields empties", () => {
    const k = deriveDefaultKeepsake({ id: "x", label: "L".repeat(200), hint: "D".repeat(400) });
    expect(k.label.length).toBe(48);
    expect(k.description.length).toBe(160);
  });

  it("stays total on a blank ending", () => {
    const k = deriveDefaultKeepsake({ id: "", label: "" });
    expect(k.id).toBe("keepsake");
    expect(k.label).toBe("A keepsake");
    expect(k.description.length).toBeGreaterThan(0);
  });
});

describe("validateKeepsake (W3-M1)", () => {
  it("accepts + slugifies + clamps a well-formed keepsake", () => {
    const k = validateKeepsake({ id: "Bone Key", label: "The Bone Key", description: "Cold iron." });
    expect(k).toEqual({ id: "bone-key", label: "The Bone Key", description: "Cold iron." });
  });

  it("rejects missing / blank required fields", () => {
    expect(validateKeepsake({ id: "x", label: "", description: "d" })).toBeNull();
    expect(validateKeepsake({ id: "", label: "l", description: "d" })).toBeNull();
    expect(validateKeepsake({ id: "x", label: "l" })).toBeNull();
    expect(validateKeepsake(null)).toBeNull();
    expect(validateKeepsake("nope")).toBeNull();
  });

  it("clamps over-long fields", () => {
    const k = validateKeepsake({ id: "x", label: "L".repeat(80), description: "D".repeat(400) });
    expect(k?.label.length).toBe(48);
    expect(k?.description.length).toBe(160);
  });
});

describe("dedupeKeepsakes (W3-M1)", () => {
  it("keeps first occurrence per id, order preserved", () => {
    const out = dedupeKeepsakes([
      { id: "a", label: "A1", description: "d" },
      { id: "b", label: "B", description: "d" },
      { id: "a", label: "A2", description: "d" },
    ]);
    expect(out.map((k) => k.label)).toEqual(["A1", "B"]);
  });

  it("skips entries without a usable id", () => {
    const out = dedupeKeepsakes([{ id: "", label: "x", description: "d" }] as never);
    expect(out).toEqual([]);
  });
});

describe("analytics event constants (R16.1)", () => {
  it("expose the granted / carried event names", () => {
    expect(KEEPSAKE_GRANTED).toBe("keepsake.granted");
    expect(KEEPSAKE_CARRIED).toBe("keepsake.carried");
  });
});

describe("streakKeepsake (Panel-2 W3 daily streak reward)", () => {
  it("mints nothing below the first milestone", () => {
    for (const n of [0, 1, 3, 6]) expect(streakKeepsake(n)).toBeNull();
  });

  it("mints the headline 7-day keepsake at a 7-day streak", () => {
    const k = streakKeepsake(7);
    expect(k).not.toBeNull();
    expect(k!.id).toBe("daily-streak-7");
    expect(k!.label).toBe("7-Day Ember");
    expect(k!.description.length).toBeGreaterThan(0);
    expect(k!.description.length).toBeLessThanOrEqual(160);
  });

  it("mints a distinct keepsake at each further weekly milestone", () => {
    const seven = streakKeepsake(7)!;
    const fourteen = streakKeepsake(14)!;
    expect(fourteen.id).toBe("daily-streak-14");
    expect(fourteen.id).not.toBe(seven.id);
    expect(fourteen.description).toContain("2 weeks");
  });

  it("returns null between milestones and on non-finite input", () => {
    expect(streakKeepsake(8)).toBeNull();
    expect(streakKeepsake(13)).toBeNull();
    expect(streakKeepsake(NaN)).toBeNull();
    expect(streakKeepsake(-7)).toBeNull();
  });

  it("uses a 7-day interval", () => {
    expect(STREAK_KEEPSAKE_INTERVAL).toBe(7);
  });
});
