// W1-S1/S2 unit coverage for the server-side arc helpers: opening-turn arc
// creation (validate model arc / synthesize fallback / neutralise blocked
// strings), the pendingDirective stash+clear, and pursuit-context assembly.

import { describe, expect, it } from "vitest";

import type { ContentPolicyContext } from "@cyoa/shared";
import {
  createInitialState,
  synthesizeFallbackArc,
  type PlayerState,
  type Story,
} from "@cyoa/engine";

import {
  applyPendingDirective,
  buildPursuitContext,
  createArcForOpeningTurn,
  sanitizeArcStrings,
} from "../game";
import type { SaveRecord } from "../saves";

const story: Story = {
  id: "open-premise",
  version: 1,
  title: "Open Canvas",
  startNodeId: "start",
  initialState: { vitality: 5, currency: 0, attributes: {}, inventory: [], flags: {} },
  endings: {},
  nodes: { start: { id: "start", seed: "Begin.", choices: [] } },
};

const context: ContentPolicyContext = {
  surface: "generation",
  entitlementTier: "free",
  matureContentEnabled: false,
};

function openingState(): PlayerState {
  return createInitialState(story, "story", 1, "seed");
}

function openingSave(overrides: Partial<SaveRecord> = {}): SaveRecord {
  const state = openingState();
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
    turnNumber: 0,
    seedPremise: "A drowned city waits for its heir.",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const VALID_STORY_ARC = {
  dramaticQuestion: "Will you raise the drowned city or join its dead?",
  protagonistWant: "to break the tide-curse",
  stakes: "the city and everyone still breathing in it",
  beats: [
    { id: "inciting", label: "The seawall cracks", kind: "inciting", priorityHint: "early", requiredBeforeEnding: false },
    { id: "midpoint", label: "The bargain struck", kind: "midpoint", priorityHint: "mid", requiredBeforeEnding: false },
    { id: "climax", label: "The last bell tolls", kind: "climax", priorityHint: "late", requiredBeforeEnding: true },
  ],
  candidateEndings: [
    { id: "drowned-crown", label: "The Drowned Crown", hint: "the water wins" },
    { id: "risen-city", label: "The Risen City", hint: "the city breathes again" },
  ],
};

describe("createArcForOpeningTurn (W1-S1)", () => {
  it("uses the model's storyArc when valid", () => {
    const created = createArcForOpeningTurn({
      state: openingState(),
      proposal: { prose: "x", choices: [], storyArc: VALID_STORY_ARC } as any,
      save: openingSave(),
      context,
    });
    expect(created?.source).toBe("llm");
    expect(created?.state.arc?.dramaticQuestion).toBe(VALID_STORY_ARC.dramaticQuestion);
  });

  it("synthesizes a fallback arc when the model omits one", () => {
    const created = createArcForOpeningTurn({
      state: openingState(),
      proposal: { prose: "x", choices: [] } as any,
      save: openingSave(),
      context,
    });
    expect(created?.source).toBe("synthesized");
    expect(created?.state.arc).toBeDefined();
    // At least one required climax beat (R1.1).
    expect(created?.state.arc?.beats.some((b) => b.requiredBeforeEnding)).toBe(true);
  });

  it("only creates on the opening turn and only once", () => {
    // Not the opening turn.
    expect(
      createArcForOpeningTurn({
        state: openingState(),
        proposal: { prose: "x", choices: [] } as any,
        save: openingSave({ turnNumber: 3 }),
        context,
      }),
    ).toBeNull();
    // Arc already present.
    const withArc = { ...openingState(), arc: synthesizeFallbackArc("p") } as PlayerState;
    expect(
      createArcForOpeningTurn({
        state: withArc,
        proposal: { prose: "x", choices: [] } as any,
        save: openingSave(),
        context,
      }),
    ).toBeNull();
  });
});

describe("sanitizeArcStrings (R16.2)", () => {
  it("replaces a blocked string with a neutral placeholder, never throws", () => {
    const arc = synthesizeFallbackArc("premise");
    // A context whose classifier blocks self-harm phrasing; we assert the
    // structure is preserved and strings remain non-empty.
    const safe = sanitizeArcStrings(
      { ...arc, dramaticQuestion: "  " },
      context,
    );
    expect(safe.dramaticQuestion.length).toBeGreaterThan(0);
    expect(safe.beats).toHaveLength(arc.beats.length);
    expect(safe.candidateEndings).toHaveLength(arc.candidateEndings.length);
  });
});

describe("applyPendingDirective (W1-S2)", () => {
  it("stashes a directive on the state blob and clears it when null", () => {
    const state = openingState();
    const withDirective = applyPendingDirective(state, "surface_beat:climax");
    expect((withDirective as any).pendingDirective).toBe("surface_beat:climax");
    const cleared = applyPendingDirective(withDirective, null);
    expect((cleared as any).pendingDirective).toBeUndefined();
  });
});

describe("buildPursuitContext (W1-S3)", () => {
  it("returns undefined for arc-less saves", () => {
    expect(buildPursuitContext(openingState(), 3, [])).toBeUndefined();
  });

  it("surfaces the target beat, fired beats, directive, and thread fires", () => {
    const arc = synthesizeFallbackArc("A drowned city waits.");
    const firstBeat = arc.beats[0]!;
    let state = { ...openingState(), arc } as PlayerState;
    state = applyPendingDirective(state, `surface_beat:${firstBeat.id}`);
    const pursuit = buildPursuitContext(state, 5, ["the coin returns"]);
    expect(pursuit?.dramaticQuestion).toBe(arc.dramaticQuestion);
    expect(pursuit?.targetBeatId).toBeTypeOf("string");
    expect(pursuit?.directive).toBe("surface_beat");
    expect(pursuit?.surfaceBeatLabel).toBe(firstBeat.label);
    expect(pursuit?.threadFires).toEqual(["the coin returns"]);
    // Candidate endings are carried for the ENDINGS rule (ids + labels only).
    expect(pursuit?.candidateEndings.length).toBeGreaterThanOrEqual(2);
  });
});
