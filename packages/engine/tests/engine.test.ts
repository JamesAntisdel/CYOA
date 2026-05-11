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
  resolveTerminal,
  setFlag,
  shouldPurgeOnDeath,
  switchMode,
  unsetFlag,
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
    expect(migrated.state.schemaVersion).toBe(1);
    expect(() => migrateEngineState({ ...current, schemaVersion: 999 })).toThrow(
      "unsupported_future_engine_schema",
    );
  });
});
