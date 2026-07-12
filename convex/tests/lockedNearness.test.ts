// Near-miss band threading through the projection choke point (locked-UX
// polish). `projectLlmDrivenScene` forwards the engine's `nearness` band on a
// locked choice as a PHRASE — never the stat value or threshold (BC10, same
// discipline as the check odds phrase) — and scrubs a stale band from any
// entry the engine flipped back to visible.

import { describe, expect, it } from "vitest";

import {
  createInitialState,
  evaluateLlmSceneChoices,
  llmSceneOutputSchema,
  type LlmSceneProposal,
  type PlayerState,
  type Story,
} from "@cyoa/engine";

import { projectLlmDrivenScene, type SaveRecord } from "../saves";

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

const gatedProposal = () =>
  proposal({
    prose: "The gate waits.",
    choices: [
      { id: "a", label: "Walk on." },
      { id: "b", label: "Rest." },
      {
        id: "gated",
        label: "Force the gate.",
        lockedHint: "Your hands shake on the bar.",
        conditions: [{ kind: "stat_at_least", statId: "nerve", value: 4 }],
      },
    ],
    terminal: null,
  });

function project(choiceVisibilities: Parameters<typeof projectLlmDrivenScene>[0]["choiceVisibilities"]) {
  return projectLlmDrivenScene({
    save: saveWith(baseState()),
    proposal: gatedProposal(),
    prose: "The gate waits.",
    streamStatus: "complete",
    ...(choiceVisibilities !== undefined ? { choiceVisibilities } : {}),
  });
}

describe("projectLlmDrivenScene near-miss band (BC10 phrase-only)", () => {
  it("forwards the band on a locked choice alongside its lockedHint", () => {
    const projection = project([
      { choiceId: "gated", visibility: "locked", lockedHint: "Your hands shake.", nearness: "near" },
    ]);
    const gated = projection.choices.find((entry) => entry.choice.id === "gated");
    expect(gated).toMatchObject({
      visibility: "locked",
      lockedHint: "Your hands shake.",
      nearness: "near",
    });
    // Phrase only — no numbers ride the projected choice (BC10).
    expect(JSON.stringify(gated)).not.toMatch(/threshold|deficit|"value"/);
  });

  it("omits the band on legacy visibility entries that never computed one", () => {
    const projection = project([
      { choiceId: "gated", visibility: "locked", lockedHint: "Your hands shake." },
    ]);
    const gated = projection.choices.find((entry) => entry.choice.id === "gated");
    expect(gated?.visibility).toBe("locked");
    expect(gated).not.toHaveProperty("nearness");
  });

  it("scrubs a stale band from an entry the engine unlocked", () => {
    const projection = project([
      // The scene invariants can flip a locked result visible without deleting
      // the band; the projection must not forward it on a visible choice.
      { choiceId: "gated", visibility: "visible", nearness: "near" },
    ]);
    const gated = projection.choices.find((entry) => entry.choice.id === "gated");
    expect(gated?.visibility).toBe("visible");
    expect(gated).not.toHaveProperty("nearness");
  });

  it("threads the engine-computed band end-to-end (nerve 3 vs 4 → near)", () => {
    const state = baseState();
    const visibilities = evaluateLlmSceneChoices(gatedProposal().choices, state, {
      terminal: false,
    });
    const projection = projectLlmDrivenScene({
      save: saveWith(state),
      proposal: gatedProposal(),
      prose: "The gate waits.",
      streamStatus: "complete",
      choiceVisibilities: visibilities,
    });
    const gated = projection.choices.find((entry) => entry.choice.id === "gated");
    expect(gated).toMatchObject({ visibility: "locked", nearness: "near" });
  });
});
