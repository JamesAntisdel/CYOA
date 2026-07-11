// W3-M2: post-terminal What-Might-Have-Been projection (R14) + BC10 spoiler
// discipline — candidate endings surface ONLY once the save has reached a
// terminal, and never leak while the run is live.

import { describe, expect, it } from "vitest";

import {
  createInitialState,
  synthesizeFallbackArc,
  type PlayerState,
  type Story,
  type StoryArc,
  type TerminalResult,
} from "@cyoa/engine";

import { projectLlmDrivenScene, projectWhatMightHaveBeen, type SaveRecord } from "../saves";

const story: Story = {
  id: "open-premise",
  version: 1,
  title: "Open Canvas",
  startNodeId: "start",
  initialState: { vitality: 5, currency: 0, attributes: {}, inventory: [], flags: {} },
  endings: {},
  nodes: { start: { id: "start", seed: "Begin.", choices: [] } },
};

function arcState(): PlayerState {
  const arc: StoryArc = synthesizeFallbackArc("A drowned city waits.");
  return { ...createInitialState(story, "story", 1, "seed"), arc };
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

const terminal: TerminalResult = { endingId: "triumph", kind: "success" };

describe("projectWhatMightHaveBeen (pure)", () => {
  it("returns [] pre-terminal (BC10 — no candidate leaks)", () => {
    expect(projectWhatMightHaveBeen(arcState(), null)).toEqual([]);
  });

  it("returns UNREACHED candidates (reached ending excluded) post-terminal", () => {
    const out = projectWhatMightHaveBeen(arcState(), terminal);
    // synthesizeFallbackArc → candidates [triumph, ruin]; reached triumph.
    expect(out.map((c) => c.label)).toEqual(["The quiet ruin"]);
    expect(out[0]?.hint).toContain("question answers you");
  });

  it("returns [] for arc-less / legacy saves", () => {
    const legacy = createInitialState(story, "story", 1, "seed");
    expect(projectWhatMightHaveBeen(legacy, terminal)).toEqual([]);
  });

  it("caps at 2 cards", () => {
    const state = arcState();
    (state.arc as StoryArc).candidateEndings = [
      { id: "a", label: "A", hint: "" },
      { id: "b", label: "B", hint: "" },
      { id: "c", label: "C", hint: "" },
      { id: "d", label: "D", hint: "" },
    ];
    expect(projectWhatMightHaveBeen(state, { endingId: "z", kind: "success" }).length).toBe(2);
  });
});

describe("projectLlmDrivenScene ending field (R14 wire shape)", () => {
  it("omits `ending` while the save is live", () => {
    const projection = projectLlmDrivenScene({
      save: saveWith(arcState()),
      proposal: null,
      prose: "The tide rises.",
      streamStatus: "complete",
    });
    expect(projection.ending).toBeUndefined();
    // And nothing spoiler-y leaks anywhere pre-terminal.
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain("The quiet ruin");
  });

  it("emits `ending.whatMightHaveBeen` on a terminal scene", () => {
    const projection = projectLlmDrivenScene({
      save: saveWith(arcState()),
      proposal: null,
      prose: "The gate closes.",
      streamStatus: "complete",
      terminal,
    });
    expect(projection.ending?.whatMightHaveBeen.map((c) => c.label)).toEqual(["The quiet ruin"]);
  });
});
