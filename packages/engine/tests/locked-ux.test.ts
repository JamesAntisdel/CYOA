// Locked-choice UX polish: humanized authored-path fallback hints
// (visibility.ts) and the near-miss band on locked llm-path numeric gates
// (llm.ts). The band is a PHRASE ("near" | "far") — the raw value/threshold
// never appear in the visibility result beyond the condition the caller
// already holds (BC10 discipline is enforced at the projection).

import { describe, expect, it } from "vitest";

import {
  createInitialState,
  evaluateConditions,
  evaluateLlmChoiceVisibility,
  evaluateLlmSceneChoices,
  llmChoiceSchema,
  type Choice,
  type Condition,
  type Story,
} from "../src";

const story: Story = {
  id: "locked-ux",
  version: 1,
  title: "Locked UX",
  startNodeId: "start",
  initialState: {
    vitality: 10,
    currency: 10,
    attributes: {
      nerve: { id: "nerve", label: "Nerve", value: 4, visibility: "visible" },
      dread: { id: "dread", label: "Dread", value: 5, visibility: "hidden" },
    },
    inventory: [{ id: "bone_key", label: "Bone Key" }],
    flags: {},
  },
  endings: {},
  nodes: { start: { id: "start", seed: "Begin.", choices: [] } },
};

const state = () => createInitialState(story, "story", 1, "seed");

// ===========================================================================
// Authored path — defaultHint humanization (visibility.ts)
// ===========================================================================

function authoredChoice(conditions: Condition[]): Choice {
  return { id: "c", label: "Do the thing.", targetNodeId: "next", conditions };
}

describe("authored-path locked fallback hints", () => {
  it("title-cases a missing item id instead of leaking the raw id", () => {
    const evaluation = evaluateConditions(
      state(),
      authoredChoice([{ kind: "has_item", itemId: "iron_key" }]),
    );
    expect(evaluation.visibility).toBe("locked");
    expect(evaluation.lockedHint).toBe("Needs the Iron Key");
  });

  it("does not stack articles when the id carries its own", () => {
    const evaluation = evaluateConditions(
      state(),
      authoredChoice([{ kind: "has_item", itemId: "the_black_candle" }]),
    );
    expect(evaluation.lockedHint).toBe("Needs the Black Candle");
  });

  it("humanizes the missing_item fallback with the item name", () => {
    const evaluation = evaluateConditions(
      state(),
      authoredChoice([{ kind: "missing_item", itemId: "bone_key" }]),
    );
    expect(evaluation.visibility).toBe("locked");
    expect(evaluation.lockedHint).toBe("You must part with the Bone Key");
  });

  it("keeps the stat fallback generic instead of naming a wrong stat", () => {
    for (const condition of [
      { kind: "stat_at_least", statId: "nerve", value: 5 },
      { kind: "stat_at_most", statId: "dread", value: 1 },
    ] satisfies Condition[]) {
      const evaluation = evaluateConditions(state(), authoredChoice([condition]));
      expect(evaluation.visibility).toBe("locked");
      expect(evaluation.lockedHint).toBe("You are not yet ready for this");
      expect(evaluation.lockedHint).not.toMatch(/resolve/i);
    }
  });

  it("authored condition hints always win over the fallback", () => {
    const evaluation = evaluateConditions(
      state(),
      authoredChoice([{ kind: "has_item", itemId: "iron_key", hint: "The door is barred." }]),
    );
    expect(evaluation.lockedHint).toBe("The door is barred.");
  });
});

// ===========================================================================
// LLM path — near-miss band on locked numeric gates (llm.ts)
// ===========================================================================

function llmChoice(conditions: unknown[], lockedHint?: string) {
  return llmChoiceSchema.parse({
    id: "c",
    label: "Do the thing.",
    conditions,
    ...(lockedHint !== undefined ? { lockedHint } : {}),
  });
}

describe("llm-path near-miss band", () => {
  it.each([
    // nerve = 4, currency = 10, dread = 5 (see fixture).
    ["stat_at_least 1 point short", { kind: "stat_at_least", statId: "nerve", value: 5 }, "near"],
    ["stat_at_least far short", { kind: "stat_at_least", statId: "nerve", value: 10 }, "far"],
    ["stat_at_most 1 point over", { kind: "stat_at_most", statId: "dread", value: 4 }, "near"],
    ["stat_at_most far over", { kind: "stat_at_most", statId: "dread", value: 1 }, "far"],
    // Within 20% of the threshold even when more than 1 point short: 10/12.
    ["currency within 20%", { kind: "currency_at_least", value: 12 }, "near"],
    ["currency far short", { kind: "currency_at_least", value: 99 }, "far"],
  ] as const)("%s → %s", (_label, condition, expected) => {
    const result = evaluateLlmChoiceVisibility(llmChoice([condition]), state());
    expect(result.visibility).toBe("locked");
    expect(result.nearness).toBe(expected);
  });

  it("omits the band on binary (item/flag) gates", () => {
    for (const condition of [
      { kind: "has_item", itemId: "iron_key" },
      { kind: "missing_item", itemId: "bone_key" },
      { kind: "flag_equals", flag: "bell_rung", value: true },
    ]) {
      const result = evaluateLlmChoiceVisibility(llmChoice([condition]), state());
      expect(result.visibility).toBe("locked");
      expect(result).not.toHaveProperty("nearness");
    }
  });

  it("omits the band on visible choices", () => {
    const result = evaluateLlmChoiceVisibility(
      llmChoice([{ kind: "stat_at_least", statId: "nerve", value: 4 }]),
      state(),
    );
    expect(result.visibility).toBe("visible");
    expect(result).not.toHaveProperty("nearness");
  });

  it("keeps lockedHint and nearness together on a locked result", () => {
    const result = evaluateLlmChoiceVisibility(
      llmChoice([{ kind: "stat_at_least", statId: "nerve", value: 5 }], "Your hands shake."),
      state(),
    );
    expect(result).toMatchObject({
      visibility: "locked",
      lockedHint: "Your hands shake.",
      nearness: "near",
    });
  });

  it("survives the scene-level invariants (band rides the kept locked result)", () => {
    const visible = (id: string) => llmChoiceSchema.parse({ id, label: id });
    const results = evaluateLlmSceneChoices(
      [
        visible("a"),
        visible("b"),
        llmChoiceSchema.parse({
          id: "gated",
          label: "Force the gate.",
          conditions: [{ kind: "stat_at_least", statId: "nerve", value: 5 }],
        }),
      ],
      state(),
    );
    const gated = results.find((entry) => entry.choiceId === "gated");
    expect(gated?.visibility).toBe("locked");
    expect(gated?.nearness).toBe("near");
  });
});
