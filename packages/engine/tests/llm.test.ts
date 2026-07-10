import { describe, expect, it } from "vitest";

import {
  advanceLlmTurnCursor,
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

  it("accepts optional protagonistAnchor + settingAnchor fields on turn 1 proposals", () => {
    const parsed = llmSceneOutputSchema.parse({
      prose: "p",
      choices: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      protagonistAnchor: "Korean woman late 30s, faded yellow rain jacket, painterly realism.",
      settingAnchor: "Pacific Northwest cove at dawn, gray fog over slick black rocks.",
    });
    expect(parsed.protagonistAnchor).toContain("Korean woman");
    expect(parsed.settingAnchor).toContain("Pacific Northwest cove");
  });

  it("treats anchors as fully optional (scene-2+ proposals don't carry them)", () => {
    const parsed = llmSceneOutputSchema.parse({
      prose: "p",
      choices: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    });
    expect(parsed.protagonistAnchor).toBeUndefined();
    expect(parsed.settingAnchor).toBeUndefined();
  });

  it("rejects anchor strings shorter than 8 chars and clamps long ones to 1000", () => {
    // Min-length still rejects — too-short anchor descriptions provide
    // no useful signal for portrait generation.
    expect(() =>
      llmSceneOutputSchema.parse({
        prose: "p",
        choices: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        protagonistAnchor: "tiny",
      }),
    ).toThrow();
    // Max-length is now CLAMPED rather than rejected. Gemini's
    // responseSchema soft-ignores maxLength on strings (see
    // `clampedString` rationale in llm.ts), so failing here would send
    // the router into the deterministic fallback. The clamp lets the
    // proposal land while still bounding downstream consumers.
    const parsed = llmSceneOutputSchema.parse({
      prose: "p",
      choices: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      settingAnchor: "a".repeat(1500),
    });
    expect(parsed.settingAnchor?.length).toBe(1000);
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

  it("drops unknown effect kinds but keeps valid effects and the scene", () => {
    // An LLM occasionally emits an unrecognized effect kind. Rejecting the
    // whole scene over it hard-fails the turn (`llm_scene_invalid_shape`);
    // instead the invalid effect is dropped (never applied) while the prose,
    // choices, and any valid effects survive. The engine is authoritative
    // over effects, so an unknown one is simply ignored.
    const parsed = llmSceneOutputSchema.parse({
      prose: "p",
      choices: [
        {
          id: "a",
          label: "A",
          effects: [
            { kind: "raw_state_mutation", payload: { vitality: 99 } }, // dropped
            { kind: "stat", statId: "resolve", delta: 2 }, // kept
          ],
        },
        { id: "b", label: "B" },
      ],
    });
    expect(parsed.choices).toHaveLength(2);
    expect(parsed.choices[0]?.effects).toEqual([{ kind: "stat", statId: "resolve", delta: 2 }]);
  });

  it("drops npc_* effect kinds so the LLM can never mutate NPC state (Requirement 31.2)", () => {
    // The LLM MUST NOT mutate NPC state — those flow through engine-authored
    // effects only. The LLM effect union excludes npc_* kinds, so any such
    // effect is DROPPED (never applied) rather than failing the whole turn.
    // Dropping preserves the security guarantee AND keeps the read loop alive
    // on model drift. Mirrors Requirement 9: no direct state patches from model
    // output.
    for (const kind of [
      "npc_spawn",
      "npc_despawn",
      "npc_relocate",
      "npc_disposition_delta",
      "npc_attribute_delta",
      "npc_inventory_add",
      "npc_inventory_remove",
      "npc_flag_set",
      "npc_learn_fact",
    ]) {
      const parsed = llmSceneOutputSchema.parse({
        prose: "p",
        choices: [
          { id: "a", label: "A", effects: [{ kind, npcId: "mira", delta: 1 }] },
          { id: "b", label: "B" },
        ],
      });
      // npc_* effect dropped (not applied), scene preserved.
      expect(parsed.choices[0]?.effects).toEqual([]);
      expect(parsed.choices).toHaveLength(2);
    }
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

describe("advanceLlmTurnCursor freeform branch", () => {
  it("advances the turn and emits choice_applied without looking up the choiceId", () => {
    const story = llmDrivenStory();
    const initial = createInitialState(story, "story", ctx.now, ctx.rngSeed);
    // Seed the state to turn 1 so we can observe the increment to 2 below.
    const opening = advanceLlmTurnCursor({
      state: initial,
      story,
      priorProposal: proposal(),
      choiceId: "torch-down",
      ctx,
    });

    // Free-form: the reader typed their own action, so we pass a synthetic id
    // that does NOT exist in the proposal's choices and set freeform=true.
    const freeform = advanceLlmTurnCursor({
      state: opening.state,
      story,
      priorProposal: null,
      choiceId: "freeform:rid_xyz",
      ctx,
      freeform: true,
    });

    expect(freeform.state.turnNumber).toBe(opening.state.turnNumber + 1);
    expect(freeform.state.currentNodeId).toBe(`bone-cathedral:llm:${opening.state.turnNumber + 1}`);
    expect(freeform.appliedChoiceId).toBe("freeform:rid_xyz");
    expect(freeform.events.map((event) => event.kind)).toContain("choice_applied");
    // No effects applied — the synthetic id has no LLM-proposed effects.
    expect(freeform.state.vitality).toBe(opening.state.vitality);
  });

  it("does not throw when the synthetic choiceId is missing from a prior proposal", () => {
    const story = llmDrivenStory();
    const initial = createInitialState(story, "story", ctx.now, ctx.rngSeed);
    // priorProposal IS present here (we pass it through), but freeform=true
    // tells the engine to skip the prior-proposal lookup entirely. Without
    // the freeform flag this would throw `llm_choice_not_found:freeform:xyz`.
    expect(() =>
      advanceLlmTurnCursor({
        state: initial,
        story,
        priorProposal: proposal(),
        choiceId: "freeform:rid_xyz",
        ctx,
        freeform: true,
      }),
    ).not.toThrow();
  });
});
