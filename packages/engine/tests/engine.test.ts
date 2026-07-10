import { describe, expect, it } from "vitest";

import {
  applyChoice,
  applyChoiceAndEnterNode,
  applyStatDelta,
  cloneState,
  canSwitchMode,
  createInitialState,
  enterNode,
  evaluateNodeChoices,
  getFlag,
  getStat,
  hasItem,
  hasFlag,
  migrateEngineState,
  resolveSkillCheck,
  resolveTerminal,
  setFlag,
  shouldPurgeOnDeath,
  switchMode,
  unsetFlag,
  type Choice,
  type Effect,
  type NpcState,
  type PlayerState,
  type Story,
} from "../src";

const ctx = { now: 1, rngSeed: "seed" };

function fixtureStory(): Story {
  return {
    id: "training-room",
    version: 1,
    title: "Training Room",
    startNodeId: "start",
    deathNodeId: "death",
    initialState: {
      vitality: 10,
      currency: 2,
      attributes: {
        resolve: {
          id: "resolve",
          label: "Resolve",
          value: 1,
          visibility: "hidden",
        },
      },
      inventory: [{ id: "rusty_key", label: "Rusty Key" }],
      flags: { torch_lit: false },
    },
    endings: {
      death: { id: "death", label: "A Hard Lesson", kind: "death" },
      escape: { id: "escape", label: "Escaped", kind: "success" },
    },
    nodes: {
      start: {
        id: "start",
        choices: [
          {
            id: "unlock",
            label: "Use the key",
            targetNodeId: "hall",
            conditions: [{ kind: "has_item", itemId: "rusty_key", hint: "Needs key" }],
            effects: [
              { kind: "inventory_remove", itemId: "rusty_key" },
              { kind: "currency", delta: 3 },
              { kind: "flag_set", flag: "door_open", value: true },
              {
                kind: "delayed",
                delayNodes: 2,
                effects: [{ kind: "stat", statId: "vitality", delta: -2 }],
              },
            ],
          },
          {
            id: "force",
            label: "Force the door",
            targetNodeId: "hall",
            conditions: [{ kind: "stat_at_least", statId: "resolve", value: 2 }],
          },
          {
            id: "secret",
            label: "Slip through the hidden seam",
            targetNodeId: "escape",
            visibility: "hidden",
            conditions: [{ kind: "flag_equals", flag: "secret_seen", value: true }],
          },
        ],
      },
      hall: {
        id: "hall",
        effectsOnEnter: [
          { kind: "stat", statId: "resolve", delta: 1 },
          { kind: "inventory_add", item: { id: "chalk", label: "Chalk" } },
        ],
        choices: [
          {
            id: "wait",
            label: "Wait",
            targetNodeId: "trap",
            effects: [{ kind: "flag_unset", flag: "torch_lit" }],
          },
        ],
      },
      trap: {
        id: "trap",
        effectsOnEnter: [{ kind: "stat", statId: "vitality", delta: -20 }],
        choices: [],
      },
      death: {
        id: "death",
        endingId: "death",
        isDeath: true,
        choices: [],
      },
      escape: {
        id: "escape",
        endingId: "escape",
        choices: [],
      },
    },
  };
}

describe("engine state and visibility", () => {
  it("creates deterministic initial state from story seed", () => {
    const story = fixtureStory();
    const state = createInitialState(story, "story", ctx.now, ctx.rngSeed);

    expect(state.storyId).toBe("training-room");
    expect(state.currentNodeId).toBe("start");
    expect(state.path).toEqual(["start"]);
    expect(state.vitality).toBe(10);
    expect(hasItem(state, "rusty_key")).toBe(true);
  });

  it("evaluates visible, locked, and hidden choices from canonical state", () => {
    const state = createInitialState(fixtureStory(), "story", ctx.now, ctx.rngSeed);
    const story = fixtureStory();
    const startNode = story.nodes.start;
    if (!startNode) throw new Error("missing start fixture");
    const choices = evaluateNodeChoices(state, startNode.choices);

    expect(choices.map((choice) => choice.visibility)).toEqual([
      "visible",
      "locked",
      "hidden",
    ]);
    expect(choices[1]?.lockedHint).toBe("You do not have the resolve");
  });

  it("covers all supported condition kinds and default hints", () => {
    const state = createInitialState(fixtureStory(), "story", ctx.now, ctx.rngSeed);
    const choices = evaluateNodeChoices(state, [
      { id: "always", label: "Always", targetNodeId: "start", conditions: [{ kind: "always" }] },
      { id: "low", label: "Low", targetNodeId: "start", conditions: [{ kind: "stat_at_most", statId: "resolve", value: 1 }] },
      { id: "missing", label: "Missing", targetNodeId: "start", conditions: [{ kind: "missing_item", itemId: "chalk" }] },
      { id: "flag", label: "Flag", targetNodeId: "start", conditions: [{ kind: "flag_equals", flag: "torch_lit", value: false }] },
      { id: "mode", label: "Mode", targetNodeId: "start", conditions: [{ kind: "mode_is", mode: "story" }] },
      { id: "needs-missing", label: "Needs missing", targetNodeId: "start", conditions: [{ kind: "missing_item", itemId: "rusty_key" }] },
      { id: "needs-item", label: "Needs item", targetNodeId: "start", conditions: [{ kind: "has_item", itemId: "silver_key" }] },
      { id: "needs-flag", label: "Needs flag", targetNodeId: "start", conditions: [{ kind: "flag_equals", flag: "door_open", value: true }] },
      { id: "needs-mode", label: "Needs mode", targetNodeId: "start", conditions: [{ kind: "mode_is", mode: "hardcore" }] },
    ]);

    expect(choices.slice(0, 5).every((choice) => choice.visibility === "visible")).toBe(true);
    expect(choices[5]).toMatchObject({ visibility: "locked", lockedHint: "Requires missing rusty_key" });
    expect(choices[6]).toMatchObject({ visibility: "locked", lockedHint: "Needs silver_key" });
    expect(choices[7]).toMatchObject({ visibility: "locked" });
    expect(choices[7]?.lockedHint).toBeUndefined();
    expect(choices[8]).toMatchObject({ visibility: "locked" });
    expect(choices[8]?.lockedHint).toBeUndefined();
  });

  it("reads and diffs flags without leaking missing before values", () => {
    const state = createInitialState(fixtureStory(), "story", ctx.now, ctx.rngSeed);
    const diffs: Parameters<typeof setFlag>[3] = [];

    expect(getFlag(state, "torch_lit")).toBe(false);
    expect(hasFlag(state, "torch_lit")).toBe(true);
    setFlag(state, "torch_lit", true, diffs);
    unsetFlag(state, "torch_lit", diffs);
    unsetFlag(state, "missing", diffs);

    expect(diffs[0]).toMatchObject({ kind: "flag_set", before: false, after: true });
    expect(diffs[1]).toMatchObject({ kind: "flag_unset", before: true });
    expect(diffs[2]).toEqual({ kind: "flag_unset", target: "missing", delta: null });
  });

  it("applies clamped stat deltas to new and existing attributes", () => {
    const state = createInitialState(fixtureStory(), "story", ctx.now, ctx.rngSeed);
    const diffs: Parameters<typeof applyStatDelta>[3] = [];

    expect(getStat(state, "vitality")).toMatchObject({ label: "Vitality", value: 10 });
    applyStatDelta(state, "focus", 3, diffs);
    state.attributes.focus = { ...state.attributes.focus!, max: 4 };
    applyStatDelta(state, "focus", 10, diffs);
    state.attributes.focus = { ...state.attributes.focus!, min: 2 };
    applyStatDelta(state, "focus", -10, diffs);

    expect(state.attributes.focus).toMatchObject({ label: "focus", value: 2, visibility: "hidden" });
    expect(diffs).toEqual([
      { kind: "stat", target: "focus", delta: 3, before: 0, after: 3 },
      { kind: "stat", target: "focus", delta: 10, before: 3, after: 4 },
      { kind: "stat", target: "focus", delta: -10, before: 4, after: 2 },
    ]);
  });

  it("deep clones nested state collections", () => {
    const state = createInitialState(fixtureStory(), "story", ctx.now, ctx.rngSeed);
    const richState = {
      ...state,
      delayed: [{ id: "d1", remainingNodes: 1, effects: [{ kind: "currency" as const, delta: 1 }] }],
      endingsUnlocked: {
        escape: {
          storyId: "training-room",
          endingId: "escape",
          firstSeenTurn: 1,
          mode: "story" as const,
          path: ["start", "escape"],
        },
      },
    };
    const cloned = cloneState(richState);

    cloned.delayed[0]!.effects[0] = { kind: "currency", delta: 99 };
    cloned.endingsUnlocked.escape!.path.push("mutated");

    expect(richState.delayed[0]?.effects[0]).toEqual({ kind: "currency", delta: 1 });
    expect(richState.endingsUnlocked.escape?.path).toEqual(["start", "escape"]);
  });
});

describe("choice and node application", () => {
  it("applies choice effects, structured diffs, and node-entry effects", () => {
    const story = fixtureStory();
    const state = createInitialState(story, "story", ctx.now, ctx.rngSeed);
    const result = applyChoiceAndEnterNode(state, story, "unlock", ctx);

    expect(result.state.currentNodeId).toBe("hall");
    expect(result.state.currency).toBe(5);
    expect(result.state.flags.door_open).toBe(true);
    expect(result.state.attributes.resolve?.value).toBe(2);
    expect(hasItem(result.state, "rusty_key")).toBe(false);
    expect(hasItem(result.state, "chalk")).toBe(true);
    expect(result.state.delayed).toHaveLength(1);
    expect(result.diffs.map((diff) => diff.kind)).toContain("currency");
    expect(result.events.map((event) => event.kind)).toContain("node_entered");
  });

  it("does not mutate the input state", () => {
    const story = fixtureStory();
    const state = createInitialState(story, "story", ctx.now, ctx.rngSeed);
    const result = applyChoiceAndEnterNode(state, story, "unlock", ctx);

    expect(state.currentNodeId).toBe("start");
    expect(hasItem(state, "rusty_key")).toBe(true);
    expect(result.state.currentNodeId).toBe("hall");
  });

  it("rejects locked choices", () => {
    const story = fixtureStory();
    const state = createInitialState(story, "story", ctx.now, ctx.rngSeed);

    expect(() => applyChoice(state, story, "force", ctx)).toThrow("choice_not_visible");
  });
});

describe("delayed consequences, death, and endings", () => {
  it("fires delayed consequences on the configured subsequent node entry", () => {
    const story = fixtureStory();
    const initial = createInitialState(story, "story", ctx.now, ctx.rngSeed);
    const hall = applyChoiceAndEnterNode(initial, story, "unlock", ctx).state;
    const trapChoice = applyChoice(hall, story, "wait", ctx).state;
    const trap = enterNode(trapChoice, story, "trap", ctx);

    expect(trap.events.some((event) => event.kind === "delayed_fired")).toBe(true);
    expect(trap.state.vitality).toBe(0);
    expect(trap.state.currentNodeId).toBe("death");
  });

  it("routes vitality zero to death before normal terminal resolution", () => {
    const story = fixtureStory();
    const state = createInitialState(story, "story", ctx.now, ctx.rngSeed);
    const damaged = {
      ...state,
      vitality: 1,
      currentNodeId: "trap",
      path: ["start", "trap"],
    };

    const result = enterNode(damaged, story, "trap", ctx);

    expect(result.state.currentNodeId).toBe("death");
    expect(result.events).toContainEqual({ kind: "death_triggered", nodeId: "death" });
  });

  it("unlocks endings and exposes terminal results", () => {
    const story = fixtureStory();
    const state = createInitialState(story, "story", ctx.now, ctx.rngSeed);
    const escapeState = { ...state, currentNodeId: "escape", path: ["start", "escape"] };
    const result = enterNode(escapeState, story, "escape", ctx);

    expect(result.state.endingsUnlocked.escape?.endingId).toBe("escape");
    expect(resolveTerminal(result.state, story)).toEqual({
      endingId: "escape",
      kind: "success",
    });
  });
});

describe("modes and migrations", () => {
  it("allows story downgrade but blocks late hardcore upgrade", () => {
    const state = createInitialState(fixtureStory(), "story", ctx.now, ctx.rngSeed);
    const laterState = { ...state, turnNumber: 1 };

    expect(canSwitchMode(state, "hardcore")).toBe(true);
    expect(canSwitchMode(laterState, "hardcore")).toBe(false);
    expect(switchMode(state, "hardcore").mode).toBe("hardcore");
    expect(switchMode({ ...state, mode: "hardcore" }, "hardcore").mode).toBe("hardcore");
    expect(switchMode({ ...laterState, mode: "hardcore" }, "story").mode).toBe("story");
    expect(() => switchMode(laterState, "hardcore")).toThrow("mode_switch_not_allowed");
  });

  it("marks hardcore vitality-zero states for purge", () => {
    const state = createInitialState(fixtureStory(), "hardcore", ctx.now, ctx.rngSeed);

    expect(shouldPurgeOnDeath({ ...state, vitality: 0 })).toBe(true);
  });

  it("migrates old state versions without changing current versions", () => {
    const current = createInitialState(fixtureStory(), "story", ctx.now, ctx.rngSeed);
    expect(migrateEngineState(current).migrated).toBe(false);

    const old = { ...current, schemaVersion: 0 };
    const migrated = migrateEngineState(old);
    expect(migrated.migrated).toBe(true);
    expect(migrated.state.schemaVersion).toBe(2);
    expect(() => migrateEngineState({ ...current, schemaVersion: 999 })).toThrow(
      "unsupported_future_engine_schema",
    );
  });
});

describe("NPCs", () => {
  function npcFixture(overrides: Partial<NpcState> = {}): NpcState {
    return {
      id: "mira",
      name: "Mira",
      role: "companion",
      disposition: 20,
      attributes: {
        nerve: { id: "nerve", label: "Nerve", value: 2, visibility: "visible", min: 0, max: 5 },
      },
      knownFacts: ["mira knows the well"],
      flags: {},
      ...overrides,
    };
  }

  function npcStory(initialNpcs?: Record<string, NpcState>): Story {
    const base = fixtureStory();
    return initialNpcs ? { ...base, initialNpcs } : base;
  }

  function stateWith(npcs: Record<string, NpcState>): PlayerState {
    const base = createInitialState(fixtureStory(), "story", ctx.now, ctx.rngSeed);
    return { ...cloneState(base), npcs };
  }

  function applyOneEffect(state: PlayerState, effect: Effect) {
    // Drive the production reducer (apply.ts) by stuffing the effect on an
    // ad-hoc choice attached to whatever node the state is currently on, and
    // letting applyChoice walk it. This keeps the tests aligned with the
    // LIVE switch in apply.ts instead of re-implementing the dispatch in
    // test-land, and lets us chain multiple effects across calls because we
    // bind the synthetic choice to the *current* node id every time.
    const story = fixtureStory();
    const stayNode = state.currentNodeId;
    if (!story.nodes[stayNode]) {
      story.nodes[stayNode] = {
        id: stayNode,
        choices: [],
      };
    }
    story.nodes[stayNode]!.choices = [
      {
        id: "npc-effect",
        label: "trigger",
        targetNodeId: stayNode,
        effects: [effect],
      },
    ];
    return applyChoice(state, story, "npc-effect", ctx);
  }

  it("createInitialState merges story.initialNpcs into PlayerState.npcs", () => {
    const story = npcStory({ mira: npcFixture() });
    const state = createInitialState(story, "story", ctx.now, ctx.rngSeed);

    expect(state.npcs.mira).toMatchObject({ name: "Mira", disposition: 20 });
    // Cloned, not aliased — mutating the source roster must not bleed in.
    state.npcs.mira!.disposition = 99;
    const second = createInitialState(story, "story", ctx.now, ctx.rngSeed);
    expect(second.npcs.mira?.disposition).toBe(20);
  });

  it("npc_spawn is idempotent on existing id", () => {
    const state = stateWith({});
    const first = applyOneEffect(state, { kind: "npc_spawn", npc: npcFixture() });
    expect(first.state.npcs.mira?.name).toBe("Mira");

    // Mutate disposition through a delta, then re-spawn — the re-spawn must
    // be a no-op rather than overwriting the live state.
    const bumped = applyOneEffect(first.state, {
      kind: "npc_disposition_delta",
      npcId: "mira",
      delta: -5,
    });
    const respawn = applyOneEffect(bumped.state, {
      kind: "npc_spawn",
      npc: npcFixture({ disposition: 99 }),
    });
    expect(respawn.state.npcs.mira?.disposition).toBe(15);
  });

  it("npc_despawn removes the NPC; no-op when absent", () => {
    const state = stateWith({ mira: npcFixture() });
    const after = applyOneEffect(state, { kind: "npc_despawn", npcId: "mira" });
    expect(after.state.npcs.mira).toBeUndefined();

    const noop = applyOneEffect(after.state, { kind: "npc_despawn", npcId: "mira" });
    expect(noop.state.npcs.mira).toBeUndefined();
    expect(noop.diffs.some((d) => d.kind === "npc_despawn")).toBe(false);
  });

  it("npc_relocate updates and clears the location tag", () => {
    const state = stateWith({ mira: npcFixture({ location: "garden" }) });
    const moved = applyOneEffect(state, {
      kind: "npc_relocate",
      npcId: "mira",
      location: "well",
    });
    expect(moved.state.npcs.mira?.location).toBe("well");

    const cleared = applyOneEffect(moved.state, { kind: "npc_relocate", npcId: "mira" });
    expect(cleared.state.npcs.mira?.location).toBeUndefined();
  });

  it("npc_relocate rejects unknown npcId", () => {
    const state = stateWith({});
    expect(() =>
      applyOneEffect(state, { kind: "npc_relocate", npcId: "ghost", location: "well" }),
    ).toThrow(/npc_not_found:ghost/u);
  });

  it("npc_disposition_delta clamps to [-100, 100]", () => {
    const state = stateWith({ mira: npcFixture({ disposition: 90 }) });
    const over = applyOneEffect(state, {
      kind: "npc_disposition_delta",
      npcId: "mira",
      delta: 500,
    });
    expect(over.state.npcs.mira?.disposition).toBe(100);

    const under = applyOneEffect(over.state, {
      kind: "npc_disposition_delta",
      npcId: "mira",
      delta: -9999,
    });
    expect(under.state.npcs.mira?.disposition).toBe(-100);
  });

  it("npc_disposition_delta rejects unknown npcId", () => {
    const state = stateWith({});
    expect(() =>
      applyOneEffect(state, { kind: "npc_disposition_delta", npcId: "ghost", delta: 1 }),
    ).toThrow(/npc_not_found:ghost/u);
  });

  it("npc_attribute_delta applies bounds and rejects unknowns", () => {
    const state = stateWith({ mira: npcFixture() });
    const up = applyOneEffect(state, {
      kind: "npc_attribute_delta",
      npcId: "mira",
      attributeId: "nerve",
      delta: 10,
    });
    // nerve has max=5 so clamps to 5
    expect(up.state.npcs.mira?.attributes.nerve?.value).toBe(5);

    expect(() =>
      applyOneEffect(state, {
        kind: "npc_attribute_delta",
        npcId: "ghost",
        attributeId: "nerve",
        delta: 1,
      }),
    ).toThrow(/npc_not_found:ghost/u);

    expect(() =>
      applyOneEffect(state, {
        kind: "npc_attribute_delta",
        npcId: "mira",
        attributeId: "unknown",
        delta: 1,
      }),
    ).toThrow(/npc_attribute_not_found:mira:unknown/u);
  });

  it("npc_inventory_add and _remove are idempotent on item id", () => {
    const state = stateWith({ mira: npcFixture() });
    const added = applyOneEffect(state, {
      kind: "npc_inventory_add",
      npcId: "mira",
      item: { id: "lantern", label: "Lantern" },
    });
    expect(added.state.npcs.mira?.inventory).toEqual([{ id: "lantern", label: "Lantern" }]);

    const reAdded = applyOneEffect(added.state, {
      kind: "npc_inventory_add",
      npcId: "mira",
      item: { id: "lantern", label: "Lantern" },
    });
    expect(reAdded.state.npcs.mira?.inventory).toHaveLength(1);
    expect(reAdded.diffs.some((d) => d.kind === "npc_inventory_add")).toBe(false);

    const removed = applyOneEffect(reAdded.state, {
      kind: "npc_inventory_remove",
      npcId: "mira",
      itemId: "lantern",
    });
    expect(removed.state.npcs.mira?.inventory).toEqual([]);

    const removedAgain = applyOneEffect(removed.state, {
      kind: "npc_inventory_remove",
      npcId: "mira",
      itemId: "lantern",
    });
    expect(removedAgain.diffs.some((d) => d.kind === "npc_inventory_remove")).toBe(false);
  });

  it("npc_inventory_add rejects unknown npcId", () => {
    const state = stateWith({});
    expect(() =>
      applyOneEffect(state, {
        kind: "npc_inventory_add",
        npcId: "ghost",
        item: { id: "x", label: "x" },
      }),
    ).toThrow(/npc_not_found:ghost/u);
  });

  it("npc_flag_set writes boolean and number flags with before/after diffs", () => {
    const state = stateWith({ mira: npcFixture() });
    const first = applyOneEffect(state, {
      kind: "npc_flag_set",
      npcId: "mira",
      flag: "talked",
      value: true,
    });
    expect(first.state.npcs.mira?.flags.talked).toBe(true);

    const second = applyOneEffect(first.state, {
      kind: "npc_flag_set",
      npcId: "mira",
      flag: "talked",
      value: false,
    });
    expect(second.state.npcs.mira?.flags.talked).toBe(false);
    expect(
      second.diffs.find((d) => d.kind === "npc_flag_set" && d.flag === "talked"),
    ).toMatchObject({ before: true, after: false });
  });

  it("npc_learn_fact dedupes and trims to 200 chars", () => {
    const state = stateWith({ mira: npcFixture({ knownFacts: [] }) });
    const learned = applyOneEffect(state, {
      kind: "npc_learn_fact",
      npcId: "mira",
      fact: "the well runs deep",
    });
    expect(learned.state.npcs.mira?.knownFacts).toEqual(["the well runs deep"]);

    const dedup = applyOneEffect(learned.state, {
      kind: "npc_learn_fact",
      npcId: "mira",
      fact: "the well runs deep",
    });
    expect(dedup.state.npcs.mira?.knownFacts).toHaveLength(1);
    expect(dedup.diffs.some((d) => d.kind === "npc_learn_fact")).toBe(false);

    const longFact = "a".repeat(500);
    const trimmed = applyOneEffect(dedup.state, {
      kind: "npc_learn_fact",
      npcId: "mira",
      fact: longFact,
    });
    expect(trimmed.state.npcs.mira?.knownFacts[1]?.length).toBe(200);
  });

  it("npc_learn_fact rejects unknown npcId", () => {
    const state = stateWith({});
    expect(() =>
      applyOneEffect(state, { kind: "npc_learn_fact", npcId: "ghost", fact: "x" }),
    ).toThrow(/npc_not_found:ghost/u);
  });

  it("migration adds npcs: {} to a legacy state that lacks the field", () => {
    const current = createInitialState(fixtureStory(), "story", ctx.now, ctx.rngSeed);
    // Synthesize a legacy snapshot: v1 (pre-NPC) with the field missing.
    const legacy = { ...current, schemaVersion: 1 } as PlayerState & { npcs?: unknown };
    delete (legacy as { npcs?: unknown }).npcs;

    const migrated = migrateEngineState(legacy as PlayerState);
    expect(migrated.migrated).toBe(true);
    expect(migrated.state.schemaVersion).toBe(2);
    expect(migrated.state.npcs).toEqual({});
  });
});

// =============================================================================
// Task 56 — NPC-aware choice schema extensions (Requirement 31.4 + 31.5).
// =============================================================================

describe("Choice.requiresNpc visibility gating (Requirement 31.4)", () => {
  function npcCompanion(overrides: Partial<NpcState> = {}): NpcState {
    return {
      id: "mira",
      name: "Mira",
      role: "companion",
      disposition: 0,
      attributes: {},
      knownFacts: [],
      flags: {},
      ...overrides,
    };
  }

  function baseState(): PlayerState {
    // currentNodeId is "start" out of the box, which we lean on as the "scene"
    // that requiresNpc resolves against.
    return createInitialState(fixtureStory(), "story", ctx.now, ctx.rngSeed);
  }

  const npcChoice: Choice = {
    id: "talk-to-mira",
    label: "Confide in Mira",
    targetNodeId: "hall",
    requiresNpc: "mira",
  };

  it("hides the choice when the NPC is absent from the roster", () => {
    const state = baseState();
    expect(state.npcs.mira).toBeUndefined();
    const [evaluation] = evaluateNodeChoices(state, [npcChoice]);
    expect(evaluation?.visibility).toBe("hidden");
  });

  it("hides the choice when the NPC exists but is in a different scene", () => {
    const state: PlayerState = {
      ...baseState(),
      npcs: { mira: npcCompanion({ location: "elsewhere" }) },
    };
    const [evaluation] = evaluateNodeChoices(state, [npcChoice]);
    expect(evaluation?.visibility).toBe("hidden");
  });

  it("hides the choice when the NPC exists but has no location at all", () => {
    const state: PlayerState = {
      ...baseState(),
      npcs: { mira: npcCompanion() }, // no location set
    };
    const [evaluation] = evaluateNodeChoices(state, [npcChoice]);
    expect(evaluation?.visibility).toBe("hidden");
  });

  it("shows the choice when the NPC is co-located with the player", () => {
    const state: PlayerState = {
      ...baseState(),
      npcs: { mira: npcCompanion({ location: "start" }) },
    };
    const [evaluation] = evaluateNodeChoices(state, [npcChoice]);
    expect(evaluation?.visibility).toBe("visible");
  });

  it("treats a legacy save lacking state.npcs as no NPCs present", () => {
    // Simulate an in-flight legacy snapshot the migration step hasn't touched.
    const state = baseState();
    const legacy = { ...state, npcs: undefined as unknown as PlayerState["npcs"] };
    const [evaluation] = evaluateNodeChoices(legacy, [npcChoice]);
    expect(evaluation?.visibility).toBe("hidden");
  });

  it("intersects with condition predicates — both gates must pass", () => {
    const gated: Choice = {
      ...npcChoice,
      // Existing visibility rule: require a flag the state does NOT have.
      conditions: [{ kind: "flag_equals", flag: "trust_built", value: true }],
    };

    // NPC present but condition fails → locked (condition gate is the one
    // that fires; requiresNpc passed silently).
    const presentButGated: PlayerState = {
      ...baseState(),
      npcs: { mira: npcCompanion({ location: "start" }) },
    };
    expect(evaluateNodeChoices(presentButGated, [gated])[0]?.visibility).toBe("locked");

    // NPC absent and condition would fail too → hidden (requiresNpc wins
    // because it short-circuits before any condition is checked).
    const absent = baseState();
    expect(evaluateNodeChoices(absent, [gated])[0]?.visibility).toBe("hidden");

    // NPC present AND condition satisfied → visible.
    const both: PlayerState = {
      ...baseState(),
      npcs: { mira: npcCompanion({ location: "start" }) },
      flags: { ...baseState().flags, trust_built: true },
    };
    expect(evaluateNodeChoices(both, [gated])[0]?.visibility).toBe("visible");
  });

  it("preserves targetNpc on the choice without validating it", () => {
    // targetNpc is a presentational hint — engine never checks the roster.
    const choice: Choice = {
      id: "send-word",
      label: "Send word to a far-off friend",
      targetNodeId: "hall",
      targetNpc: "someone-not-in-roster",
    };
    const [evaluation] = evaluateNodeChoices(baseState(), [choice]);
    expect(evaluation?.visibility).toBe("visible");
    expect(evaluation?.choice.targetNpc).toBe("someone-not-in-roster");
  });
});

describe("resolveSkillCheck companion aggregation (Requirement 31.5)", () => {
  function makeNpc(
    id: string,
    role: NpcState["role"],
    attrs: NpcState["attributes"],
  ): NpcState {
    return {
      id,
      name: id,
      role,
      disposition: 0,
      attributes: attrs,
      knownFacts: [],
      flags: {},
    };
  }

  function stateWithPlayerStat(value: number, npcs: Record<string, NpcState>): PlayerState {
    const base = createInitialState(fixtureStory(), "story", ctx.now, ctx.rngSeed);
    return {
      ...base,
      attributes: {
        ...base.attributes,
        nerve: { id: "nerve", label: "Nerve", value, visibility: "visible" },
      },
      npcs,
    };
  }

  it("aggregates visible companion stats into the effective total", () => {
    const state = stateWithPlayerStat(2, {
      mira: makeNpc("mira", "companion", {
        nerve: { id: "nerve", label: "Nerve", value: 3, visibility: "visible" },
      }),
      kell: makeNpc("kell", "companion", {
        nerve: { id: "nerve", label: "Nerve", value: 1, visibility: "visible" },
      }),
    });

    const result = resolveSkillCheck(state, {
      statId: "nerve",
      difficulty: 5,
      includeCompanions: true,
    });

    expect(result.playerValue).toBe(2);
    expect(result.companionContributions).toEqual([
      { npcId: "mira", value: 3 },
      { npcId: "kell", value: 1 },
    ]);
    expect(result.total).toBe(6);
    expect(result.margin).toBe(1);
    expect(result.passed).toBe(true);
    expect(result.includeCompanions).toBe(true);
  });

  it("does NOT aggregate non-companion roles (ally, rival, neutral, antagonist)", () => {
    const state = stateWithPlayerStat(1, {
      ally: makeNpc("ally", "ally", {
        nerve: { id: "nerve", label: "Nerve", value: 99, visibility: "visible" },
      }),
      rival: makeNpc("rival", "rival", {
        nerve: { id: "nerve", label: "Nerve", value: 99, visibility: "visible" },
      }),
      neutral: makeNpc("neutral", "neutral", {
        nerve: { id: "nerve", label: "Nerve", value: 99, visibility: "visible" },
      }),
      bad: makeNpc("bad", "antagonist", {
        nerve: { id: "nerve", label: "Nerve", value: 99, visibility: "visible" },
      }),
    });

    const result = resolveSkillCheck(state, {
      statId: "nerve",
      difficulty: 3,
      includeCompanions: true,
    });

    expect(result.companionContributions).toEqual([]);
    expect(result.total).toBe(1);
    expect(result.passed).toBe(false);
  });

  it("skips hidden companion attributes even when includeCompanions is true", () => {
    const state = stateWithPlayerStat(2, {
      mira: makeNpc("mira", "companion", {
        // Hidden attribute — the reader doesn't get credit for it.
        nerve: { id: "nerve", label: "Nerve", value: 5, visibility: "hidden" },
      }),
      kell: makeNpc("kell", "companion", {
        // Visible attribute — should aggregate.
        nerve: { id: "nerve", label: "Nerve", value: 2, visibility: "visible" },
      }),
    });

    const result = resolveSkillCheck(state, {
      statId: "nerve",
      difficulty: 5,
      includeCompanions: true,
    });

    expect(result.companionContributions).toEqual([{ npcId: "kell", value: 2 }]);
    expect(result.total).toBe(4);
    expect(result.passed).toBe(false);
  });

  it("uses player stat only when includeCompanions is undefined", () => {
    const state = stateWithPlayerStat(2, {
      mira: makeNpc("mira", "companion", {
        nerve: { id: "nerve", label: "Nerve", value: 5, visibility: "visible" },
      }),
    });

    const result = resolveSkillCheck(state, { statId: "nerve", difficulty: 3 });

    expect(result.includeCompanions).toBe(false);
    expect(result.companionContributions).toEqual([]);
    expect(result.total).toBe(2);
    expect(result.passed).toBe(false);
  });

  it("uses player stat only when includeCompanions is explicitly false", () => {
    const state = stateWithPlayerStat(2, {
      mira: makeNpc("mira", "companion", {
        nerve: { id: "nerve", label: "Nerve", value: 5, visibility: "visible" },
      }),
    });

    const result = resolveSkillCheck(state, {
      statId: "nerve",
      difficulty: 3,
      includeCompanions: false,
    });

    expect(result.companionContributions).toEqual([]);
    expect(result.total).toBe(2);
  });

  it("falls back to 0 when the player lacks the stat entirely", () => {
    const state = stateWithPlayerStat(0, {});
    delete state.attributes.nerve;
    const result = resolveSkillCheck(state, {
      statId: "nerve",
      difficulty: 1,
      includeCompanions: true,
    });
    expect(result.playerValue).toBe(0);
    expect(result.total).toBe(0);
    expect(result.passed).toBe(false);
  });
});
