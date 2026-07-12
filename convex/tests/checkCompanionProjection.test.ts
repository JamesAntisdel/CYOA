// QW-LEGIBILITY — companion bond on the check chip. The projection surfaces a
// companion-support PHRASE ("Mira stands with you") on a choice's `check` when
// a visible companion attribute backs it — the same contributions
// `resolveChoiceCheck` folds into its score. Words only, never the bonus
// number (BC10): these tests pin both the phrase derivation and the projected
// wire shape through the `projectLlmDrivenScene` choke point.

import { describe, expect, it } from "vitest";

import {
  createInitialState,
  llmSceneOutputSchema,
  synthesizeFallbackArc,
  type LlmSceneProposal,
  type NpcState,
  type PlayerState,
  type Story,
} from "@cyoa/engine";

import {
  deriveCheckCompanionPhrase,
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

function companion(overrides: Partial<NpcState> = {}): NpcState {
  return {
    id: "mira",
    name: "Mira",
    role: "companion",
    disposition: 20,
    attributes: { nerve: { id: "nerve", label: "Nerve", value: 2, visibility: "visible" } },
    knownFacts: [],
    flags: {},
    ...overrides,
  };
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

const checkedProposal = proposal({
  prose: "The lock waits.",
  choices: [
    {
      id: "force",
      label: "Force the lock",
      skillCheck: { statId: "nerve", difficulty: "risky", successNote: "it gives", failNote: "it holds" },
    },
    { id: "wait", label: "Wait" },
  ],
  terminal: null,
});

describe("deriveCheckCompanionPhrase (phrase only — BC10)", () => {
  it("names a single helping companion", () => {
    const state = baseState();
    state.npcs = { mira: companion() };
    expect(deriveCheckCompanionPhrase(state, "nerve")).toBe("Mira stands with you");
  });

  it("joins two helping companions", () => {
    const state = baseState();
    state.npcs = {
      mira: companion(),
      torv: companion({
        id: "torv",
        name: "Torv",
        attributes: { nerve: { id: "nerve", label: "Nerve", value: 1, visibility: "visible" } },
      }),
    };
    expect(deriveCheckCompanionPhrase(state, "nerve")).toBe("Mira and Torv stand with you");
  });

  it("returns undefined with no roster / no matching visible attribute / non-companions", () => {
    expect(deriveCheckCompanionPhrase(baseState(), "nerve")).toBeUndefined();

    const hidden = baseState();
    hidden.npcs = {
      mira: companion({
        attributes: { nerve: { id: "nerve", label: "Nerve", value: 2, visibility: "hidden" } },
      }),
    };
    expect(deriveCheckCompanionPhrase(hidden, "nerve")).toBeUndefined();

    const rival = baseState();
    rival.npcs = { mira: companion({ role: "rival" }) };
    expect(deriveCheckCompanionPhrase(rival, "nerve")).toBeUndefined();
  });

  it("ignores a zero-value contribution — nobody 'stands with you' at +0", () => {
    const state = baseState();
    state.npcs = {
      mira: companion({
        attributes: { nerve: { id: "nerve", label: "Nerve", value: 0, visibility: "visible" } },
      }),
    };
    expect(deriveCheckCompanionPhrase(state, "nerve")).toBeUndefined();
  });
});

describe("projectLlmDrivenScene check.companion (wire shape)", () => {
  it("emits the phrase on the check and never the bonus number (BC10)", () => {
    const state = { ...baseState(), arc: synthesizeFallbackArc("premise") } as PlayerState;
    state.npcs = { mira: companion() };
    const projection = projectLlmDrivenScene({
      save: saveWith(state),
      proposal: checkedProposal,
      prose: "x",
      streamStatus: "complete",
    });
    const forced = projection.choices.find((c) => c.choice.id === "force");
    expect(forced?.check).toMatchObject({
      statId: "nerve",
      label: "Nerve",
      difficulty: "risky",
      companion: "Mira stands with you",
    });
    // The phrase carries no math — the serialized check has no bonus/threshold.
    const serialized = JSON.stringify(forced?.check);
    expect(serialized).not.toContain("threshold");
    expect(serialized).not.toContain("bonus");
    expect(serialized).not.toMatch(/companion[^"]*":\s*\d/);
  });

  it("omits the key entirely when no companion helps (legacy shape unchanged)", () => {
    const state = { ...baseState(), arc: synthesizeFallbackArc("premise") } as PlayerState;
    const projection = projectLlmDrivenScene({
      save: saveWith(state),
      proposal: checkedProposal,
      prose: "x",
      streamStatus: "complete",
    });
    const forced = projection.choices.find((c) => c.choice.id === "force");
    expect(forced?.check).toBeDefined();
    expect(forced?.check && "companion" in forced.check).toBe(false);
  });
});
