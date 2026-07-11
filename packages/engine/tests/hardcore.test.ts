import { describe, expect, it } from "vitest";

import {
  CLOCK_HARDCORE_MIN,
  CLOCK_MAX_DEFAULT,
  bumpDifficulty,
  choiceCheckOdds,
  createClock,
  createInitialState,
  hardcoreClockMax,
  llmSceneOutputSchema,
  resolveChoiceCheck,
  type Story,
} from "../src";

const story: Story = {
  id: "hardcore-fixture",
  version: 1,
  title: "Hardcore",
  startNodeId: "start",
  initialState: {
    vitality: 5,
    currency: 20,
    attributes: {
      nerve: { id: "nerve", label: "Nerve", value: 3, visibility: "visible" },
    },
    inventory: [],
    flags: {},
  },
  endings: {},
  nodes: { start: { id: "start", seed: "Begin.", choices: [] } },
};

describe("hardcoreClockMax + createClock({ hardcore }) (W3-M3)", () => {
  it("reduces the default ceiling ~25%, rounded", () => {
    // 12 * 0.75 = 9.
    expect(hardcoreClockMax(CLOCK_MAX_DEFAULT)).toBe(9);
    expect(hardcoreClockMax(12)).toBe(9);
    expect(hardcoreClockMax()).toBe(9);
  });

  it("floors at CLOCK_HARDCORE_MIN so a tiny clock keeps segments", () => {
    expect(hardcoreClockMax(2)).toBe(CLOCK_HARDCORE_MIN);
    expect(hardcoreClockMax(1)).toBe(CLOCK_HARDCORE_MIN);
  });

  it("createClock({ hardcore: true }) applies the hardcore ceiling", () => {
    const normal = createClock("The candle burns");
    const hard = createClock("The candle burns", { hardcore: true });
    expect(normal.max).toBe(CLOCK_MAX_DEFAULT);
    expect(hard.max).toBe(9);
    // hardcore wins over an explicit maxReduction.
    expect(createClock("x", { hardcore: true, maxReduction: 0 }).max).toBe(9);
  });

  it("defaults (no opts) stay backward-compatible", () => {
    expect(createClock().max).toBe(CLOCK_MAX_DEFAULT);
    expect(createClock("x", { maxReduction: 0.25 }).max).toBe(9);
  });
});

describe("bumpDifficulty (W3-M3)", () => {
  it("shifts one band harder; desperate stays", () => {
    expect(bumpDifficulty("easy")).toBe("risky");
    expect(bumpDifficulty("risky")).toBe("desperate");
    expect(bumpDifficulty("desperate")).toBe("desperate");
  });

  it("resolveChoiceCheck opts.hardcore raises the threshold", () => {
    const state = createInitialState(story, "hardcore", 1, "seed");
    const check = { statId: "nerve", difficulty: "easy" as const };
    const normal = resolveChoiceCheck(state, check, "seed-1");
    const hard = resolveChoiceCheck(state, check, "seed-1", { hardcore: true });
    // easy (threshold 4) → risky (threshold 6) under hardcore.
    expect(normal.breakdown.threshold).toBe(4);
    expect(normal.breakdown.difficulty).toBe("easy");
    expect(hard.breakdown.threshold).toBe(6);
    expect(hard.breakdown.difficulty).toBe("risky");
  });

  it("choiceCheckOdds opts.hardcore shifts the phrase harder", () => {
    const state = createInitialState(story, "hardcore", 1, "seed");
    const check = { statId: "nerve", difficulty: "easy" as const };
    const normal = choiceCheckOdds(state, check);
    const hard = choiceCheckOdds(state, check, { hardcore: true });
    const ladder = ["desperate", "risky", "even", "likely"];
    expect(ladder.indexOf(hard)).toBeLessThanOrEqual(ladder.indexOf(normal));
  });

  it("default (no opts) leaves resolveChoiceCheck behavior unchanged", () => {
    const state = createInitialState(story, "story", 1, "seed");
    const check = { statId: "nerve", difficulty: "risky" as const };
    const a = resolveChoiceCheck(state, check, "seed-x");
    const b = resolveChoiceCheck(state, check, "seed-x", { hardcore: false });
    expect(a).toEqual(b);
  });
});

describe("keepsake terminal-only clamp (W3-M1)", () => {
  const keepsake = { id: "bone-key", label: "The Bone Key", description: "A cold iron key." };

  it("honors a keepsake on a terminal scene", () => {
    const parsed = llmSceneOutputSchema.parse({
      prose: "The gate closes behind you.",
      choices: [
        { id: "a", label: "Rest" },
        { id: "b", label: "Walk on" },
      ],
      terminal: { kind: "success", endingId: "triumph" },
      keepsake,
    });
    expect(parsed.keepsake).toEqual(keepsake);
  });

  it("strips a keepsake proposed on a NON-terminal scene", () => {
    const parsed = llmSceneOutputSchema.parse({
      prose: "The road forks.",
      choices: [
        { id: "a", label: "Left" },
        { id: "b", label: "Right" },
      ],
      terminal: null,
      keepsake,
    });
    expect(parsed.keepsake).toBeUndefined();
  });

  it("drops a malformed keepsake instead of failing the scene (BC5)", () => {
    const parsed = llmSceneOutputSchema.parse({
      prose: "The gate closes.",
      choices: [
        { id: "a", label: "Rest" },
        { id: "b", label: "Walk on" },
      ],
      terminal: { kind: "success", endingId: "triumph" },
      keepsake: { id: "", label: "" },
    });
    expect(parsed.keepsake).toBeUndefined();
    expect(parsed.prose).toBe("The gate closes.");
  });
});
