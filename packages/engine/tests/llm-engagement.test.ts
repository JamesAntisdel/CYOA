import { describe, expect, it } from "vitest";

import {
  applyLlmSceneToState,
  createInitialState,
  evaluateLlmChoiceVisibility,
  evaluateLlmSceneChoices,
  gateTerminal,
  llmChoiceSchema,
  llmSceneOutputSchema,
  type ArcBeat,
  type EngineDiff,
  type LlmSceneProposal,
  type LlmTerminalProposal,
  type PlayerState,
  type StoryArc,
  type Story,
} from "../src";

const ctx = { now: 1, rngSeed: "seed" };

function story(): Story {
  return {
    id: "bone-cathedral",
    version: 1,
    title: "Bone Cathedral",
    startNodeId: "start",
    initialState: {
      vitality: 10,
      currency: 20,
      attributes: {
        resolve: { id: "resolve", label: "Resolve", value: 1, visibility: "visible", min: 0, max: 5 },
      },
      inventory: [{ id: "bone-key", label: "Bone Key" }],
      flags: { bell_rung: true },
    },
    endings: {
      "bell-holds": { id: "bell-holds", label: "The Bell Holds", kind: "success" },
    },
    nodes: { start: { id: "start", seed: "seed", choices: [] } },
  };
}

function beat(o: Partial<ArcBeat> & Pick<ArcBeat, "id" | "kind" | "priorityHint">): ArcBeat {
  return {
    label: o.label ?? `${o.id} label`,
    requiredBeforeEnding: o.requiredBeforeEnding ?? false,
    status: o.status ?? "pending",
    ...o,
  };
}

function testArc(beats?: ArcBeat[], overrides: Partial<StoryArc> = {}): StoryArc {
  return {
    dramaticQuestion: "Will you silence the bell before it drowns the city?",
    protagonistWant: "To silence the bell.",
    stakes: "The city drowns if you fail.",
    act: 1,
    beats:
      beats ??
      [
        beat({ id: "inciting-call", kind: "inciting", priorityHint: "early" }),
        beat({ id: "midpoint-turn", kind: "midpoint", priorityHint: "mid" }),
        beat({ id: "climax-reckoning", kind: "climax", priorityHint: "late", requiredBeforeEnding: true }),
      ],
    candidateEndings: [
      { id: "bell-holds", label: "The Bell Holds", hint: "You endure." },
      { id: "bell-falls", label: "The Bell Falls", hint: "You do not." },
    ],
    source: "llm",
    ...overrides,
  };
}

// Raw (untyped) overrides so tests can feed the parser deliberately-loose
// input (garbage arcs, delayed effect literals) without fighting the inferred
// proposal shape — the schema is the gate.
function proposal(overrides: Record<string, unknown> = {}): LlmSceneProposal {
  return llmSceneOutputSchema.parse({
    prose: "The censer rocks.",
    choices: [
      { id: "a", label: "Go down." },
      { id: "b", label: "Wait." },
    ],
    terminal: null,
    ...overrides,
  });
}

function open(state: PlayerState, story_: Story, next: LlmSceneProposal) {
  return applyLlmSceneToState({ state, story: story_, priorProposal: null, choiceId: null, nextProposal: next, ctx });
}

// ===========================================================================
// storyArc + beatFired schema (W1-E2)
// ===========================================================================

describe("llmSceneOutputSchema: storyArc + beatFired", () => {
  it("round-trips a plausible turn-1 storyArc envelope", () => {
    const parsed = llmSceneOutputSchema.parse({
      prose: "p",
      choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      storyArc: {
        dramaticQuestion: "Will you ring the bell?",
        protagonistWant: "silence",
        stakes: "the city",
        beats: [{ id: "x", label: "X", kind: "climax", priorityHint: "late" }],
        candidateEndings: [{ id: "y", label: "Y", hint: "h" }],
      },
    });
    expect(parsed.storyArc?.dramaticQuestion).toBe("Will you ring the bell?");
  });

  it("drops a garbage storyArc but keeps the scene (BC5)", () => {
    const parsed = llmSceneOutputSchema.parse({
      prose: "p",
      choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      storyArc: "totally not an arc",
    });
    expect(parsed.storyArc).toBeUndefined();
    expect(parsed.choices).toHaveLength(2);
  });

  it("clamps beatFired to 48 chars", () => {
    const parsed = llmSceneOutputSchema.parse({
      prose: "p",
      choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      beatFired: "z".repeat(80),
    });
    expect(parsed.beatFired?.length).toBe(48);
  });
});

// ===========================================================================
// Delayed threads (W1-E3)
// ===========================================================================

function kinds(diffs: EngineDiff[]): string[] {
  return diffs.map((d) => d.kind);
}

describe("delayed Chekhov threads", () => {
  const delayedChoice = {
    id: "wound",
    label: "Take the blow.",
    effects: [
      {
        kind: "delayed",
        delayNodes: 1,
        note: "the wound will fester",
        effects: [{ kind: "stat", statId: "resolve", delta: -1 }],
      },
    ],
  };

  it("schedules a thread (thread_set + note) then fires it next turn (thread_fired + effect)", () => {
    const s = story();
    let state = createInitialState(s, "story", ctx.now, ctx.rngSeed);
    const p0 = proposal({ choices: [delayedChoice, { id: "b", label: "Wait." }] });
    const opening = open(state, s, p0);

    // Take the delayed-bearing choice → schedules the thread.
    const t1 = applyLlmSceneToState({
      state: opening.state,
      story: s,
      priorProposal: p0,
      choiceId: "wound",
      nextProposal: proposal(),
      ctx,
    });
    expect(kinds(t1.diffs)).toContain("thread_set");
    const setDiff = t1.diffs.find((d) => d.kind === "thread_set");
    expect(setDiff && "note" in setDiff ? setDiff.note : null).toBe("the wound will fester");
    expect(t1.state.delayed).toHaveLength(1);

    // Next turn ticks the thread → fires with note + applies the effect.
    const t2 = applyLlmSceneToState({
      state: t1.state,
      story: s,
      priorProposal: proposal(),
      choiceId: "a",
      nextProposal: proposal(),
      ctx,
    });
    expect(kinds(t2.diffs)).toContain("thread_fired");
    const firedDiff = t2.diffs.find((d) => d.kind === "thread_fired");
    expect(firedDiff && "note" in firedDiff ? firedDiff.note : null).toBe("the wound will fester");
    expect(t2.state.attributes.resolve?.value).toBe(0); // 1 - 1
    expect(t2.state.delayed).toHaveLength(0);
  });

  it("enforces ≤1 delayed thread per proposal (extras dropped)", () => {
    const s = story();
    const two = {
      id: "wound",
      label: "Take the blow.",
      effects: [
        { kind: "delayed", delayNodes: 2, note: "one", effects: [{ kind: "stat", statId: "resolve", delta: -1 }] },
        { kind: "delayed", delayNodes: 2, note: "two", effects: [{ kind: "stat", statId: "resolve", delta: -1 }] },
      ],
    };
    const p0 = proposal({ choices: [two, { id: "b", label: "Wait." }] });
    const opening = open(createInitialState(s, "story", ctx.now, ctx.rngSeed), s, p0);
    const t1 = applyLlmSceneToState({
      state: opening.state,
      story: s,
      priorProposal: p0,
      choiceId: "wound",
      nextProposal: proposal(),
      ctx,
    });
    expect(t1.state.delayed).toHaveLength(1);
  });

  it("leaves legacy saves (no threads) untouched — no thread diffs", () => {
    const s = story();
    const p0 = proposal();
    const opening = open(createInitialState(s, "story", ctx.now, ctx.rngSeed), s, p0);
    const t1 = applyLlmSceneToState({
      state: opening.state,
      story: s,
      priorProposal: p0,
      choiceId: "a",
      nextProposal: proposal(),
      ctx,
    });
    expect(t1.state.delayed).toHaveLength(0);
    expect(kinds(t1.diffs)).not.toContain("thread_set");
    expect(kinds(t1.diffs)).not.toContain("thread_fired");
  });
});

// ===========================================================================
// Conditional / locked choices (W1-E4)
// ===========================================================================

function choiceWith(conditions: unknown[], lockedHint?: string) {
  return llmChoiceSchema.parse({
    id: "c",
    label: "Do the thing.",
    conditions,
    ...(lockedHint !== undefined ? { lockedHint } : {}),
  });
}

describe("evaluateLlmChoiceVisibility predicates", () => {
  const state = () => createInitialState(story(), "story", ctx.now, ctx.rngSeed);

  it.each([
    ["stat_at_least pass", [{ kind: "stat_at_least", statId: "resolve", value: 1 }], "visible"],
    ["stat_at_least fail", [{ kind: "stat_at_least", statId: "resolve", value: 3 }], "locked"],
    ["stat_at_most pass", [{ kind: "stat_at_most", statId: "resolve", value: 3 }], "visible"],
    ["stat_at_most fail", [{ kind: "stat_at_most", statId: "resolve", value: 0 }], "locked"],
    ["has_item pass", [{ kind: "has_item", itemId: "bone-key" }], "visible"],
    ["has_item fail", [{ kind: "has_item", itemId: "iron-key" }], "locked"],
    ["missing_item pass", [{ kind: "missing_item", itemId: "iron-key" }], "visible"],
    ["missing_item fail", [{ kind: "missing_item", itemId: "bone-key" }], "locked"],
    ["flag_equals pass", [{ kind: "flag_equals", flag: "bell_rung", value: true }], "visible"],
    ["flag_equals fail", [{ kind: "flag_equals", flag: "bell_rung", value: false }], "locked"],
    ["currency_at_least pass", [{ kind: "currency_at_least", value: 10 }], "visible"],
    ["currency_at_least fail", [{ kind: "currency_at_least", value: 99 }], "locked"],
  ] as const)("%s", (_label, conditions, expected) => {
    expect(evaluateLlmChoiceVisibility(choiceWith([...conditions]), state()).visibility).toBe(expected);
  });

  // The reader holds { id: "bone-key", label: "Bone Key" }. The LLM often
  // re-spells the id when gating a later choice; a tolerant match on normalized
  // id OR label keeps the door openable instead of locking it forever.
  it.each([
    ["snake_case id", "bone_key", "visible"],
    ["squashed id", "bonekey", "visible"],
    ["label with space", "Bone Key", "visible"],
    ["prefixed id", "the-bone-key", "locked"],
    ["unrelated id", "iron-key", "locked"],
  ] as const)("has_item tolerant: %s", (_label, itemId, expected) => {
    const choice = choiceWith([{ kind: "has_item", itemId }]);
    expect(evaluateLlmChoiceVisibility(choice, state()).visibility).toBe(expected);
  });

  it("drops a condition referencing an unknown stat (choice stays visible)", () => {
    const choice = choiceWith([{ kind: "stat_at_least", statId: "willpower", value: 5 }]);
    expect(evaluateLlmChoiceVisibility(choice, state()).visibility).toBe("visible");
  });

  it("clamps lockedHint to 90 chars and surfaces it when locked", () => {
    const choice = choiceWith([{ kind: "stat_at_least", statId: "resolve", value: 9 }], "x".repeat(200));
    const result = evaluateLlmChoiceVisibility(choice, state());
    expect(result.visibility).toBe("locked");
    expect(result.lockedHint?.length).toBe(90);
  });
});

describe("evaluateLlmSceneChoices enforcement", () => {
  const state = () => createInitialState(story(), "story", ctx.now, ctx.rngSeed);
  const locked = (id: string) =>
    llmChoiceSchema.parse({ id, label: id, conditions: [{ kind: "stat_at_least", statId: "resolve", value: 9 }] });
  const visible = (id: string) => llmChoiceSchema.parse({ id, label: id });

  it("keeps at most one locked choice per scene", () => {
    const results = evaluateLlmSceneChoices([visible("a"), locked("b"), locked("c")], state());
    expect(results.filter((r) => r.visibility === "locked")).toHaveLength(1);
    expect(results.find((r) => r.choiceId === "b")?.visibility).toBe("locked");
    expect(results.find((r) => r.choiceId === "c")?.visibility).toBe("visible");
  });

  it("guarantees ≥2 visible on non-terminal scenes", () => {
    const results = evaluateLlmSceneChoices([locked("a"), visible("b")], state());
    expect(results.filter((r) => r.visibility === "visible")).toHaveLength(2);
  });

  it("allows a single visible choice on terminal scenes", () => {
    const results = evaluateLlmSceneChoices([locked("a"), locked("b")], state(), { terminal: true });
    expect(results.filter((r) => r.visibility === "locked")).toHaveLength(1);
    expect(results.filter((r) => r.visibility === "visible")).toHaveLength(1);
  });
});

// ===========================================================================
// Terminal gate (W1-E5) — full matrix
// ===========================================================================

function firedArc(): StoryArc {
  return testArc([
    beat({ id: "inciting-call", kind: "inciting", priorityHint: "early", status: "fired" }),
    beat({ id: "midpoint-turn", kind: "midpoint", priorityHint: "mid", status: "fired" }),
    beat({ id: "climax-reckoning", kind: "climax", priorityHint: "late", requiredBeforeEnding: true, status: "fired" }),
  ]);
}

const success: LlmTerminalProposal = { kind: "success", endingId: "bell holds" };
const safe: LlmTerminalProposal = { kind: "safe", endingId: "bell holds" };
const death: LlmTerminalProposal = { kind: "death", endingId: "the-fall" };

describe("gateTerminal", () => {
  it("passes through when there is no arc (legacy)", () => {
    expect(gateTerminal(undefined, success, 3, 10)).toEqual({ terminal: success, directive: null });
  });

  it("passes through at vitality 0 (engine forces death downstream)", () => {
    expect(gateTerminal(testArc(), success, 3, 0)).toEqual({ terminal: success, directive: null });
  });

  it("honors any terminal at/after the hard cap (turn ≥ 30)", () => {
    const r = gateTerminal(testArc(), success, 30, 10);
    expect(r.directive).toBeNull();
    expect(r.terminal?.endingId).toBe("bell-holds"); // normalized
  });

  it.each([
    ["success", success],
    ["safe", safe],
  ] as const)("gates a %s ending with unfired required beats → surface_beat", (_l, terminal) => {
    const r = gateTerminal(testArc(), terminal, 12, 10);
    expect(r.terminal).toBeNull();
    expect(r.directive).toBe("surface_beat:climax-reckoning");
  });

  it("honors a success ending once required beats are fired + normalizes the id", () => {
    const r = gateTerminal(firedArc(), success, 12, 10);
    expect(r.directive).toBeNull();
    expect(r.terminal?.endingId).toBe("bell-holds");
  });

  it("converts a pre-midpoint death to a costly survival", () => {
    const r = gateTerminal(testArc(), death, 5, 10); // midpoint unfired
    expect(r.terminal).toBeNull();
    expect(r.directive).toBe("narrate_costly_survival");
  });

  it("honors a death after the midpoint has fired", () => {
    const arc = testArc([
      beat({ id: "inciting-call", kind: "inciting", priorityHint: "early", status: "fired" }),
      beat({ id: "midpoint-turn", kind: "midpoint", priorityHint: "mid", status: "fired" }),
      beat({ id: "climax-reckoning", kind: "climax", priorityHint: "late", requiredBeforeEnding: true }),
    ]);
    const r = gateTerminal(arc, death, 8, 10);
    expect(r.terminal?.kind).toBe("death");
    expect(r.directive).toBeNull();
  });
});

// ===========================================================================
// EngineDiff extensions via applyLlmSceneToState (W1-E5/E6)
// ===========================================================================

describe("beat + act diffs", () => {
  it("emits beat_fired + act_advanced when beatFired lands", () => {
    const s = story();
    const state = { ...createInitialState(s, "story", ctx.now, ctx.rngSeed), arc: testArc() };
    const result = open(state, s, proposal({ beatFired: "Inciting Call" }));
    const beatDiff = result.diffs.find((d) => d.kind === "beat_fired");
    expect(beatDiff && "label" in beatDiff ? beatDiff.label : null).toBe("inciting-call label");
    const actDiff = result.diffs.find((d) => d.kind === "act_advanced");
    expect(actDiff && "act" in actDiff ? actDiff.act : null).toBe(2);
    expect(result.state.arc?.beats.find((b) => b.id === "inciting-call")?.status).toBe("fired");
    expect(result.state.arc?.act).toBe(2);
  });

  it("gates a premature success terminal end-to-end (directive surfaced)", () => {
    const s = story();
    const state = { ...createInitialState(s, "story", ctx.now, ctx.rngSeed), arc: testArc() };
    const result = open(state, s, proposal({ terminal: { kind: "success", endingId: "bell-holds" } }));
    expect(result.terminal).toBeNull();
    expect(result.directive).toBe("surface_beat:climax-reckoning");
  });
});
