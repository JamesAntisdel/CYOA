import { describe, expect, it } from "vitest";

import { buildScenePrompt } from "../llm/prompts/scene";
import { parseSceneOutput } from "../llm/parse";
import { sceneGenerationRequestSchema } from "../llm/types";
import type { SceneGenerationRequest } from "../llm/types";

function llmRequest(
  overrides: Partial<SceneGenerationRequest> = {},
): SceneGenerationRequest {
  return {
    saveId: "save_1",
    storyId: "open-premise",
    storyTitle: "The Iron Court",
    nodeId: "open-premise:llm:3",
    seed: "A lantern flickers.",
    memory: ["Turn 1: opened the gate.", "Turn 2: chose the eastern corridor."],
    choices: [],
    sceneLength: "standard",
    contentContext: {
      surface: "generation",
      entitlementTier: "free",
      matureContentEnabled: false,
    },
    risk: "normal",
    entitlementTier: "free",
    retryCount: 0,
    mode: "llm-driven",
    playerState: {
      vitality: 5,
      currency: 0,
      visibleStats: [{ statId: "resolve", label: "Resolve", value: 3 }],
      hiddenStats: [],
      inventory: [{ id: "lantern", label: "Lantern" }],
      flags: {},
    },
    ...overrides,
  };
}

// An arc/pursuit request so the "arc/pursuit spine" survival can be asserted and
// the arc choice-consequence/gated-choice rules can be checked as dropped.
function arcRequest(
  overrides: Partial<SceneGenerationRequest> = {},
): SceneGenerationRequest {
  return llmRequest({
    turnNumber: 4,
    pursuit: {
      dramaticQuestion: "Will she reclaim the drowned city?",
      protagonistWant: "to raise the tide-gate",
      stakes: "the harbor floods at dawn",
      act: 2,
      firedBeatLabels: ["the warning bell"],
      targetBeatLabel: null,
      targetBeatId: null,
      candidateEndings: [
        { id: "ending-rise", label: "The Tide Answers" },
        { id: "ending-drown", label: "Salt and Silence" },
      ],
      threadFires: [],
    },
    ...overrides,
  });
}

describe("buildScenePrompt — novel mode variant (R4.5)", () => {
  it("drops the choice-count, divergence, and arc choice/gated rules", () => {
    const branching = buildScenePrompt(arcRequest());
    const novel = buildScenePrompt(arcRequest({ readingMode: "novel" }));

    // Branching keeps them (regression pin on the dropped rules).
    expect(branching).toContain("choices is an array of 2 to 4");
    expect(branching).toContain("CHOICE DIVERGENCE");
    expect(branching).toContain("CHOICE CONSEQUENCE");
    expect(branching).toContain("GATED CHOICE");

    // Novel drops the three named rule groups.
    expect(novel).not.toContain("choices is an array of 2 to 4");
    expect(novel).not.toContain("CHOICE DIVERGENCE");
    expect(novel).not.toContain("CHOICE CONSEQUENCE");
    expect(novel).not.toContain("GATED CHOICE");
  });

  it("emits a prose+terminal-only shape and instructs no choices array", () => {
    const novel = buildScenePrompt(llmRequest({ readingMode: "novel" }));
    expect(novel).toContain("LINEAR NOVEL");
    expect(novel).toContain("do NOT emit a `choices` array");
    // The prose+terminal-only JSON shape must not advertise a `choices` field.
    expect(novel).not.toContain('"choices": Choice[]');
    // Terminal handling is KEPT.
    expect(novel).toContain("terminal is null unless this scene is an ending");
  });

  it("keeps the narrative spine: anti-repetition, continuity, visual, arc/pursuit", () => {
    const novel = buildScenePrompt(arcRequest({ readingMode: "novel" }));
    expect(novel).toContain("ANTI-REPETITION");
    // Continuity block (turnNumber > 1).
    expect(novel).toContain("CONTINUITY (read before you write)");
    expect(novel).toContain("VISUAL DESCRIPTION");
    // Arc/pursuit spine survives: the pursuit section + the ENDINGS rule.
    expect(novel).toContain("YOUR PURSUIT");
    expect(novel).toContain("Will she reclaim the drowned city?");
    expect(novel).toContain("CANDIDATE ENDINGS");
  });

  it("leaves the branching prompt byte-identical when readingMode is absent", () => {
    const withoutField = buildScenePrompt(arcRequest());
    const explicitBranching = buildScenePrompt(
      arcRequest({ readingMode: "branching" }),
    );
    expect(explicitBranching).toBe(withoutField);
  });
});

describe("sceneGenerationRequestSchema — optional readingMode widening", () => {
  const base = {
    saveId: "s",
    storyId: "st",
    nodeId: "n",
    seed: "seed",
    memory: [],
    choices: [{ choiceId: "go", label: "Go" }],
    sceneLength: "standard" as const,
    contentContext: {
      surface: "generation" as const,
      entitlementTier: "free" as const,
      matureContentEnabled: false,
    },
    risk: "low" as const,
    entitlementTier: "free" as const,
    retryCount: 0,
  };

  it("tolerates an absent readingMode (deploy-skew safe)", () => {
    const parsed = sceneGenerationRequestSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.readingMode).toBeUndefined();
  });

  it("accepts an explicit novel readingMode", () => {
    const parsed = sceneGenerationRequestSchema.safeParse({
      ...base,
      readingMode: "novel",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.readingMode).toBe("novel");
  });

  it("rejects an unknown readingMode value", () => {
    const parsed = sceneGenerationRequestSchema.safeParse({
      ...base,
      readingMode: "audio",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("parseSceneOutput — novel schema selection at the SSE gate (RM3)", () => {
  const novelPayload = JSON.stringify({
    prose: "The tide climbed the harbor wall, and she watched it come.",
    choices: [],
    terminal: null,
  });
  const oneChoiceNovelPayload = JSON.stringify({
    prose: "She turned the page of the drowned ledger.",
    choices: [{ id: "onward", label: "Onward" }],
    terminal: null,
  });

  it("accepts a 0-choice novel payload as a proposal under novel mode", () => {
    const parsed = parseSceneOutput(novelPayload, "novel");
    expect(parsed.proposal).toBeDefined();
    expect(parsed.proposal?.choices).toHaveLength(0);
    expect(parsed.prose).toContain("The tide climbed");
  });

  it("accepts a 1-choice novel payload as a proposal under novel mode", () => {
    const parsed = parseSceneOutput(oneChoiceNovelPayload, "novel");
    expect(parsed.proposal).toBeDefined();
    expect(parsed.proposal?.choices).toHaveLength(1);
  });

  it("rejects the same 0-choice payload under branching (no proposal, authored fallback)", () => {
    // Under branching, min(2) rejects → falls through to authoredSceneSchema,
    // which requires prose (present here) and yields NO proposal. A null
    // proposal is exactly what makes completeSceneStream throw for novel — so
    // this proves the mode flag is load-bearing.
    const parsed = parseSceneOutput(novelPayload);
    expect(parsed.proposal).toBeUndefined();
    expect(parsed.prose).toContain("The tide climbed");
  });

  it("still accepts a 2-choice branching payload under branching mode", () => {
    const branchingPayload = JSON.stringify({
      prose: "Two doors faced her in the dark.",
      choices: [
        { id: "left", label: "Take the left door" },
        { id: "right", label: "Take the right door" },
      ],
      terminal: null,
    });
    const parsed = parseSceneOutput(branchingPayload);
    expect(parsed.proposal).toBeDefined();
    expect(parsed.proposal?.choices).toHaveLength(2);
  });
});
