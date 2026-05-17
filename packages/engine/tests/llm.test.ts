import { describe, expect, it } from "vitest";

import {
  applyLlmSceneToState,
  createInitialState,
  llmSceneOutputSchema,
  parseLlmSceneProposal,
  type LlmSceneProposal,
  type Story,
} from "../src";

const ctx = { now: 1, rngSeed: "llm-seed" };

function llmDrivenStory(): Story {
  return {
    id: "bone-cathedral",
    version: 1,
    title: "Bone Cathedral",
    startNodeId: "start",
    initialState: {
      vitality: 10,
      currency: 2,
      attributes: {
        resolve: { id: "resolve", label: "Resolve", value: 1, visibility: "hidden" },
      },
      inventory: [],
      flags: {},
    },
    endings: {
      "ending-cathedral-fall": { id: "ending-cathedral-fall", label: "The Bell Falls", kind: "death" },
      "ending-cathedral-rise": { id: "ending-cathedral-rise", label: "The Bell Holds", kind: "success" },
    },
    nodes: {
      start: { id: "start", seed: "Gothic seed.", choices: [] },
    },
  };
}

function proposal(overrides: Partial<LlmSceneProposal> = {}): LlmSceneProposal {
  const base = {
    prose: "The censer rocks; smoke writes a name on the stone.",
    choices: [
      {
        id: "torch-down",
        label: "Take the torch down the stair.",
        tone: "bold",
        effects: [{ kind: "stat" as const, statId: "vitality", delta: -1 }],
      },
      {
        id: "listen",
        label: "Listen at the iron door.",
        tone: "careful",
        effects: [{ kind: "flag_set" as const, flag: "heard_voices", value: true }],
      },
    ],
    terminal: null,
    ...overrides,
  };
  return llmSceneOutputSchema.parse(base);
}

describe("LLM scene parser", () => {
  it("parses a well-formed scene JSON", () => {
    const parsed = parseLlmSceneProposal(
      JSON.stringify({
        prose: "Hello.",
        choices: [
          { id: "a", label: "Step in." },
          { id: "b", label: "Step out." },
        ],
        terminal: null,
      }),
    );
    expect(parsed.prose).toBe("Hello.");
    expect(parsed.choices).toHaveLength(2);
    expect(parsed.terminal).toBeNull();
  });

  it("rejects non-JSON strings", () => {
    expect(() => parseLlmSceneProposal("just prose here")).toThrow("llm_scene_not_json");
  });

  it("rejects scenes with fewer than two choices", () => {
    expect(() =>
      llmSceneOutputSchema.parse({
        prose: "p",
        choices: [{ id: "only", label: "Only one" }],
      }),
    ).toThrow();
  });

  it("rejects scenes with more than four choices", () => {
    expect(() =>
      llmSceneOutputSchema.parse({
        prose: "p",
        choices: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
          { id: "c", label: "C" },
          { id: "d", label: "D" },
          { id: "e", label: "E" },
        ],
      }),
    ).toThrow();
  });

  it("rejects duplicate choice ids", () => {
    expect(() =>
      llmSceneOutputSchema.parse({
        prose: "p",
        choices: [
          { id: "x", label: "A" },
          { id: "x", label: "B" },
        ],
      }),
    ).toThrow(/duplicate_choice_id/u);
  });

  it("rejects effects with unknown kinds", () => {
    expect(() =>
      llmSceneOutputSchema.parse({
        prose: "p",
        choices: [
          {
            id: "a",
            label: "A",
            effects: [{ kind: "raw_state_mutation", payload: { vitality: 99 } }],
          },
          { id: "b", label: "B" },
        ],
      }),
    ).toThrow();
  });

  it("clamps absurd stat deltas to engine-safe bounds", () => {
    const parsed = llmSceneOutputSchema.parse({
      prose: "p",
      choices: [
        { id: "a", label: "A", effects: [{ kind: "stat", statId: "resolve", delta: 999 }] },
        { id: "b", label: "B", effects: [{ kind: "stat", statId: "resolve", delta: -999 }] },
      ],
    });
    expect(parsed.choices[0]?.effects?.[0]).toEqual({ kind: "stat", statId: "resolve", delta: 10 });
    expect(parsed.choices[1]?.effects?.[0]).toEqual({ kind: "stat", statId: "resolve", delta: -10 });
  });
});

describe("applyLlmSceneToState", () => {
  it("enters the opening scene without consuming a choice", () => {
    const story = llmDrivenStory();
    const state = createInitialState(story, "story", ctx.now, ctx.rngSeed);
    const result = applyLlmSceneToState({
      state,
      story,
      priorProposal: null,
      choiceId: null,
      nextProposal: proposal(),
      ctx,
    });

    expect(result.state.turnNumber).toBe(0);
    expect(result.state.currentNodeId).toBe("bone-cathedral:llm:0");
    expect(result.appliedChoiceId).toBeNull();
    expect(result.events.map((event) => event.kind)).toContain("node_entered");
    expect(result.terminal).toBeNull();
  });

  it("applies the taken choice's effects and advances the turn", () => {
    const story = llmDrivenStory();
    const initial = createInitialState(story, "story", ctx.now, ctx.rngSeed);
    const opening = applyLlmSceneToState({
      state: initial,
      story,
      priorProposal: null,
      choiceId: null,
      nextProposal: proposal(),
      ctx,
    });

    const next = applyLlmSceneToState({
      state: opening.state,
      story,
      priorProposal: opening.proposal,
      choiceId: "torch-down",
      nextProposal: proposal({
        prose: "Step two.",
        choices: [
          { id: "press-on", label: "Press on." },
          { id: "retreat", label: "Retreat." },
        ],
      }),
      ctx,
    });

    expect(next.state.turnNumber).toBe(1);
    expect(next.state.vitality).toBe(9);
    expect(next.state.currentNodeId).toBe("bone-cathedral:llm:1");
    expect(next.appliedChoiceId).toBe("torch-down");
  });

  it("rejects unknown choice ids", () => {
    const story = llmDrivenStory();
    const initial = createInitialState(story, "story", ctx.now, ctx.rngSeed);
    const opening = applyLlmSceneToState({
      state: initial,
      story,
      priorProposal: null,
      choiceId: null,
      nextProposal: proposal(),
      ctx,
    });

    expect(() =>
      applyLlmSceneToState({
        state: opening.state,
        story,
        priorProposal: opening.proposal,
        choiceId: "does-not-exist",
        nextProposal: proposal(),
        ctx,
      }),
    ).toThrow(/llm_choice_not_found/u);
  });

  it("records the terminal ending and emits ending_unlocked", () => {
    const story = llmDrivenStory();
    const initial = createInitialState(story, "story", ctx.now, ctx.rngSeed);
    const opening = applyLlmSceneToState({
      state: initial,
      story,
      priorProposal: null,
      choiceId: null,
      nextProposal: proposal(),
      ctx,
    });

    const ended = applyLlmSceneToState({
      state: opening.state,
      story,
      priorProposal: opening.proposal,
      choiceId: "listen",
      nextProposal: proposal({
        prose: "The bell holds.",
        choices: [
          { id: "ack", label: "Acknowledge." },
          { id: "linger", label: "Linger." },
        ],
        terminal: { kind: "success", endingId: "ending-cathedral-rise" },
      }),
      ctx,
    });

    expect(ended.terminal?.kind).toBe("success");
    expect(ended.state.endingsUnlocked["ending-cathedral-rise"]).toBeDefined();
    expect(ended.events.map((event) => event.kind)).toContain("ending_unlocked");
  });

  it("overrides a model success terminal when vitality has dropped to zero", () => {
    const story = llmDrivenStory();
    const initial = createInitialState(story, "story", ctx.now, ctx.rngSeed);
    const opening = applyLlmSceneToState({
      state: { ...initial, vitality: 1 },
      story,
      priorProposal: null,
      choiceId: null,
      nextProposal: proposal(),
      ctx,
    });

    const dying = applyLlmSceneToState({
      state: opening.state,
      story,
      priorProposal: opening.proposal,
      choiceId: "torch-down",
      nextProposal: proposal({
        prose: "All goes well.",
        choices: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        terminal: { kind: "success", endingId: "ending-cathedral-rise" },
      }),
      ctx,
    });

    expect(dying.state.vitality).toBe(0);
    expect(dying.terminal?.kind).toBe("death");
    expect(dying.events.map((event) => event.kind)).toContain("death_triggered");
  });
});
