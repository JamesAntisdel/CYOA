import { describe, expect, it } from "vitest";

import {
  advanceLlmTurnCursor,
  createInitialState,
  llmNovelSceneOutputSchema,
  llmSceneOutputSchema,
  resolveReadingMode,
  sceneSchemaFor,
  type LlmNovelSceneProposal,
  type LlmSceneProposal,
  type Story,
} from "../src";

const ctx = { now: 1, rngSeed: "reading-modes-seed" };

// -----------------------------------------------------------------------------
// Shared fixtures
// -----------------------------------------------------------------------------

function novelDrivenStory(): Story {
  return {
    id: "quiet-shore",
    version: 1,
    title: "The Quiet Shore",
    startNodeId: "start",
    initialState: {
      vitality: 10,
      currency: 0,
      attributes: {},
      inventory: [],
      flags: {},
    },
    endings: {
      "ending-shore-return": { id: "ending-shore-return", label: "The Tide Returns", kind: "success" },
    },
    nodes: {
      start: { id: "start", seed: "A linear seed.", choices: [] },
    },
  };
}

function choice(id: string) {
  return { id, label: `Do ${id}.` };
}

/** Build a raw scene payload with exactly `n` distinct choices. */
function payloadWithChoices(n: number) {
  return {
    prose: "The shore breathes; a page waits to be turned.",
    choices: Array.from({ length: n }, (_, i) => choice(`c${i}`)),
    terminal: null,
  };
}

// -----------------------------------------------------------------------------
// R4.3 — additive novel schema accepts 0/1, rejects 2+
// -----------------------------------------------------------------------------

describe("llmNovelSceneOutputSchema — 0/1 choices accepted, 2+ rejected", () => {
  const cases: Array<{ count: number; ok: boolean }> = [
    { count: 0, ok: true },
    { count: 1, ok: true },
    { count: 2, ok: false },
    { count: 3, ok: false },
    { count: 4, ok: false },
  ];

  it.each(cases)("novel schema with $count choices → success=$ok", ({ count, ok }) => {
    const result = llmNovelSceneOutputSchema.safeParse(payloadWithChoices(count));
    expect(result.success).toBe(ok);
  });

  it("accepts a novel payload with the choices field ABSENT (defaults to [])", () => {
    // The novel prompt tells the model to emit prose+terminal ONLY — no
    // `choices` key at all. This is the exact shape that failed in production
    // (`{"path":"choices","code":"invalid_type","message":"Required"}`): the
    // field must tolerate being absent, not merely empty. The server stamps the
    // synthetic turn-page choice after validation.
    const result = llmNovelSceneOutputSchema.safeParse({
      prose: "The floor is fused marrow; a page waits to be turned.",
      terminal: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.choices).toEqual([]);
    }
  });

  it("accepts a single stamped 'turn-page' choice with no effects", () => {
    const result = llmNovelSceneOutputSchema.safeParse({
      prose: "Chapter one closes.",
      choices: [{ id: "turn-page", label: "Turn the page" }],
      terminal: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.choices).toHaveLength(1);
      expect(result.data.choices[0]?.id).toBe("turn-page");
    }
  });

  it("keeps every non-choices field identical to the branching schema", () => {
    // A prose-only novel payload still yields terminal / visualDescription /
    // beatFired exactly as branching does (RM3 rationale: prose-only payloads
    // must still surface these downstream).
    const parsed = llmNovelSceneOutputSchema.parse({
      prose: "A terminal chapter.",
      choices: [],
      terminal: { kind: "success", endingId: "ending-shore-return" },
      visualDescription: "A wide shot of a grey tide under a low sky.",
      beatFired: "midpoint",
    });
    expect(parsed.terminal?.kind).toBe("success");
    expect(parsed.visualDescription).toBeDefined();
    expect(parsed.beatFired).toBe("midpoint");
  });
});

// -----------------------------------------------------------------------------
// RM2 regression pin — the branching schema matrix is UNCHANGED
// -----------------------------------------------------------------------------

describe("llmSceneOutputSchema — branching matrix unchanged (regression pin)", () => {
  const cases: Array<{ count: number; ok: boolean }> = [
    { count: 0, ok: false },
    { count: 1, ok: false },
    { count: 2, ok: true },
    { count: 3, ok: true },
    { count: 4, ok: true },
    { count: 5, ok: false },
  ];

  it.each(cases)("branching schema with $count choices → success=$ok", ({ count, ok }) => {
    const result = llmSceneOutputSchema.safeParse(payloadWithChoices(count));
    expect(result.success).toBe(ok);
  });

  it("still rejects duplicate choice ids (superRefine preserved)", () => {
    const result = llmSceneOutputSchema.safeParse({
      prose: "Two forks that are secretly one.",
      choices: [choice("same"), { id: "same", label: "Also do same." }],
      terminal: null,
    });
    expect(result.success).toBe(false);
  });

  it("still strips a keepsake proposed on a non-terminal scene (transform preserved)", () => {
    const parsed = llmSceneOutputSchema.parse({
      prose: "No ending here.",
      choices: [choice("a"), choice("b")],
      terminal: null,
      keepsake: { id: "k", label: "Relic", description: "A worn coin." },
    });
    expect(parsed.keepsake).toBeUndefined();
  });
});

// The novel schema shares the SAME refine/transform, so it too must reject
// duplicate ids and strip a non-terminal keepsake — proof the factory reused
// the branching logic rather than forking it.
describe("llmNovelSceneOutputSchema shares the branching refine/transform", () => {
  it("rejects a duplicate choice id even within the 0/1 band is vacuous — but strips a non-terminal keepsake", () => {
    const parsed = llmNovelSceneOutputSchema.parse({
      prose: "A quiet chapter.",
      choices: [{ id: "turn-page", label: "Turn the page" }],
      terminal: null,
      keepsake: { id: "k", label: "Relic", description: "A worn coin." },
    });
    expect(parsed.keepsake).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// design §1.3 — sceneSchemaFor mapping (the ONLY mode→schema mapping)
// -----------------------------------------------------------------------------

describe("sceneSchemaFor — the only mode→schema mapping", () => {
  const cases: Array<{ mode: "branching" | "novel" | undefined; expectNovel: boolean }> = [
    { mode: "novel", expectNovel: true },
    { mode: "branching", expectNovel: false },
    { mode: undefined, expectNovel: false },
  ];

  it.each(cases)("readingMode=$mode → novel schema? $expectNovel", ({ mode, expectNovel }) => {
    const schema = sceneSchemaFor(mode);
    expect(schema).toBe(expectNovel ? llmNovelSceneOutputSchema : llmSceneOutputSchema);
  });

  it("selects a schema that actually gates by mode", () => {
    // A 1-choice payload is valid ONLY under the novel selection.
    const oneChoice = payloadWithChoices(1);
    expect(sceneSchemaFor("novel").safeParse(oneChoice).success).toBe(true);
    expect(sceneSchemaFor("branching").safeParse(oneChoice).success).toBe(false);
    expect(sceneSchemaFor(undefined).safeParse(oneChoice).success).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// R4.4 — both cursor paths resolve a synthetic `turn-page` choice
// -----------------------------------------------------------------------------

describe("advanceLlmTurnCursor — synthetic turn-page resolves on both paths", () => {
  function novelPriorProposal(): LlmNovelSceneProposal {
    // The server stamps this single { id: "turn-page" } choice (no effects)
    // AFTER validation; here we assert the ENGINE cursor resolves it cleanly.
    return llmNovelSceneOutputSchema.parse({
      prose: "Chapter one closes; the page waits.",
      choices: [{ id: "turn-page", label: "Turn the page" }],
      terminal: null,
    });
  }

  it("proposal-lookup path (freeform=false) resolves turn-page and applies empty effects", () => {
    const story = novelDrivenStory();
    const initial = createInitialState(story, "story", ctx.now, ctx.rngSeed);
    const prior = novelPriorProposal();

    const advanced = advanceLlmTurnCursor({
      state: initial,
      story,
      // Novel proposal is structurally a scene proposal — assignable here.
      priorProposal: prior as unknown as LlmSceneProposal,
      choiceId: "turn-page",
      ctx,
    });

    expect(advanced.appliedChoiceId).toBe("turn-page");
    expect(advanced.state.turnNumber).toBe(initial.turnNumber + 1);
    expect(advanced.state.currentNodeId).toBe(`quiet-shore:llm:${initial.turnNumber + 1}`);
    // Empty effects → state carries through unchanged (no vitality/currency move).
    expect(advanced.state.vitality).toBe(initial.vitality);
    expect(advanced.state.currency).toBe(initial.currency);
    expect(advanced.events.map((e) => e.kind)).toContain("choice_applied");
  });

  it("freeform=true no-lookup branch resolves turn-page without touching priorProposal", () => {
    const story = novelDrivenStory();
    const initial = createInitialState(story, "story", ctx.now, ctx.rngSeed);

    const advanced = advanceLlmTurnCursor({
      state: initial,
      story,
      // priorProposal deliberately null — the freeform branch never looks it up.
      priorProposal: null,
      choiceId: "turn-page",
      ctx,
      freeform: true,
    });

    expect(advanced.appliedChoiceId).toBe("turn-page");
    expect(advanced.state.turnNumber).toBe(initial.turnNumber + 1);
    expect(advanced.state.vitality).toBe(initial.vitality);
    expect(advanced.events.map((e) => e.kind)).toContain("choice_applied");
  });

  it("both paths avoid llm_choice_not_found — and the unstamped path proves why the stamp matters", () => {
    const story = novelDrivenStory();
    const initial = createInitialState(story, "story", ctx.now, ctx.rngSeed);
    const prior = novelPriorProposal();

    // Stamped proposal-lookup: no throw.
    expect(() =>
      advanceLlmTurnCursor({
        state: initial,
        story,
        priorProposal: prior as unknown as LlmSceneProposal,
        choiceId: "turn-page",
        ctx,
      }),
    ).not.toThrow();

    // Freeform: no throw even against a proposal that lacks turn-page.
    const noStamp = llmNovelSceneOutputSchema.parse({
      prose: "A chapter with no stamped choice yet.",
      choices: [],
      terminal: null,
    });
    expect(() =>
      advanceLlmTurnCursor({
        state: initial,
        story,
        priorProposal: noStamp as unknown as LlmSceneProposal,
        choiceId: "turn-page",
        ctx,
        freeform: true,
      }),
    ).not.toThrow();

    // Control: a proposal-lookup WITHOUT the stamp (and without freeform) IS
    // what throws — this is exactly the failure the server's stamp/ freeform
    // routing avoids (R4.4).
    expect(() =>
      advanceLlmTurnCursor({
        state: initial,
        story,
        priorProposal: noStamp as unknown as LlmSceneProposal,
        choiceId: "turn-page",
        ctx,
      }),
    ).toThrow(/llm_choice_not_found:turn-page/u);
  });
});

// -----------------------------------------------------------------------------
// R4.9 / RM5 — resolveReadingMode matrix (posture A)
// -----------------------------------------------------------------------------

describe("resolveReadingMode — pure resolver (posture A gate seam)", () => {
  const cases: Array<{
    desired?: "branching" | "novel";
    isPro: boolean;
    expected: "branching" | "novel";
  }> = [
    { isPro: false, expected: "branching" }, // desired absent (non-Pro)
    { isPro: true, expected: "branching" }, // desired absent (Pro)
    { desired: "branching", isPro: false, expected: "branching" },
    { desired: "branching", isPro: true, expected: "branching" },
    { desired: "novel", isPro: true, expected: "novel" }, // Pro passthrough
    { desired: "novel", isPro: false, expected: "branching" }, // posture-A degrade
  ];

  it.each(cases)(
    "desired=$desired isPro=$isPro → $expected",
    ({ desired, isPro, expected }) => {
      const input = desired !== undefined ? { desired, isPro } : { isPro };
      expect(resolveReadingMode(input)).toBe(expected);
    },
  );
});
