import { describe, expect, it } from "vitest";

import { llmSceneOutputSchema, type NpcState } from "@cyoa/engine";

import {
  buildNpcSheets,
  buildScenePrompt,
  mapDispositionToVibe,
  type NpcSheet,
} from "../llm/prompts/scene";
import type { SceneGenerationRequest } from "../llm/types";

function npc(overrides: Partial<NpcState> & Pick<NpcState, "id" | "name">): NpcState {
  return {
    role: "neutral",
    disposition: 0,
    attributes: {},
    knownFacts: [],
    flags: {},
    ...overrides,
  } as NpcState;
}

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

describe("mapDispositionToVibe", () => {
  it("maps the canonical band thresholds", () => {
    expect(mapDispositionToVibe(100)).toBe("friendly");
    expect(mapDispositionToVibe(50)).toBe("friendly");
    expect(mapDispositionToVibe(49)).toBe("warm");
    expect(mapDispositionToVibe(10)).toBe("warm");
    expect(mapDispositionToVibe(9)).toBe("neutral");
    expect(mapDispositionToVibe(0)).toBe("neutral");
    expect(mapDispositionToVibe(-10)).toBe("neutral");
    expect(mapDispositionToVibe(-11)).toBe("wary");
    expect(mapDispositionToVibe(-50)).toBe("wary");
    expect(mapDispositionToVibe(-51)).toBe("hostile");
    expect(mapDispositionToVibe(-100)).toBe("hostile");
  });
});

describe("buildNpcSheets", () => {
  it("returns an empty array when no npcs are provided", () => {
    expect(
      buildNpcSheets({ npcs: {}, currentNodeId: "node-1", recentMentions: [] }),
    ).toEqual([]);
  });

  it("respects the cap and prefers location-matches over recent mentions", () => {
    const npcs: Record<string, NpcState> = {
      mira: npc({ id: "mira", name: "Mira", role: "companion", disposition: 30, location: "node-1" }),
      bram: npc({ id: "bram", name: "Bram", role: "rival", disposition: -20, location: "node-1" }),
      cole: npc({ id: "cole", name: "Cole", role: "ally", disposition: 60, location: "node-2" }),
      dela: npc({ id: "dela", name: "Dela", role: "neutral", disposition: 0, location: "node-2" }),
      enid: npc({ id: "enid", name: "Enid", role: "antagonist", disposition: -80, location: "node-2" }),
      fyn: npc({ id: "fyn", name: "Fyn", role: "ally", disposition: 5, location: "node-1" }),
    };
    const sheets = buildNpcSheets({
      npcs,
      currentNodeId: "node-1",
      recentMentions: ["cole", "dela", "enid"],
    });
    // Cap is 5 — first the three location-matches (mira, bram, fyn) then two
    // recent mentions (cole, dela).
    expect(sheets).toHaveLength(5);
    expect(sheets.map((s) => s.name)).toEqual(["Mira", "Bram", "Fyn", "Cole", "Dela"]);
    // 'enid' is dropped by the cap even though they're a recent mention.
    expect(sheets.find((s) => s.name === "Enid")).toBeUndefined();
  });

  it("preserves recentMentions order when the same NPC isn't also in-location", () => {
    const npcs: Record<string, NpcState> = {
      a: npc({ id: "a", name: "Ari", disposition: 0 }),
      b: npc({ id: "b", name: "Bea", disposition: 0 }),
      c: npc({ id: "c", name: "Cee", disposition: 0 }),
    };
    const sheets = buildNpcSheets({
      npcs,
      currentNodeId: "elsewhere",
      recentMentions: ["c", "a", "b"],
    });
    expect(sheets.map((s) => s.name)).toEqual(["Cee", "Ari", "Bea"]);
  });

  it("location-match wins over a competing recent-mention placement", () => {
    const npcs: Record<string, NpcState> = {
      a: npc({ id: "a", name: "Ari", disposition: 0 }), // mentioned only
      b: npc({ id: "b", name: "Bea", disposition: 0, location: "here" }), // location-match
    };
    const sheets = buildNpcSheets({
      npcs,
      currentNodeId: "here",
      recentMentions: ["a", "b"],
    });
    expect(sheets.map((s) => s.name)).toEqual(["Bea", "Ari"]);
  });

  it("filters hidden attributes from the sheet", () => {
    const npcs: Record<string, NpcState> = {
      mira: npc({
        id: "mira",
        name: "Mira",
        role: "companion",
        disposition: 30,
        location: "here",
        attributes: {
          resolve: { id: "resolve", label: "Resolve", value: 4, visibility: "visible" },
          stealth: { id: "stealth", label: "Stealth", value: 2, visibility: "visible" },
          secretGrudge: {
            id: "secretGrudge",
            label: "SecretGrudge",
            value: 9,
            visibility: "hidden",
          },
        },
      }),
    };
    const sheets = buildNpcSheets({ npcs, currentNodeId: "here", recentMentions: [] });
    expect(sheets[0]?.attributes.map((a) => a.label)).toEqual(["Resolve", "Stealth"]);
    expect(sheets[0]?.attributes.find((a) => a.label === "SecretGrudge")).toBeUndefined();
  });

  it("trims knownFacts to the top 3 and maps disposition to a vibe", () => {
    const npcs: Record<string, NpcState> = {
      bram: npc({
        id: "bram",
        name: "Bram",
        role: "rival",
        disposition: -30,
        location: "here",
        knownFacts: [
          "owes a debt to the cathedral",
          "carries a hidden ledger",
          "lost an eye in the war",
          "secretly hates iron",
        ],
      }),
    };
    const sheets = buildNpcSheets({ npcs, currentNodeId: "here", recentMentions: [] });
    expect(sheets[0]?.knownFacts).toEqual([
      "owes a debt to the cathedral",
      "carries a hidden ledger",
      "lost an eye in the war",
    ]);
    expect(sheets[0]?.vibe).toBe("wary");
  });

  it("drops unknown ids from recentMentions silently", () => {
    const npcs: Record<string, NpcState> = {
      mira: npc({ id: "mira", name: "Mira" }),
    };
    const sheets = buildNpcSheets({
      npcs,
      currentNodeId: "elsewhere",
      recentMentions: ["ghost", "mira"],
    });
    expect(sheets.map((s) => s.name)).toEqual(["Mira"]);
  });

  it("handles cap=0 by returning empty", () => {
    const npcs: Record<string, NpcState> = {
      mira: npc({ id: "mira", name: "Mira", location: "here" }),
    };
    expect(
      buildNpcSheets({ npcs, currentNodeId: "here", recentMentions: [], cap: 0 }),
    ).toEqual([]);
  });

  it("handles a null currentNodeId by relying solely on recent mentions", () => {
    const npcs: Record<string, NpcState> = {
      mira: npc({ id: "mira", name: "Mira", location: "here" }),
      bram: npc({ id: "bram", name: "Bram" }),
    };
    const sheets = buildNpcSheets({
      npcs,
      currentNodeId: null,
      recentMentions: ["bram"],
    });
    expect(sheets.map((s) => s.name)).toEqual(["Bram"]);
  });
});

describe("buildScenePrompt npc section", () => {
  it("inserts a Characters in scope block when sheets are present", () => {
    const sheets: NpcSheet[] = [
      {
        name: "Mira",
        role: "companion",
        vibe: "warm",
        knownFacts: [
          "trained as a lamp-lighter",
          "hates iron court",
          "lost her sister",
        ],
        attributes: [
          { label: "Resolve", value: 4 },
          { label: "Stealth", value: 2 },
        ],
      },
      {
        name: "Bram",
        role: "rival",
        vibe: "wary",
        knownFacts: ["owes a debt to the cathedral", "carries a hidden ledger"],
        attributes: [],
      },
    ];
    const prompt = buildScenePrompt(llmRequest({ npcSheets: sheets }));
    expect(prompt).toContain("Characters in scope (5 max, most relevant first):");
    expect(prompt).toContain("- Mira (companion, warm)");
    expect(prompt).toContain(
      "Knows: trained as a lamp-lighter, hates iron court, lost her sister",
    );
    expect(prompt).toContain("Resolve 4, Stealth 2");
    expect(prompt).toContain("- Bram (rival, wary)");
    expect(prompt).toContain("Knows: owes a debt to the cathedral, carries a hidden ledger");
    // The section sits between the player-state block and the output-rules block.
    const playerIdx = prompt.indexOf("Current player state:");
    const charactersIdx = prompt.indexOf("Characters in scope");
    const outputRulesIdx = prompt.indexOf("Output rules");
    expect(playerIdx).toBeGreaterThan(-1);
    expect(charactersIdx).toBeGreaterThan(playerIdx);
    expect(outputRulesIdx).toBeGreaterThan(charactersIdx);
  });

  it("omits the section entirely when no sheets are in scope", () => {
    const prompt = buildScenePrompt(llmRequest());
    expect(prompt).not.toContain("Characters in scope");
    // No "no characters in scope" placeholder line — the section is dropped
    // entirely rather than emitted with a placeholder.
    expect(prompt).not.toContain("no characters in scope");
  });

  it("omits the section when the npcSheets array is empty", () => {
    const prompt = buildScenePrompt(llmRequest({ npcSheets: [] }));
    expect(prompt).not.toContain("Characters in scope");
  });
});

describe("LLM proposal NPC-mutation guard (Requirement 31.2)", () => {
  // The proposal schema may only carry presentational NPC metadata. State-
  // mutating `npc_*` effect kinds must never be applied — all NPC mutations
  // flow through engine-authored effects, never through the LLM proposal.
  // They are DROPPED at the parse boundary (not rejected wholesale), so one
  // stray npc_* effect can't hard-fail the turn while the guarantee holds.
  const npcEffectKinds = [
    "npc_spawn",
    "npc_despawn",
    "npc_relocate",
    "npc_disposition_delta",
    "npc_attribute_delta",
    "npc_inventory_add",
    "npc_inventory_remove",
    "npc_flag_set",
    "npc_learn_fact",
  ] as const;

  for (const kind of npcEffectKinds) {
    it(`drops ${kind} effect from a proposal choice (never applied)`, () => {
      const proposal = {
        prose: "Mira looks up from the lantern.",
        choices: [
          {
            id: "ask",
            label: "Ask Mira about her sister",
            effects: [{ kind, npcId: "mira" }],
          },
          { id: "leave", label: "Leave quietly" },
        ],
        terminal: null,
      };
      const parsed = llmSceneOutputSchema.safeParse(proposal);
      // Parse succeeds (scene survives); the npc_* effect is dropped so the
      // LLM never mutates NPC state.
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.choices[0]?.effects).toEqual([]);
        expect(parsed.data.choices).toHaveLength(2);
      }
    });
  }
});

describe("buildScenePrompt opener + premise anchor (coherence fixes)", () => {
  it("drops the hardcoded 'gothic story' opener so non-fantasy premises stay on-genre", () => {
    const prompt = buildScenePrompt(llmRequest());
    expect(prompt).not.toContain("gothic");
    expect(prompt).toContain('You are the unseen narrator of an interactive story called "The Iron Court".');
  });

  it("appends storyTone to the opener when present", () => {
    const prompt = buildScenePrompt(llmRequest({ storyTone: "wry and clipped" }));
    expect(prompt).toContain('"The Iron Court". Tone: wry and clipped.');
  });

  it("falls back to storyId when storyTitle is missing", () => {
    const { storyTitle: _omit, ...withoutTitle } = llmRequest();
    const prompt = buildScenePrompt(withoutTitle as SceneGenerationRequest);
    expect(prompt).toContain('called "open-premise"');
  });

  it("emits the world-anchor block near the top of the prompt and quotes the premise", () => {
    const premise = "A derelict generation ship drifts past a dying star; you are the last steward awake.";
    const prompt = buildScenePrompt(llmRequest({ premise }));
    expect(prompt).toContain("WORLD ANCHOR");
    expect(prompt).toContain(premise);
    expect(prompt).toContain("do not introduce candles, cathedrals, lanterns");
    // Anchor sits above the player-state block so the LLM weights it heavily.
    const anchorIdx = prompt.indexOf("WORLD ANCHOR");
    const playerIdx = prompt.indexOf("Current player state:");
    const rulesIdx = prompt.indexOf("Output rules");
    expect(anchorIdx).toBeGreaterThan(-1);
    expect(anchorIdx).toBeLessThan(playerIdx);
    expect(playerIdx).toBeLessThan(rulesIdx);
  });

  it("omits the WORLD ANCHOR block entirely when no premise is set", () => {
    const prompt = buildScenePrompt(llmRequest());
    expect(prompt).not.toContain("WORLD ANCHOR");
  });

  it("carries the early-terminal soft nudge in the output rules", () => {
    const prompt = buildScenePrompt(llmRequest());
    expect(prompt).toContain("Do not set the `terminal` field before turn 6");
    expect(prompt).toContain("unless the reader's choice explicitly forces a death");
  });
});

// ===========================================================================
// Story-arc pursuit section + rules (W1-S3, R1.3 / R6.1 / R2.5 / R3.3 / R4).
// ===========================================================================

import type { PursuitPromptContext } from "../llm/types";

function pursuitFixture(
  overrides: Partial<PursuitPromptContext> = {},
): PursuitPromptContext {
  return {
    dramaticQuestion: "Will you free the drowned city or drown with it?",
    protagonistWant: "to break the tide-curse before the last bell",
    stakes: "the drowned city and every soul still breathing in it",
    act: 2,
    firedBeatLabels: ["The bargain struck"],
    targetBeatLabel: "The flood gate breaks",
    targetBeatId: "flood-gate-breaks",
    candidateEndings: [
      { id: "drowned-crown", label: "The Drowned Crown" },
      { id: "risen-city", label: "The Risen City" },
    ],
    threadFires: [],
    ...overrides,
  };
}

describe("buildScenePrompt pursuit section (W1-S3)", () => {
  it("renders the pursuit section ABOVE the memory window", () => {
    const prompt = buildScenePrompt(llmRequest({ pursuit: pursuitFixture() }));
    const pursuitIdx = prompt.indexOf("== YOUR PURSUIT");
    const memoryIdx = prompt.indexOf("Recent story memory");
    expect(pursuitIdx).toBeGreaterThan(-1);
    expect(memoryIdx).toBeGreaterThan(-1);
    expect(pursuitIdx).toBeLessThan(memoryIdx);
    expect(prompt).toContain("Dramatic question: Will you free the drowned city");
    expect(prompt).toContain("Act 2. Beats already landed: The bargain struck.");
  });

  it("omits the whole pursuit section on arc-less (legacy) saves", () => {
    const prompt = buildScenePrompt(llmRequest());
    expect(prompt).not.toContain("== YOUR PURSUIT");
    expect(prompt).not.toContain("STEER TOWARD");
  });

  it("surfaces the steer-toward beat + beatFired instruction", () => {
    const prompt = buildScenePrompt(llmRequest({ pursuit: pursuitFixture() }));
    expect(prompt).toContain('STEER TOWARD (subtly, within 1-2 scenes): "The flood gate breaks".');
    expect(prompt).toContain('set "beatFired": "flood-gate-breaks"');
  });

  it("injects the surface_beat directive line", () => {
    const prompt = buildScenePrompt(
      llmRequest({
        pursuit: pursuitFixture({
          directive: "surface_beat",
          surfaceBeatLabel: "The flood gate breaks",
        }),
      }),
    );
    expect(prompt).toContain("The story tried to end too early");
    expect(prompt).toContain('must put "The flood gate breaks" on stage');
  });

  it("injects the costly-survival directive line", () => {
    const prompt = buildScenePrompt(
      llmRequest({
        pursuit: pursuitFixture({ directive: "narrate_costly_survival" }),
      }),
    );
    expect(prompt).toContain("The reader survives, barely");
    expect(prompt).toContain("do NOT set terminal this scene");
  });

  it("narrates fired-thread callbacks", () => {
    const prompt = buildScenePrompt(
      llmRequest({
        pursuit: pursuitFixture({ threadFires: ["the ferryman's coin, still cold in your pocket"] }),
      }),
    );
    expect(prompt).toContain(
      'A THREAD FIRES THIS SCENE: "the ferryman\'s coin, still cold in your pocket" — narrate the callback.',
    );
  });

  it("emits the arc rules only on arc saves", () => {
    const withArc = buildScenePrompt(llmRequest({ pursuit: pursuitFixture() }));
    expect(withArc).toContain("CHOICE CONSEQUENCE");
    expect(withArc).toContain("GATED CHOICE");
    expect(withArc).toContain("THREADS (foreshadowing");
    expect(withArc).toContain("ENDINGS — when this scene is the ending");
    const withoutArc = buildScenePrompt(llmRequest());
    expect(withoutArc).not.toContain("CHOICE CONSEQUENCE");
    expect(withoutArc).not.toContain("GATED CHOICE");
  });

  it("emits the STORY ARC production block only when produceArc is set", () => {
    const producing = buildScenePrompt(llmRequest({ produceArc: true }));
    expect(producing).toContain("STORY ARC (REQUIRED on turn 1 ONLY");
    expect(producing).toContain("dramaticQuestion");
    const notProducing = buildScenePrompt(llmRequest());
    expect(notProducing).not.toContain("STORY ARC (REQUIRED on turn 1 ONLY");
  });

  it("keeps the existing anti-repetition + stat-narration rules alongside the arc rules", () => {
    const prompt = buildScenePrompt(llmRequest({ pursuit: pursuitFixture() }));
    expect(prompt).toContain("ANTI-REPETITION");
    expect(prompt).toContain("STAT CHANGES MUST BE NARRATED");
  });
});

describe("W2 prompt sections (W2-S3)", () => {
  it("renders clock escalation copy by directive, above the memory window", () => {
    const at75 = buildScenePrompt(
      llmRequest({
        pursuit: pursuitFixture({
          clock: { label: "The candle burns", value: 9, max: 12, directive: "escalate_75" },
        }),
      }),
    );
    expect(at75).toContain("The candle burns is at 9/12 — time is nearly gone");
    const expired = buildScenePrompt(
      llmRequest({
        pursuit: pursuitFixture({
          clock: { label: "The candle burns", value: 12, max: 12, directive: "climax_now" },
        }),
      }),
    );
    expect(expired).toContain("has run out");
    expect(expired).toContain("Move DIRECTLY into the climax");
    // `none` prints no escalation line.
    const early = buildScenePrompt(
      llmRequest({
        pursuit: pursuitFixture({
          clock: { label: "The candle burns", value: 1, max: 12, directive: "none" },
        }),
      }),
    );
    expect(early).not.toContain("is at 1/12");
  });

  it("renders the CHECK OUTCOME block above the memory window and forbids overruling", () => {
    const prompt = buildScenePrompt(
      llmRequest({
        checkOutcome: { outcome: "fail", statId: "Nerve", margin: -1, note: "the lock held" },
      }),
    );
    const checkIdx = prompt.indexOf("== CHECK OUTCOME");
    const memoryIdx = prompt.indexOf("Recent story memory");
    expect(checkIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeLessThan(memoryIdx);
    expect(prompt).toContain("FAILED (Nerve, barely)");
    expect(prompt).toContain("do NOT overrule it");
    expect(prompt).toContain('Flavor to weave in: "the lock held"');
  });

  it("omits the CHECK OUTCOME block when no check fired", () => {
    expect(buildScenePrompt(llmRequest())).not.toContain("== CHECK OUTCOME");
  });

  it("emits the W2 rules only on arc saves", () => {
    const withArc = buildScenePrompt(llmRequest({ pursuit: pursuitFixture() }));
    expect(withArc).toContain("RELATIONSHIPS (R8.5)");
    expect(withArc).toContain("SKILL CHECKS (R7.1)");
    expect(withArc).toContain("SCARCITY (R10)");
    expect(withArc).toContain("CODEX (R11.3)");
    const withoutArc = buildScenePrompt(llmRequest());
    expect(withoutArc).not.toContain("RELATIONSHIPS (R8.5)");
    expect(withoutArc).not.toContain("SKILL CHECKS (R7.1)");
  });
});

describe("pursuit spoiler discipline (BC10, W1-S3)", () => {
  it("shows candidate-ending labels ONLY in the ENDINGS rule", () => {
    const prompt = buildScenePrompt(llmRequest({ pursuit: pursuitFixture() }));
    // Candidate label appears exactly once — inside the endings rule, never
    // echoed into the pursuit section or elsewhere.
    const occurrences = prompt.split("The Drowned Crown").length - 1;
    expect(occurrences).toBe(1);
    const endingsRuleIdx = prompt.indexOf("ENDINGS — when this scene is the ending");
    const labelIdx = prompt.indexOf("The Drowned Crown");
    expect(labelIdx).toBeGreaterThan(endingsRuleIdx);
    // Not present in the pursuit section itself.
    const pursuitSection = prompt.slice(
      prompt.indexOf("== YOUR PURSUIT"),
      prompt.indexOf("Recent story memory"),
    );
    expect(pursuitSection).not.toContain("The Drowned Crown");
  });

  it("shows the pending target-beat label ONLY in the steer line", () => {
    const prompt = buildScenePrompt(llmRequest({ pursuit: pursuitFixture() }));
    // The pending beat label appears once (steer line). A fired beat label may
    // appear in "Beats already landed" — that's not a spoiler (reader lived it).
    const occurrences = prompt.split("The flood gate breaks").length - 1;
    expect(occurrences).toBe(1);
  });
});

describe("pursuit token budget (W2-S3, ≤ baseline + 1400 cumulative tokens)", () => {
  it("stays within the W1+W2 cumulative budget on a worst-case arc prompt", () => {
    const baseline = buildScenePrompt(llmRequest());
    // Worst case: full pursuit + directive + fired thread + clock escalation +
    // arc production + all W2 rules (relationships / checks / scarcity / codex).
    const worst = buildScenePrompt(
      llmRequest({
        produceArc: true,
        pursuit: pursuitFixture({
          firedBeatLabels: ["A", "B", "C", "D"],
          directive: "surface_beat",
          surfaceBeatLabel: "The flood gate breaks",
          threadFires: ["a long foreshadow line that pays off a much earlier promise"],
          clock: {
            label: "The candle burns",
            value: 9,
            max: 12,
            directive: "escalate_75",
          },
          candidateEndings: [
            { id: "a", label: "The Drowned Crown" },
            { id: "b", label: "The Risen City" },
            { id: "c", label: "The Salt Throne" },
            { id: "d", label: "The Last Bell" },
          ],
        }),
      }),
    );
    // 4-chars/token heuristic (design §3): +1400 tokens ≈ +5600 chars. R16.5
    // caps cumulative growth at +1600 across all waves — W2 stays under 1400.
    const addedTokens = (worst.length - baseline.length) / 4;
    expect(addedTokens).toBeLessThanOrEqual(1400);
  });
});
