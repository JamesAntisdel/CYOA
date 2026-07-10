import { describe, expect, it } from "vitest";

import {
  applyClockAdvance,
  applyLlmSceneToState,
  choiceCheckOdds,
  clockDirective,
  createClock,
  createInitialState,
  deriveCodex,
  llmChoiceSchema,
  llmSceneOutputSchema,
  resolveChoiceCheck,
  tickClock,
  type ChoiceSkillCheck,
  type EngineDiff,
  type LlmSceneProposal,
  type NpcState,
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
        nerve: { id: "nerve", label: "Nerve", value: 3, visibility: "visible", min: 0, max: 5 },
      },
      inventory: [{ id: "bone-key", label: "Bone Key" }],
      flags: {},
    },
    endings: {
      "bell-holds": { id: "bell-holds", label: "The Bell Holds", kind: "success" },
    },
    nodes: { start: { id: "start", seed: "seed", choices: [] } },
    initialNpcs: {
      mira: {
        id: "mira",
        name: "Mira",
        role: "companion",
        disposition: 10,
        attributes: {},
        knownFacts: [],
        flags: {},
      },
    },
  };
}

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

function baseState(overrides: Partial<PlayerState> = {}): PlayerState {
  return { ...createInitialState(story(), "story", ctx.now, ctx.rngSeed), ...overrides };
}

function testArc(overrides: Partial<StoryArc> = {}): StoryArc {
  return {
    dramaticQuestion: "Will you silence the bell before it drowns the city?",
    protagonistWant: "To silence the bell.",
    stakes: "The city drowns if you fail.",
    act: 1,
    beats: [
      { id: "inciting-call", label: "The Call", kind: "inciting", priorityHint: "early", requiredBeforeEnding: false, status: "pending" },
      { id: "dark-hour", label: "The Dark Hour", kind: "dark_night", priorityHint: "late", requiredBeforeEnding: false, status: "pending" },
      { id: "climax-reckoning", label: "The Reckoning", kind: "climax", priorityHint: "late", requiredBeforeEnding: true, status: "pending" },
    ],
    candidateEndings: [
      { id: "bell-holds", label: "The Bell Holds", hint: "You endure." },
      { id: "bell-falls", label: "The Bell Falls", hint: "You do not." },
    ],
    source: "llm",
    ...overrides,
  };
}

function kinds(diffs: EngineDiff[]): string[] {
  return diffs.map((d) => d.kind);
}

// ===========================================================================
// W2-E1 — skillCheck schema (clamps, exclusivity, per-scene cap)
// ===========================================================================

describe("skillCheck on choices (W2-E1)", () => {
  it("parses a valid skillCheck and clamps the notes to 90", () => {
    const choice = llmChoiceSchema.parse({
      id: "a",
      label: "Leap the gap.",
      skillCheck: { statId: "nerve", difficulty: "risky", successNote: "n".repeat(200), failNote: "f".repeat(200) },
    });
    expect(choice.skillCheck?.statId).toBe("nerve");
    expect(choice.skillCheck?.difficulty).toBe("risky");
    expect(choice.skillCheck?.successNote?.length).toBe(90);
    expect(choice.skillCheck?.failNote?.length).toBe(90);
  });

  it("drops a malformed skillCheck but keeps the choice (BC5)", () => {
    const choice = llmChoiceSchema.parse({
      id: "a",
      label: "A",
      skillCheck: { statId: "nerve", difficulty: "impossible" }, // bad difficulty enum
    });
    expect(choice.skillCheck).toBeUndefined();
    expect(choice.id).toBe("a");
  });

  it("drops the check when the choice also has conditions (locks win, R7.5)", () => {
    const choice = llmChoiceSchema.parse({
      id: "a",
      label: "A",
      conditions: [{ kind: "stat_at_least", statId: "nerve", value: 2 }],
      skillCheck: { statId: "nerve", difficulty: "easy" },
    });
    expect(choice.conditions).toHaveLength(1);
    expect(choice.skillCheck).toBeUndefined();
  });

  it("keeps only the first checked choice per scene", () => {
    const scene = llmSceneOutputSchema.parse({
      prose: "p",
      choices: [
        { id: "a", label: "A", skillCheck: { statId: "nerve", difficulty: "risky" } },
        { id: "b", label: "B", skillCheck: { statId: "nerve", difficulty: "easy" } },
        { id: "c", label: "C" },
      ],
    });
    expect(scene.choices[0]?.skillCheck).toBeDefined();
    expect(scene.choices[1]?.skillCheck).toBeUndefined();
  });
});

// ===========================================================================
// W2-E2 — resolveChoiceCheck outcome table + determinism + odds
// ===========================================================================

describe("resolveChoiceCheck (W2-E2)", () => {
  const check = (o: Partial<ChoiceSkillCheck> = {}): ChoiceSkillCheck => ({
    statId: "nerve",
    difficulty: "risky",
    ...o,
  });

  it("is deterministic for a given (state, check, seed)", () => {
    const s = baseState();
    const a = resolveChoiceCheck(s, check(), "turn-42");
    const b = resolveChoiceCheck(s, check(), "turn-42");
    expect(a).toEqual(b);
  });

  it("different seeds can produce different rolls", () => {
    const s = baseState();
    const rolls = new Set<number>();
    for (const seed of ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"]) {
      rolls.add(resolveChoiceCheck(s, check(), seed).breakdown.roll);
    }
    expect(rolls.size).toBeGreaterThan(1);
    for (const r of rolls) {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(5);
    }
  });

  it("uses difficulty thresholds easy 4 / risky 6 / desperate 8", () => {
    const s = baseState();
    expect(resolveChoiceCheck(s, check({ difficulty: "easy" }), "x").breakdown.threshold).toBe(4);
    expect(resolveChoiceCheck(s, check({ difficulty: "risky" }), "x").breakdown.threshold).toBe(6);
    expect(resolveChoiceCheck(s, check({ difficulty: "desperate" }), "x").breakdown.threshold).toBe(8);
  });

  it("counts a companion contribution in the score", () => {
    const withComp = baseState({
      npcs: {
        mira: {
          id: "mira",
          name: "Mira",
          role: "companion",
          disposition: 10,
          attributes: { nerve: { id: "nerve", label: "Nerve", value: 2, visibility: "visible", min: 0, max: 5 } },
          knownFacts: [],
          flags: {},
        },
      },
    });
    const r = resolveChoiceCheck(withComp, check(), "seed");
    expect(r.breakdown.companionBonus).toBe(2);
    expect(r.breakdown.score).toBe(r.breakdown.playerValue + 2 + r.breakdown.itemBonus);
  });

  it("grants +1 item bonus when a carried item token-matches the check", () => {
    const s = baseState({ inventory: [{ id: "nerve-tonic", label: "Nerve Tonic" }] });
    expect(resolveChoiceCheck(s, check(), "seed").breakdown.itemBonus).toBe(1);
    const noMatch = baseState({ inventory: [{ id: "old-rope", label: "Old Rope" }] });
    expect(resolveChoiceCheck(noMatch, check(), "seed").breakdown.itemBonus).toBe(0);
  });

  it("classifies success / partial / fail by total vs threshold", () => {
    // Pin the roll by choosing seeds; assert the outcome matches the math.
    const s = baseState(); // nerve 3
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]) {
      const r = resolveChoiceCheck(s, check({ difficulty: "risky" }), seed);
      const t = r.breakdown.total;
      const expected = t >= 6 ? "success" : t >= 4 ? "partial" : "fail";
      expect(r.outcome).toBe(expected);
      expect(r.margin).toBe(t - 6);
    }
  });

  it("applies choice effects only on success", () => {
    const s = baseState();
    // Find a seed that fails and one that succeeds.
    const results = ["a", "b", "c", "d", "e", "f", "g", "h"].map((seed) => resolveChoiceCheck(s, check(), seed));
    const success = results.find((r) => r.outcome === "success");
    const nonSuccess = results.find((r) => r.outcome !== "success");
    expect(success?.applyChoiceEffects).toBe(true);
    if (nonSuccess) expect(nonSuccess.applyChoiceEffects).toBe(false);
  });

  it("emits a check_resolved diff", () => {
    const s = baseState();
    const r = resolveChoiceCheck(s, check(), "seed");
    expect(r.diff.kind).toBe("check_resolved");
    if (r.diff.kind === "check_resolved") {
      expect(r.diff.target).toBe("nerve");
      expect(r.diff.outcome).toBe(r.outcome);
      expect(r.diff.margin).toBe(r.margin);
    }
  });

  describe("fail cost is afford-aware (vitality → currency → clock)", () => {
    // Desperate check at nerve 0 with a fail-forcing seed.
    const failCheck = (): ChoiceSkillCheck => ({ statId: "nerve", difficulty: "desperate" });
    const withNerve0 = (extra: Partial<PlayerState> = {}) =>
      baseState({ attributes: { nerve: { id: "nerve", label: "Nerve", value: 0, visibility: "visible", min: 0, max: 5 } }, ...extra });

    function forceFail(state: PlayerState): { seed: string } {
      for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"]) {
        if (resolveChoiceCheck(state, failCheck(), seed).outcome === "fail") return { seed };
      }
      throw new Error("no failing seed found");
    }

    it("takes vitality first when it can afford it", () => {
      const s = withNerve0({ vitality: 10, currency: 20 });
      const r = resolveChoiceCheck(s, failCheck(), forceFail(s).seed);
      expect(r.engineEffects).toEqual([{ kind: "stat", statId: "vitality", delta: -1 }]);
      expect(r.clockAdvance).toBe(0);
    });

    it("falls back to currency when vitality is too low", () => {
      const s = withNerve0({ vitality: 1, currency: 20 });
      const r = resolveChoiceCheck(s, failCheck(), forceFail(s).seed);
      expect(r.engineEffects).toEqual([{ kind: "currency", delta: -10 }]);
      expect(r.clockAdvance).toBe(0);
    });

    it("falls back to the clock when neither vitality nor currency can pay", () => {
      const s = withNerve0({ vitality: 1, currency: 2, clock: createClock() });
      const r = resolveChoiceCheck(s, failCheck(), forceFail(s).seed);
      expect(r.engineEffects).toEqual([]);
      expect(r.clockAdvance).toBe(2);
    });

    it("partial prefers the clock, else costs vitality", () => {
      const clocked = baseState({ clock: createClock() });
      // Find a partial seed for a risky check at nerve 3.
      const partialSeed = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n"].find(
        (seed) => resolveChoiceCheck(clocked, { statId: "nerve", difficulty: "risky" }, seed).outcome === "partial",
      );
      if (partialSeed) {
        const r = resolveChoiceCheck(clocked, { statId: "nerve", difficulty: "risky" }, partialSeed);
        expect(r.clockAdvance).toBe(1);
        expect(r.engineEffects).toEqual([]);
        const noClock = baseState();
        const r2 = resolveChoiceCheck(noClock, { statId: "nerve", difficulty: "risky" }, partialSeed);
        expect(r2.engineEffects).toEqual([{ kind: "stat", statId: "vitality", delta: -1 }]);
      }
    });

    it("a clock-less partial never charges lethal vitality (afford-guarded)", () => {
      // A partial is a middling, non-failing result — at vitality 1 it must not
      // apply the −1 tax that would floor vitality to 0 and force a death.
      const s = baseState({ vitality: 1 });
      const partialSeed = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n"].find(
        (seed) => resolveChoiceCheck(s, { statId: "nerve", difficulty: "risky" }, seed).outcome === "partial",
      );
      if (partialSeed) {
        const r = resolveChoiceCheck(s, { statId: "nerve", difficulty: "risky" }, partialSeed);
        expect(r.engineEffects).toEqual([]);
        expect(r.clockAdvance).toBe(0);
      }
    });
  });

  it("odds phrase shifts one band by difficulty", () => {
    const s = baseState(); // nerve 3 → base band "even"
    expect(choiceCheckOdds(s, { statId: "nerve", difficulty: "risky" })).toBe("even");
    expect(choiceCheckOdds(s, { statId: "nerve", difficulty: "easy" })).toBe("likely");
    expect(choiceCheckOdds(s, { statId: "nerve", difficulty: "desperate" })).toBe("risky");
    const low = baseState({ attributes: { nerve: { id: "nerve", label: "Nerve", value: 0, visibility: "visible", min: 0, max: 5 } } });
    expect(choiceCheckOdds(low, { statId: "nerve", difficulty: "desperate" })).toBe("desperate");
  });
});

// ===========================================================================
// W2-E3 — StoryClock behavior
// ===========================================================================

describe("StoryClock (W2-E3)", () => {
  it("createClock applies label default + hardcore max reduction", () => {
    expect(createClock().label).toBe("The candle burns");
    expect(createClock("The Tide", { max: 12 })).toEqual({ label: "The Tide", value: 0, max: 12, expired: false });
    expect(createClock("x", { max: 12, maxReduction: 0.25 }).max).toBe(9); // 12 * 0.75
  });

  it("tickClock advances +1 on every 3rd completed turn only", () => {
    const c = createClock("x", { max: 12 });
    expect(tickClock(c, 1).value).toBe(0);
    expect(tickClock(c, 2).value).toBe(0);
    expect(tickClock(c, 3).value).toBe(1);
    expect(tickClock(c, 6).value).toBe(1);
    expect(tickClock(c, 4).value).toBe(0);
  });

  it("applyClockAdvance clamps to [0, max] and flags expiry", () => {
    const c = createClock("x", { max: 3 });
    expect(applyClockAdvance(c, 2).value).toBe(2);
    expect(applyClockAdvance(c, 5)).toMatchObject({ value: 3, expired: true });
    expect(applyClockAdvance({ ...c, value: 2 }, -5).value).toBe(0);
  });

  it("clockDirective returns bands at 50 / 75 / 100 percent", () => {
    const mk = (value: number) => ({ label: "x", value, max: 12, expired: value >= 12 });
    expect(clockDirective(mk(0))).toBe("none");
    expect(clockDirective(mk(5))).toBe("none");
    expect(clockDirective(mk(6))).toBe("escalate_50");
    expect(clockDirective(mk(9))).toBe("escalate_75");
    expect(clockDirective(mk(12))).toBe("climax_now");
  });

  it("auto-fires dark_night beats + emits clock_expired at expiry (once)", () => {
    const s = story();
    const state = baseState({ arc: testArc(), clock: { label: "The candle burns", value: 11, max: 12, expired: false } });
    // A completed turn at turnNumber 3 would tick +1 → but value 11→12 needs a
    // clock_advance; drive expiry via a clock_advance effect on the choice.
    const p0 = proposal({
      choices: [
        { id: "a", label: "Press on.", effects: [{ kind: "clock_advance", amount: 1, reason: "the ritual quickens" }] },
        { id: "b", label: "Wait." },
      ],
    });
    const opened = applyLlmSceneToState({ state, story: s, priorProposal: null, choiceId: null, nextProposal: p0, ctx });
    const t1 = applyLlmSceneToState({ state: opened.state, story: s, priorProposal: p0, choiceId: "a", nextProposal: proposal(), ctx });
    expect(kinds(t1.diffs)).toContain("clock_expired");
    expect(t1.state.clock?.expired).toBe(true);
    // dark_night beat auto-fired.
    expect(t1.state.arc?.beats.find((b) => b.id === "dark-hour")?.status).toBe("fired");
    expect(kinds(t1.diffs)).toContain("beat_fired");

    // A further turn does NOT re-emit clock_expired (transition only).
    const t2 = applyLlmSceneToState({ state: t1.state, story: s, priorProposal: proposal(), choiceId: "a", nextProposal: proposal(), ctx });
    expect(kinds(t2.diffs)).not.toContain("clock_expired");
  });

  it("clock_advance LLM effect is capped at ≤1 per proposal", () => {
    const s = story();
    const state = baseState({ arc: testArc(), clock: createClock("x", { max: 12 }) });
    const p0 = proposal({
      choices: [
        {
          id: "a",
          label: "Press on.",
          effects: [
            { kind: "clock_advance", amount: 2, reason: "one" },
            { kind: "clock_advance", amount: 2, reason: "two" },
          ],
        },
        { id: "b", label: "Wait." },
      ],
    });
    const opened = applyLlmSceneToState({ state, story: s, priorProposal: null, choiceId: null, nextProposal: p0, ctx });
    const t1 = applyLlmSceneToState({ state: opened.state, story: s, priorProposal: p0, choiceId: "a", nextProposal: proposal(), ctx });
    // Only the first clock_advance (+2) applied; turnNumber 1 → no auto-tick.
    expect(t1.state.clock?.value).toBe(2);
    expect(t1.diffs.filter((d) => d.kind === "clock_advanced")).toHaveLength(1);
  });

  it("legacy (no-clock) saves are untouched by the clock path", () => {
    const s = story();
    const state = baseState();
    const p0 = proposal();
    const opened = applyLlmSceneToState({ state, story: s, priorProposal: null, choiceId: null, nextProposal: p0, ctx });
    const t1 = applyLlmSceneToState({ state: opened.state, story: s, priorProposal: p0, choiceId: "a", nextProposal: proposal(), ctx });
    expect(t1.state.clock).toBeUndefined();
    expect(kinds(t1.diffs)).not.toContain("clock_advanced");
  });
});

// ===========================================================================
// W2-E4 — npc_* LLM effects (clamps, caps, dup/unknown drop)
// ===========================================================================

describe("npc_* LLM effects (W2-E4)", () => {
  function applyEffectsOnChoice(state: PlayerState, effects: unknown[]) {
    const s = story();
    const p0 = proposal({ choices: [{ id: "a", label: "A", effects }, { id: "b", label: "B" }] });
    const opened = applyLlmSceneToState({ state, story: s, priorProposal: null, choiceId: null, nextProposal: p0, ctx });
    return applyLlmSceneToState({ state: opened.state, story: s, priorProposal: p0, choiceId: "a", nextProposal: proposal(), ctx });
  }

  it("applies a disposition delta clamped to ±15 net per NPC + emits disposition_shift", () => {
    const t1 = applyEffectsOnChoice(baseState(), [
      { kind: "npc_disposition_delta", npcId: "mira", delta: 10 },
      { kind: "npc_disposition_delta", npcId: "mira", delta: 10 }, // net capped at +15
    ]);
    expect(t1.state.npcs.mira?.disposition).toBe(25); // 10 start + 15 net
    const shift = t1.diffs.filter((d) => d.kind === "disposition_shift");
    expect(shift.length).toBeGreaterThanOrEqual(1);
    const first = shift[0];
    expect(first && first.kind === "disposition_shift" ? first.prevDisposition : null).toBe(10);
  });

  it("drops a disposition delta for an unknown npcId", () => {
    const t1 = applyEffectsOnChoice(baseState(), [{ kind: "npc_disposition_delta", npcId: "ghost", delta: 5 }]);
    expect(kinds(t1.diffs)).not.toContain("disposition_shift");
  });

  it("learns a fact (FIFO cap 12) + emits fact_learned, dedupes exact", () => {
    // Pre-seed 11 facts (the per-choice effect cap is 6, so we can't add 14 in
    // one turn); then apply 3 new ones → 14 total → FIFO-capped to the last 12.
    const preseeded = Array.from({ length: 11 }, (_, i) => `fact ${i}`);
    const mira = baseState().npcs.mira as NpcState;
    const seeded = baseState({ npcs: { mira: { ...mira, knownFacts: preseeded } } });
    const t1 = applyEffectsOnChoice(seeded, [
      { kind: "npc_learn_fact", npcId: "mira", fact: "fact 11" },
      { kind: "npc_learn_fact", npcId: "mira", fact: "fact 12" },
      { kind: "npc_learn_fact", npcId: "mira", fact: "fact 13" },
    ]);
    expect(t1.state.npcs.mira?.knownFacts).toHaveLength(12); // capped
    expect(t1.state.npcs.mira?.knownFacts[0]).toBe("fact 2"); // oldest two dropped
    expect(kinds(t1.diffs).filter((k) => k === "fact_learned")).toHaveLength(3);
    // dedupe: relearning an existing fact emits nothing.
    const t2 = applyEffectsOnChoice(t1.state, [{ kind: "npc_learn_fact", npcId: "mira", fact: "fact 13" }]);
    expect(kinds(t2.diffs)).not.toContain("fact_learned");
  });

  it("spawns an NPC (disposition 0), drops duplicates, respects roster cap 8", () => {
    const t1 = applyEffectsOnChoice(baseState(), [
      { kind: "npc_spawn", id: "orin", name: "Orin", role: "rival", description: "A sellsword." },
      { kind: "npc_spawn", id: "orin", name: "Orin Two", role: "ally" }, // dup id → drop
    ]);
    expect(t1.state.npcs.orin?.disposition).toBe(0);
    expect(t1.state.npcs.orin?.name).toBe("Orin");
    expect(t1.state.npcs.orin?.description).toBe("A sellsword.");
    expect(t1.diffs.filter((d) => d.kind === "npc_spawn")).toHaveLength(1);

    // Roster cap: fill to 8 (mira + 7), the 9th spawn drops.
    const packed: Record<string, NpcState> = { mira: baseState().npcs.mira as NpcState };
    for (let i = 0; i < 7; i += 1) {
      packed[`n${i}`] = { id: `n${i}`, name: `N${i}`, role: "neutral", disposition: 0, attributes: {}, knownFacts: [], flags: {} };
    }
    const full = baseState({ npcs: packed });
    const t2 = applyEffectsOnChoice(full, [{ kind: "npc_spawn", id: "overflow", name: "Nope", role: "neutral" }]);
    expect(t2.state.npcs.overflow).toBeUndefined();
  });
});

// ===========================================================================
// W2-E5 — deriveCodex
// ===========================================================================

describe("deriveCodex (W2-E5)", () => {
  it("returns only string flags, newest-first, with turnNumber", () => {
    const state = baseState({
      flags: { bell_truth: "The bell was forged from a saint's bones.", visited: true, count: 3, oath: "You swore to ring it thrice." },
      flagSetTurns: { bell_truth: 2, oath: 5 },
    });
    const codex = deriveCodex(state);
    expect(codex.map((e) => e.flag)).toEqual(["oath", "bell_truth"]);
    expect(codex[0]).toEqual({ flag: "oath", text: "You swore to ring it thrice.", turnNumber: 5 });
    // boolean/number flags excluded.
    expect(codex.some((e) => e.flag === "visited" || e.flag === "count")).toBe(false);
  });

  it("records turnNumber at flag-set time via the llm path", () => {
    // `flag_set` applies during phase A, BEFORE the turn increments — the
    // recorded turn is the turn whose choice set the truth. Drive one plain
    // turn first (turnNumber → 1), then a turn whose choice sets the flag.
    const s = story();
    const p0 = proposal();
    const opened = applyLlmSceneToState({ state: baseState(), story: s, priorProposal: null, choiceId: null, nextProposal: p0, ctx });
    const p1 = proposal({
      choices: [
        { id: "a", label: "A", effects: [{ kind: "flag_set", flag: "world_truth", value: "The tide answers to the bell." }] },
        { id: "b", label: "B" },
      ],
    });
    const t1 = applyLlmSceneToState({ state: opened.state, story: s, priorProposal: p0, choiceId: "a", nextProposal: p1, ctx });
    const t2 = applyLlmSceneToState({ state: t1.state, story: s, priorProposal: p1, choiceId: "a", nextProposal: proposal(), ctx });
    const codex = deriveCodex(t2.state);
    expect(codex).toHaveLength(1);
    expect(codex[0]?.flag).toBe("world_truth");
    expect(codex[0]?.turnNumber).toBe(1); // choice taken while turnNumber was 1
  });

  it("caps at 40 entries", () => {
    const flags: Record<string, string> = {};
    const flagSetTurns: Record<string, number> = {};
    for (let i = 0; i < 60; i += 1) {
      flags[`f${i}`] = `truth ${i}`;
      flagSetTurns[`f${i}`] = i;
    }
    const codex = deriveCodex(baseState({ flags, flagSetTurns }));
    expect(codex).toHaveLength(40);
    expect(codex[0]?.turnNumber).toBe(59); // newest first
  });
});

// ===========================================================================
// applyChoiceEffects flag (W2-E2 server surface)
// ===========================================================================

describe("applyChoiceEffects flag", () => {
  it("skips the taken choice's own effects when false, still ticks the turn", () => {
    const s = story();
    const state = baseState();
    const p0 = proposal({
      choices: [
        { id: "a", label: "Leap.", effects: [{ kind: "stat", statId: "nerve", delta: 2 }] },
        { id: "b", label: "Wait." },
      ],
    });
    const opened = applyLlmSceneToState({ state, story: s, priorProposal: null, choiceId: null, nextProposal: p0, ctx });
    const failTurn = applyLlmSceneToState({
      state: opened.state,
      story: s,
      priorProposal: p0,
      choiceId: "a",
      nextProposal: proposal(),
      ctx,
      applyChoiceEffects: false,
    });
    expect(failTurn.state.attributes.nerve?.value).toBe(3); // unchanged (effect skipped)
    expect(failTurn.state.turnNumber).toBe(1);

    const successTurn = applyLlmSceneToState({
      state: opened.state,
      story: s,
      priorProposal: p0,
      choiceId: "a",
      nextProposal: proposal(),
      ctx,
      applyChoiceEffects: true,
    });
    expect(successTurn.state.attributes.nerve?.value).toBe(5); // 3 + 2
  });
});
