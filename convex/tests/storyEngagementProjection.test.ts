// Pure-projection tests for story-engagement W1-S4: the redacted `recentDiffs`
// wire mapping, the arc summary (count-only, spoiler-free), and the locked
// choice projection. These exercise the `convex/saves.ts` choke point where
// BC10 spoiler discipline is enforced.

import { describe, expect, it } from "vitest";

import {
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
});
