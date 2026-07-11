// Pure-projection tests for story-engagement W1-S4: the redacted `recentDiffs`
// wire mapping, the arc summary (count-only, spoiler-free), and the locked
// choice projection. These exercise the `convex/saves.ts` choke point where
// BC10 spoiler discipline is enforced.

import { describe, expect, it } from "vitest";

import {
  createClock,
  createInitialState,
  evaluateLlmSceneChoices,
  fireBeat,
  llmSceneOutputSchema,
  synthesizeFallbackArc,
  type LlmSceneProposal,
  type PlayerState,
  type Story,
  type StoryArc,
} from "@cyoa/engine";

import {
  MAX_VISIBLE_DIFFS_PER_TURN,
  buildVisibleDiffs,
  deriveCheckOdds,
  hasHiddenStateShift,
  projectArcSummary,
  projectLlmDrivenScene,
  type SaveRecord,
} from "../saves";

const story: Story = {
  id: "open-premise",
  version: 1,
  title: "Open Canvas",
  startNodeId: "start",
  initialState: {
    vitality: 5,
    currency: 10,
    attributes: {
      nerve: { id: "nerve", label: "Nerve", value: 3, visibility: "visible" },
      dread: { id: "dread", label: "Dread", value: 2, visibility: "hidden" },
    },
    inventory: [],
    flags: {},
  },
  endings: {},
  nodes: { start: { id: "start", seed: "Begin.", choices: [] } },
};

function baseState(): PlayerState {
  return createInitialState(story, "story", 1, "seed");
}

function saveWith(state: PlayerState): SaveRecord {
  return {
    _id: "save_1",
    accountId: "acct_1",
    storyId: story.id,
    mode: "story",
    status: "active",
    engineVersion: state.schemaVersion,
    storyVersion: 1,
    state,
    currentNodeId: state.currentNodeId,
    turnNumber: state.turnNumber,
    createdAt: 1,
    updatedAt: 1,
  };
}

function proposal(raw: unknown): LlmSceneProposal {
  const parsed = llmSceneOutputSchema.safeParse(raw);
  if (!parsed.success) throw new Error("fixture proposal invalid");
  return parsed.data;
}

describe("buildVisibleDiffs (W1-S4 redaction)", () => {
  it("resolves stat labels and keeps visible stats", () => {
    const out = buildVisibleDiffs(
      [{ kind: "stat", target: "nerve", delta: 2, before: 3, after: 5 }],
      baseState(),
    );
    expect(out).toEqual([{ kind: "stat", statId: "nerve", label: "Nerve", delta: 2 }]);
  });

  it("drops hidden-tier stat diffs (BC10)", () => {
    // `dread` is a hidden attribute → redacted out of the echo.
    const out = buildVisibleDiffs(
      [{ kind: "stat", target: "dread", delta: -1, before: 2, after: 1 }],
      baseState(),
    );
    expect(out).toEqual([]);
  });

  it("drops any diff explicitly tagged hidden", () => {
    const out = buildVisibleDiffs(
      [{ kind: "stat", target: "nerve", delta: 1, before: 3, after: 4, visibility: "hidden" }],
      baseState(),
    );
    expect(out).toEqual([]);
  });

  it("maps currency, items, threads, beats, and acts", () => {
    const state = baseState();
    state.inventory.push({ id: "bone-key", label: "Bone Key" });
    const out = buildVisibleDiffs(
      [
        { kind: "currency", target: "currency", delta: -15, before: 10, after: 0 },
        { kind: "inventory_add", target: "bone-key", delta: 1 },
        { kind: "inventory_remove", target: "torch", delta: -1 },
        { kind: "thread_set", target: "t1", visibility: "visible" },
        { kind: "thread_fired", target: "t2", note: "an earlier promise", visibility: "visible" },
        { kind: "beat_fired", target: "midpoint", label: "The bargain struck", visibility: "visible" },
        { kind: "act_advanced", target: "arc", act: 2, visibility: "visible" },
      ],
      state,
    );
    expect(out).toEqual([
      { kind: "currency", delta: -15 },
      { kind: "item", op: "add", label: "Bone Key" },
      { kind: "item", op: "remove", label: "torch" },
      { kind: "thread", op: "set", note: null },
      { kind: "thread", op: "fired", note: "an earlier promise" },
      { kind: "beat", label: "The bargain struck" },
      { kind: "act", act: 2 },
    ]);
  });

  it("withholds a set thread's note until it fires (BC10)", () => {
    const out = buildVisibleDiffs(
      [{ kind: "thread_set", target: "t1", note: "a secret foreshadow", visibility: "visible" }],
      baseState(),
    );
    expect(out).toEqual([{ kind: "thread", op: "set", note: null }]);
  });

  it("skips non-echo kinds (flags/codex, nodes, npc)", () => {
    const out = buildVisibleDiffs(
      [
        { kind: "flag_set", target: "van-state", delta: "wrecked" },
        { kind: "node", target: "open-premise:llm:3", delta: 1 },
        { kind: "npc_spawn", target: "mira", delta: 1 },
      ],
      baseState(),
    );
    expect(out).toEqual([]);
  });

  it("caps at MAX_VISIBLE_DIFFS_PER_TURN", () => {
    const many = Array.from({ length: 20 }, () => ({
      kind: "currency",
      target: "currency",
      delta: 1,
      before: 0,
      after: 1,
    }));
    const out = buildVisibleDiffs(many, baseState());
    expect(out).toHaveLength(MAX_VISIBLE_DIFFS_PER_TURN);
  });
});

describe("projectArcSummary (W1-S4, count-only)", () => {
  it("returns null for arc-less legacy saves", () => {
    expect(projectArcSummary(baseState())).toBeNull();
  });

  it("projects question + act + beat COUNTS, never labels", () => {
    const arc = synthesizeFallbackArc("A drowned city waits for its heir.");
    const state = { ...baseState(), arc } as PlayerState;
    const summary = projectArcSummary(state);
    expect(summary).not.toBeNull();
    expect(summary?.dramaticQuestion).toBe(arc.dramaticQuestion);
    expect(summary?.act).toBe(arc.act);
    expect(summary?.beatsTotal).toBe(arc.beats.length);
    expect(summary?.beatsFired).toBe(0);
    // No pending beat label or candidate ending leaks into the summary.
    const serialized = JSON.stringify(summary);
    for (const beat of arc.beats) expect(serialized).not.toContain(beat.label);
    for (const ending of arc.candidateEndings) expect(serialized).not.toContain(ending.label);
  });

  it("counts fired beats", () => {
    const arc = synthesizeFallbackArc("premise");
    const fired = fireBeat(arc, arc.beats[0]!.id, 3).arc;
    const summary = projectArcSummary({ ...baseState(), arc: fired } as PlayerState);
    expect(summary?.beatsFired).toBe(1);
  });

  it("counts pending threads from delayed effects", () => {
    const arc = synthesizeFallbackArc("premise");
    const state = { ...baseState(), arc } as PlayerState;
    state.delayed.push({ id: "d1", remainingNodes: 3, effects: [] });
    expect(projectArcSummary(state)?.threadsPending).toBe(1);
  });
});

describe("projectLlmDrivenScene arc + spoiler discipline (W1-S4/BC10)", () => {
  const arcProposal = proposal({
    prose: "The tide claws at the seawall.",
    choices: [
      { id: "open", label: "Force the gate" },
      {
        id: "bribe",
        label: "Bribe the ferryman (-15 gold)",
        conditions: [{ kind: "currency_at_least", value: 999 }],
        lockedHint: "Needs 999 gold",
      },
      { id: "wait", label: "Wait for the bell" },
    ],
    terminal: null,
  });

  it("projects the arc summary and never leaks pending labels / candidates / thread notes", () => {
    const arc: StoryArc = synthesizeFallbackArc("A drowned city waits.");
    const state = { ...baseState(), arc } as PlayerState;
    state.delayed.push({ id: "d1", remainingNodes: 2, effects: [], note: "the coin will return" } as never);
    const save = saveWith(state);
    const projection = projectLlmDrivenScene({
      save,
      proposal: arcProposal,
      prose: "The tide claws at the seawall.",
      streamStatus: "complete",
    });
    expect(projection.arc).toBeDefined();
    expect(projection.arc?.beatsTotal).toBe(arc.beats.length);
    // BC10: nothing spoiler-y anywhere in the wire projection.
    const serialized = JSON.stringify(projection);
    for (const beat of arc.beats) expect(serialized).not.toContain(beat.label);
    for (const ending of arc.candidateEndings) expect(serialized).not.toContain(ending.label);
    expect(serialized).not.toContain("the coin will return");
  });

  it("projects a locked choice with its hint via precomputed visibilities", () => {
    const state = { ...baseState(), arc: synthesizeFallbackArc("premise") } as PlayerState;
    const save = saveWith(state);
    const choiceVisibilities = evaluateLlmSceneChoices(arcProposal.choices, state, {
      terminal: false,
    });
    const projection = projectLlmDrivenScene({
      save,
      proposal: arcProposal,
      prose: "x",
      streamStatus: "complete",
      choiceVisibilities,
    });
    const bribe = projection.choices.find((c) => c.choice.id === "bribe");
    expect(bribe?.visibility).toBe("locked");
    expect(bribe?.lockedHint).toBe("Needs 999 gold");
    // The other two stay takeable (≥2 visible invariant holds).
    const visible = projection.choices.filter((c) => c.visibility === "visible");
    expect(visible.length).toBeGreaterThanOrEqual(2);
  });

  it("defaults choices to visible when no visibilities are passed (legacy)", () => {
    const save = saveWith(baseState());
    const projection = projectLlmDrivenScene({
      save,
      proposal: arcProposal,
      prose: "x",
      streamStatus: "complete",
    });
    expect(projection.choices.every((c) => c.visibility === "visible")).toBe(true);
    // Arc-less save → no arc summary on the projection.
    expect(projection.arc).toBeUndefined();
  });

  it("surfaces recentDiffs when provided", () => {
    const save = saveWith(baseState());
    const projection = projectLlmDrivenScene({
      save,
      proposal: arcProposal,
      prose: "x",
      streamStatus: "complete",
      recentDiffs: [{ kind: "stat", statId: "nerve", label: "Nerve", delta: 2 }],
    });
    expect(projection.recentDiffs).toEqual([
      { kind: "stat", statId: "nerve", label: "Nerve", delta: 2 },
    ]);
  });

  it("emits an EMPTY recentDiffs array when passed one (hidden-only sentinel, W1 polish B)", () => {
    const save = saveWith(baseState());
    const projection = projectLlmDrivenScene({
      save,
      proposal: arcProposal,
      prose: "x",
      streamStatus: "complete",
      recentDiffs: [],
    });
    // Present-but-empty → the "something shifted…" echo fires.
    expect(projection.recentDiffs).toEqual([]);
    expect("recentDiffs" in projection).toBe(true);
  });

  it("omits recentDiffs entirely when not passed (legacy turn)", () => {
    const save = saveWith(baseState());
    const projection = projectLlmDrivenScene({
      save,
      proposal: arcProposal,
      prose: "x",
      streamStatus: "complete",
    });
    expect(projection.recentDiffs).toBeUndefined();
  });
});

// ===========================================================================
// Story-engagement W2 projections (W2-S6 + W1 polish): check / clock / codex /
// npc diffs, arc quest fields, and the extended spoiler-absence guard.
// ===========================================================================

describe("buildVisibleDiffs W2 kinds (W2-S6)", () => {
  it("maps clock_advanced (reason already sanitised upstream)", () => {
    expect(
      buildVisibleDiffs(
        [{ kind: "clock_advanced", target: "clock", amount: 2, reason: "the bell tolls", visibility: "visible" }],
        baseState(),
      ),
    ).toEqual([{ kind: "clock", amount: 2, reason: "the bell tolls" }]);
  });

  it("maps disposition_shift to an npc diff with a delta band", () => {
    const state = baseState();
    state.npcs = { mira: { id: "mira", name: "Mira", role: "companion", disposition: 5, attributes: {}, knownFacts: [], flags: {} } } as never;
    const out = buildVisibleDiffs(
      [{ kind: "disposition_shift", target: "mira", prevDisposition: 10, delta: -5, visibility: "visible" }],
      state,
    );
    expect(out).toEqual([{ kind: "npc", npcId: "mira", name: "Mira", deltaBand: "down", fact: null }]);
  });

  it("maps fact_learned to an npc diff carrying the just-learned fact", () => {
    const state = baseState();
    state.npcs = { mira: { id: "mira", name: "Mira", role: "companion", disposition: 0, attributes: {}, knownFacts: ["you lied about the key"], flags: {} } } as never;
    const out = buildVisibleDiffs(
      [{ kind: "fact_learned", target: "mira", visibility: "visible" }],
      state,
    );
    expect(out).toEqual([{ kind: "npc", npcId: "mira", name: "Mira", fact: "you lied about the key" }]);
  });

  it("maps check_resolved to a check diff", () => {
    expect(
      buildVisibleDiffs(
        [{ kind: "check_resolved", target: "nerve", outcome: "fail", margin: -3, visibility: "visible" }],
        baseState(),
      ),
    ).toEqual([{ kind: "check", outcome: "fail", statId: "nerve", margin: -3 }]);
  });
});

describe("hasHiddenStateShift (W1 polish B)", () => {
  it("is true when a state-mutating diff is present", () => {
    expect(hasHiddenStateShift([{ kind: "stat", target: "dread", delta: -1 }])).toBe(true);
    expect(hasHiddenStateShift([{ kind: "flag_set", target: "pact", delta: true }])).toBe(true);
  });

  it("is false for bookkeeping-only diffs", () => {
    expect(
      hasHiddenStateShift([
        { kind: "node", target: "open:llm:3" },
        { kind: "choice_applied", target: "x" },
        { kind: "ending", target: "e" },
      ]),
    ).toBe(false);
  });
});

describe("deriveCheckOdds (W2-S6, phrase only — BC10)", () => {
  it("shifts one band by difficulty (mirrors the engine)", () => {
    const state = baseState(); // nerve 3 → "even"
    expect(deriveCheckOdds(state, { statId: "nerve", difficulty: "risky" })).toBe("even");
    expect(deriveCheckOdds(state, { statId: "nerve", difficulty: "easy" })).toBe("likely");
    expect(deriveCheckOdds(state, { statId: "nerve", difficulty: "desperate" })).toBe("risky");
  });
});

describe("projectArcSummary W1 polish + clock (W2-S6)", () => {
  it("surfaces protagonistWant, stakes, firedBeats, and the clock", () => {
    const arc = synthesizeFallbackArc("A drowned city waits for its heir.");
    const firedArc = fireBeat(arc, arc.beats[0]!.id, 4).arc;
    const state = { ...baseState(), arc: firedArc, clock: createClock("The candle burns") } as PlayerState;
    const summary = projectArcSummary(state);
    expect(summary?.protagonistWant).toBe(arc.protagonistWant);
    expect(summary?.stakes).toBe(arc.stakes);
    expect(summary?.firedBeats).toEqual([{ label: arc.beats[0]!.label, turnNumber: 4 }]);
    expect(summary?.clock).toEqual({ label: "The candle burns", value: 0, max: createClock().max });
  });
});

describe("projectLlmDrivenScene W2 (check / codex / spoiler discipline)", () => {
  const checkedProposal = proposal({
    prose: "The lock waits.",
    choices: [
      { id: "force", label: "Force the lock", skillCheck: { statId: "nerve", difficulty: "risky", successNote: "it gives", failNote: "it holds" } },
      { id: "wait", label: "Wait" },
    ],
    terminal: null,
  });

  it("projects a per-choice check summary with an engine odds phrase (never raw math)", () => {
    const save = saveWith({ ...baseState(), arc: synthesizeFallbackArc("premise") } as PlayerState);
    const projection = projectLlmDrivenScene({
      save,
      proposal: checkedProposal,
      prose: "x",
      streamStatus: "complete",
    });
    const forced = projection.choices.find((c) => c.choice.id === "force");
    expect(forced?.check).toEqual({ statId: "nerve", label: "Nerve", difficulty: "risky", odds: "even" });
    // No raw roll math leaked anywhere (BC10).
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain("threshold");
    expect(serialized).not.toContain("roll");
  });

  it("projects the codex from string flags (R11.1) and hides boolean/number flags", () => {
    const state = { ...baseState(), arc: synthesizeFallbackArc("premise") } as PlayerState;
    state.flags = { "van-state": "upside-down on Hwy 14", locked: true, count: 3 };
    (state as unknown as { flagSetTurns?: Record<string, number> }).flagSetTurns = { "van-state": 5 };
    const projection = projectLlmDrivenScene({
      save: saveWith(state),
      proposal: checkedProposal,
      prose: "x",
      streamStatus: "complete",
    });
    expect(projection.codex).toEqual([{ flag: "van-state", text: "upside-down on Hwy 14", turnNumber: 5 }]);
  });

  it("keeps the clock label out of any spoiler surface but still never leaks beats/candidates", () => {
    const arc = synthesizeFallbackArc("A drowned city waits.");
    const state = { ...baseState(), arc, clock: createClock("The tide rises") } as PlayerState;
    const projection = projectLlmDrivenScene({
      save: saveWith(state),
      proposal: checkedProposal,
      prose: "x",
      streamStatus: "complete",
    });
    expect(projection.arc?.clock?.label).toBe("The tide rises");
    const serialized = JSON.stringify(projection);
    for (const beat of arc.beats.filter((b) => b.status !== "fired")) {
      expect(serialized).not.toContain(beat.label);
    }
    for (const ending of arc.candidateEndings) expect(serialized).not.toContain(ending.label);
  });
});
