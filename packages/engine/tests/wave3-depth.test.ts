import { describe, expect, it } from "vitest";

import {
  BOND_BREAK_AT,
  BOND_CRYSTALLIZE_AT,
  BOND_STATE_FLAG,
  FACTION_REP_MAX,
  FACTION_REP_MIN,
  applyLlmSceneToState,
  buildBibleDigest,
  createInitialState,
  ensureFactionRepAttributes,
  evaluateLlmChoiceVisibility,
  factionRepStatId,
  fireBondCrossings,
  isFactionRepStat,
  llmChoiceSchema,
  linkCastIds,
  llmSceneOutputSchema,
  matchCastId,
  matchEndingHints,
  mergeBibleRefresh,
  normalizeFactionReps,
  validateProposedBible,
  type EngineDiff,
  type LlmSceneProposal,
  type NpcState,
  type PlayerState,
  type Story,
  type StoryBible,
} from "../src";

const ctx = { now: 1, rngSeed: "seed" };

function story(npcs?: Record<string, NpcState>): Story {
  return {
    id: "harbor",
    version: 1,
    title: "Harbor",
    startNodeId: "start",
    initialState: { vitality: 10, currency: 20, attributes: {}, inventory: [], flags: {} },
    endings: { win: { id: "win", label: "Win", kind: "success" } },
    nodes: { start: { id: "start", seed: "seed", choices: [] } },
    ...(npcs ? { initialNpcs: npcs } : {}),
  };
}

function npc(overrides: Partial<NpcState> & { id: string }): NpcState {
  return {
    name: overrides.name ?? overrides.id,
    role: "ally",
    disposition: 0,
    attributes: {},
    knownFacts: [],
    flags: {},
    ...overrides,
  };
}

function baseState(npcs?: Record<string, NpcState>): PlayerState {
  return createInitialState(story(npcs), "story", ctx.now, ctx.rngSeed);
}

function proposal(overrides: Record<string, unknown> = {}): LlmSceneProposal {
  return llmSceneOutputSchema.parse({
    prose: "The tide turns.",
    choices: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
    terminal: null,
    ...overrides,
  });
}

// ===========================================================================
// NPC loyalty / betrayal one-shot bond crossings (Panel-2 W3)
// ===========================================================================

describe("fireBondCrossings", () => {
  it("crystallizes a bond once at +75: stamps the flag, front-inserts a payoff fact, echoes fact_learned", () => {
    const state = baseState({ mira: npc({ id: "mira", disposition: BOND_CRYSTALLIZE_AT }) });
    const diffs: EngineDiff[] = [];
    fireBondCrossings(state, diffs);
    const mira = state.npcs.mira!;
    expect(mira.flags[BOND_STATE_FLAG]).toBe(1);
    // Front-inserted so the NPC sheet's top-3 window carries it next turn.
    expect(mira.knownFacts[0]).toContain("loyalty just forged");
    expect(diffs.filter((d) => d.kind === "fact_learned")).toHaveLength(1);

    // Idempotent: a re-scan while still ≥75 does NOT re-fire.
    const diffs2: EngineDiff[] = [];
    fireBondCrossings(state, diffs2);
    expect(diffs2).toHaveLength(0);
    expect(mira.knownFacts.filter((f) => f.includes("loyalty just forged"))).toHaveLength(1);
  });

  it("breaks a bond once at -60", () => {
    const state = baseState({ vez: npc({ id: "vez", disposition: BOND_BREAK_AT }) });
    const diffs: EngineDiff[] = [];
    fireBondCrossings(state, diffs);
    const vez = state.npcs.vez!;
    expect(vez.flags[BOND_STATE_FLAG]).toBe(-1);
    expect(vez.knownFacts[0]).toContain("bond just broken");
    expect(diffs.filter((d) => d.kind === "fact_learned")).toHaveLength(1);
  });

  it("does not fire below the thresholds", () => {
    const state = baseState({
      warm: npc({ id: "warm", disposition: BOND_CRYSTALLIZE_AT - 1 }),
      wary: npc({ id: "wary", disposition: BOND_BREAK_AT + 1 }),
    });
    const diffs: EngineDiff[] = [];
    fireBondCrossings(state, diffs);
    expect(diffs).toHaveLength(0);
    expect(state.npcs.warm!.flags[BOND_STATE_FLAG]).toBeUndefined();
  });

  it("re-fires on a genuine transition (crystallized → broken)", () => {
    const state = baseState({ mira: npc({ id: "mira", disposition: BOND_CRYSTALLIZE_AT }) });
    fireBondCrossings(state, []);
    expect(state.npcs.mira!.flags[BOND_STATE_FLAG]).toBe(1);
    // Later the relationship collapses.
    state.npcs.mira!.disposition = BOND_BREAK_AT;
    const diffs: EngineDiff[] = [];
    fireBondCrossings(state, diffs);
    expect(state.npcs.mira!.flags[BOND_STATE_FLAG]).toBe(-1);
    expect(diffs.filter((d) => d.kind === "fact_learned")).toHaveLength(1);
    expect(state.npcs.mira!.knownFacts[0]).toContain("bond just broken");
  });

  it("skips a non-finite disposition (tolerant, BC5)", () => {
    const state = baseState({ ghost: npc({ id: "ghost", disposition: Number.NaN }) });
    const diffs: EngineDiff[] = [];
    expect(() => fireBondCrossings(state, diffs)).not.toThrow();
    expect(diffs).toHaveLength(0);
  });

  it("fires through applyLlmSceneToState when a choice pushes disposition over +75", () => {
    // Seed at 65 so a single +15-capped turn crosses the crystallize line.
    let state = baseState({ mira: npc({ id: "mira", disposition: 65 }) });
    const s = story({ mira: npc({ id: "mira", disposition: 65 }) });
    const p0 = proposal({
      choices: [
        { id: "a", label: "Trust her", effects: [{ kind: "npc_disposition_delta", npcId: "mira", delta: 15 }] },
        { id: "b", label: "B" },
      ],
    });
    const opened = applyLlmSceneToState({ state, story: s, priorProposal: null, choiceId: null, nextProposal: p0, ctx });
    const t1 = applyLlmSceneToState({ state: opened.state, story: s, priorProposal: p0, choiceId: "a", nextProposal: proposal(), ctx });
    expect(t1.state.npcs.mira!.disposition).toBe(80);
    expect(t1.state.npcs.mira!.flags[BOND_STATE_FLAG]).toBe(1);
    expect(t1.state.npcs.mira!.knownFacts[0]).toContain("loyalty just forged");
    expect(t1.diffs.some((d) => d.kind === "fact_learned")).toBe(true);
    void state;
  });
});

// ===========================================================================
// Cast ↔ roster linking by slug (Panel-2 W3)
// ===========================================================================

describe("linkCastIds / matchCastId", () => {
  it("matches on a direct id, then a slug-of-name fallback", () => {
    expect(matchCastId({ id: "mira-vale", name: "Mira Vale" }, ["mira-vale"])).toBe("mira-vale");
    expect(matchCastId({ id: "npc-7", name: "Mira Vale" }, ["mira-vale"])).toBe("mira-vale");
    expect(matchCastId({ id: "npc-7", name: "Nobody" }, ["mira-vale"])).toBeUndefined();
  });

  it("stamps castId once, skips already-linked NPCs, and no-ops on an empty cast", () => {
    const npcs: Record<string, NpcState> = {
      "mira-vale": npc({ id: "mira-vale", name: "Mira Vale" }),
      "npc-7": npc({ id: "npc-7", name: "Ossian" }),
      pinned: npc({ id: "pinned", name: "Whoever", castId: "already" }),
    };
    linkCastIds(npcs, ["mira-vale", "ossian"]);
    expect(npcs["mira-vale"]!.castId).toBe("mira-vale");
    expect(npcs["npc-7"]!.castId).toBe("ossian");
    expect(npcs.pinned!.castId).toBe("already"); // untouched

    const before = { ...npcs["npc-7"] };
    linkCastIds({ solo: npc({ id: "solo", name: "Solo" }) }, []);
    expect(npcs["npc-7"]).toEqual(before);
  });
});

// ===========================================================================
// Faction reputation — hidden signed rep:<id> stats (Panel-2 W3)
// ===========================================================================

describe("faction reputation stats", () => {
  it("recognizes rep:<id> ids and builds them", () => {
    expect(isFactionRepStat("rep:iron-court")).toBe(true);
    expect(isFactionRepStat("rep:")).toBe(false);
    expect(isFactionRepStat("nerve")).toBe(false);
    expect(factionRepStatId("iron-court")).toBe("rep:iron-court");
  });

  it("pre-registers a touched rep as a HIDDEN signed attribute", () => {
    const state = baseState();
    ensureFactionRepAttributes(state, [
      { kind: "stat", statId: "rep:iron-court" },
      { kind: "stat", statId: "nerve" }, // not a faction rep — ignored
    ]);
    const rep = state.attributes["rep:iron-court"]!;
    expect(rep.visibility).toBe("hidden");
    expect(rep.min).toBe(FACTION_REP_MIN);
    expect(rep.max).toBe(FACTION_REP_MAX);
    expect(state.attributes.nerve).toBeUndefined();
  });

  it("normalizeFactionReps re-flags a rep first created VISIBLE 0..5 back to hidden signed", () => {
    const state = baseState();
    state.attributes["rep:crown"] = {
      id: "rep:crown",
      label: "Crown",
      value: 4,
      visibility: "visible",
      min: 0,
      max: 5,
    };
    normalizeFactionReps(state);
    const rep = state.attributes["rep:crown"]!;
    expect(rep.visibility).toBe("hidden");
    expect(rep.min).toBe(FACTION_REP_MIN);
    expect(rep.max).toBe(FACTION_REP_MAX);
    expect(rep.value).toBe(4);
  });

  it("keeps a rep hidden and lets it go negative through applyLlmSceneToState", () => {
    const s = story();
    const p0 = proposal({
      choices: [
        { id: "a", label: "Betray the court", effects: [{ kind: "stat", statId: "rep:iron-court", delta: -4 }] },
        { id: "b", label: "B" },
      ],
    });
    const opened = applyLlmSceneToState({ state: baseState(), story: s, priorProposal: null, choiceId: null, nextProposal: p0, ctx });
    const t1 = applyLlmSceneToState({ state: opened.state, story: s, priorProposal: p0, choiceId: "a", nextProposal: proposal(), ctx });
    const rep = t1.state.attributes["rep:iron-court"]!;
    expect(rep.value).toBe(-4); // signed — the generic 0..5 path would have clamped to 0
    expect(rep.visibility).toBe("hidden"); // never leaks into the HUD
  });

  it("gates a choice on standing through the EXISTING near-miss UX (phrase-only, BC10)", () => {
    // rep:iron-court sits at 2; a choice gated at >=3 is one point short → locked
    // and banded "near". No raw number reaches the reader — only the band.
    const state = baseState();
    state.attributes["rep:iron-court"] = {
      id: "rep:iron-court",
      label: "Iron Court",
      value: 2,
      visibility: "hidden",
      min: FACTION_REP_MIN,
      max: FACTION_REP_MAX,
    };
    const choice = llmChoiceSchema.parse({
      id: "petition",
      label: "Petition the Iron Court",
      conditions: [{ kind: "stat_at_least", statId: "rep:iron-court", value: 3 }],
      lockedHint: "The Court will not hear a stranger",
    });
    const visibility = evaluateLlmChoiceVisibility(choice, state);
    expect(visibility.visibility).toBe("locked");
    expect(visibility.nearness).toBe("near");
    expect(visibility.lockedHint).toBe("The Court will not hear a stranger");
  });
});

// ===========================================================================
// Bible factions — validate / digest / refresh (Panel-2 W3)
// ===========================================================================

function rawBible(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    keyRegistry: [
      { id: "bone-key", label: "Bone Key", opensHint: "opens the crypt", surfaceBand: "early" },
      { id: "brass-token", label: "Brass Token", opensHint: "buys passage", surfaceBand: "mid" },
      { id: "wax-seal", label: "Wax Seal", opensHint: "commands the crews", surfaceBand: "mid" },
      { id: "iron-writ", label: "Iron Writ", opensHint: "opens the gate", surfaceBand: "late" },
    ],
    lockPlan: [],
    cast: [],
    twists: [],
    endingHints: [],
    motifs: ["salt", "bells", "fog"],
    ...overrides,
  };
}

describe("bible factions", () => {
  it("validates, clamps, slugs, dedupes, and caps factions at 4", () => {
    const bible = validateProposedBible(
      rawBible({
        factions: [
          { label: "The Iron Court", standingHints: "favor buys writs; scorn earns the noose" },
          { id: "guild", label: "Ferryman's Guild", standingHints: "F".repeat(300) },
          { label: "The Iron Court" }, // dup slug → dropped
          { id: 9, label: 9 }, // malformed → dropped
          { label: "Dock Gang" },
          { label: "Fifth Faction" },
          { label: "Sixth — over cap" },
        ],
      }),
    );
    expect(bible?.factions?.map((f) => f.id)).toEqual([
      "the-iron-court",
      "guild",
      "dock-gang",
      "fifth-faction",
    ]);
    expect(bible?.factions?.[1]?.standingHints.length).toBeLessThanOrEqual(120);
  });

  it("omits factions entirely when none are salvageable (byte-identical, BC9)", () => {
    const bible = validateProposedBible(rawBible());
    expect(bible).not.toBeNull();
    expect(bible?.factions).toBeUndefined();
  });

  it("carries factions into the digest verbatim (no band filter)", () => {
    const bible = validateProposedBible(
      rawBible({ factions: [{ label: "The Iron Court", standingHints: "favor buys writs" }] }),
    )!;
    const digest = buildBibleDigest(bible, 1);
    expect(digest.factions).toEqual([
      { id: "the-iron-court", label: "The Iron Court", standingHints: "favor buys writs" },
    ]);
  });

  it("digest omits factions when the bible has none", () => {
    const bible = validateProposedBible(rawBible())!;
    expect(buildBibleDigest(bible, 1).factions).toBeUndefined();
  });

  it("preserves factions across matchEndingHints and mergeBibleRefresh (immutable like cast)", () => {
    const bible: StoryBible = validateProposedBible(
      rawBible({ factions: [{ label: "The Iron Court", standingHints: "favor buys writs" }] }),
    )!;
    expect(matchEndingHints(bible, undefined).factions).toEqual(bible.factions);
    // A refresh payload that omits factions must not wipe them.
    const refreshed = mergeBibleRefresh(bible, rawBible());
    expect(refreshed.factions).toEqual(bible.factions);
  });
});
