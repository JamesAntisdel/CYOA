import { describe, expect, it } from "vitest";

import {
  applyChoiceAndEnterNode,
  createInitialState,
  evaluateNodeChoices,
} from "@cyoa/engine";

import {
  assertValidStory,
  getStory,
  getStoryMode,
  listStarterStories,
  listStarterStoryDefinitions,
  trainingRoom,
  validateStory,
} from "../src";

const ctx = { now: 1, rngSeed: "stories-test" };

describe("starter stories", () => {
  it("lists all V1 starter adventures", () => {
    expect(listStarterStories().map((story) => story.id)).toEqual([
      "training-room",
      "bone-cathedral",
      "iron-court",
      "ashfall",
    ]);
  });

  it("does not expose the open-canvas seed shell in the public starter list", () => {
    expect(listStarterStories().map((story) => story.id)).not.toContain("open-canvas");
  });

  it("returns stories by id", () => {
    expect(getStory("training-room").title).toBe("Escape the Training Room");
    expect(() => getStory("missing")).toThrow("story_not_found:missing");
  });

  it("resolves the hidden open-canvas starter via getStory and getStoryMode", () => {
    expect(getStory("open-canvas").title).toBe("Open Canvas");
    expect(getStoryMode("open-canvas")).toBe("llm-driven");
  });

  it("validates every starter story", () => {
    for (const starter of listStarterStoryDefinitions()) {
      expect(validateStory(starter.story)).toEqual({ valid: true, issues: [] });
    }
  });

  it("rejects missing target nodes", () => {
    const story = structuredClone(trainingRoom.story);
    story.nodes["waking-cell"]!.choices[0]!.targetNodeId = "missing";

    const result = validateStory(story);

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.path).toContain("targetNodeId");
  });

  it("reports every structural validation issue and throws a readable summary", () => {
    const story = structuredClone(trainingRoom.story);
    story.startNodeId = "missing-start";
    story.deathNodeId = "missing-death";
    story.nodes["waking-cell"]!.endingId = "missing-ending";
    story.endings.unused = { id: "unused", label: "Unused", kind: "other" };

    const result = validateStory(story);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "startNodeId",
        "deathNodeId",
        "nodes.waking-cell.endingId",
        "endings.unused",
      ]),
    );
    expect(() => assertValidStory(story)).toThrow(/startNodeId: Start node does not exist/u);
  });

  it("fails validation when an authored gate's key is never granted (dead key)", () => {
    const story = structuredClone(trainingRoom.story);
    story.nodes["rune-hall"]!.choices[0]!.conditions = [
      { kind: "has_item", itemId: "golden_key", hint: "Needs Golden Key" },
    ];

    const result = validateStory(story);

    expect(result.valid).toBe(false);
    const lintIssue = result.issues.find((issue) => issue.severity === "error");
    expect(lintIssue?.path).toBe("nodes.rune-hall.choices.unlock-gate.conditions.0");
    expect(lintIssue?.message).toContain('"golden_key"');
    expect(() => assertValidStory(story)).toThrow(/golden_key/u);
  });

  it("fails validation on strict-vs-fuzzy spelling drift, citing both spellings", () => {
    const story = structuredClone(trainingRoom.story);
    // The grant stays "rusty_key"; the gate drifts to "Rusty-Key". The
    // authored runtime matches ids strictly (engine hasItem), so this is a
    // soft-lock even though normalizeItemRef would consider them the same.
    story.nodes["rune-hall"]!.choices[0]!.conditions = [
      { kind: "has_item", itemId: "Rusty-Key", hint: "Needs Rusty Key" },
    ];

    const result = validateStory(story);

    expect(result.valid).toBe(false);
    const lintIssue = result.issues.find((issue) => issue.severity === "error");
    expect(lintIssue?.message).toContain('"Rusty-Key"');
    expect(lintIssue?.message).toContain('"rusty_key"');
  });

  it("keeps unreachable-stat lint warnings non-blocking", () => {
    const story = structuredClone(trainingRoom.story);
    story.nodes["weight-room"]!.choices[2]!.conditions = [
      { kind: "stat_at_least", statId: "resolve", value: 99 },
    ];

    const result = validateStory(story);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([
      expect.objectContaining({
        severity: "warning",
        path: "nodes.weight-room.choices.force-final-door.conditions.0",
      }),
    ]);
    expect(() => assertValidStory(story)).not.toThrow();
  });

  it("training-room includes required tutorial mechanics", () => {
    const story = trainingRoom.story;
    const nodes = Object.values(story.nodes);
    const choices = nodes.flatMap((node) => node.choices);
    const effects = choices.flatMap((choice) => choice.effects ?? []);
    const enterEffects = nodes.flatMap((node) => node.effectsOnEnter ?? []);

    expect(nodes.filter((node) => !node.endingId)).toHaveLength(3);
    expect(effects.some((effect) => effect.kind === "inventory_add")).toBe(true);
    expect(effects.some((effect) => effect.kind === "inventory_remove")).toBe(true);
    expect(effects.some((effect) => effect.kind === "stat")).toBe(true);
    expect(enterEffects.some((effect) => effect.kind === "delayed")).toBe(true);
    expect(choices.some((choice) => choice.conditions?.some((c) => c.kind === "stat_at_least"))).toBe(true);
    expect(Object.values(story.endings).some((ending) => ending.kind === "death")).toBe(true);
    expect(Object.values(story.endings).some((ending) => ending.kind === "success")).toBe(true);
    expect(() => assertValidStory(story)).not.toThrow();
  });

  it("training-room leaves every Room 3 route with an available final choice", () => {
    const story = trainingRoom.story;
    const routes = [
      ["take-key", "unlock-gate"],
      ["study-runes", "trace-sigil"],
      ["study-runes", "grab-bowl"],
      ["kick-door", "grab-bowl"],
    ];

    for (const route of routes) {
      const state = route.reduce(
        (currentState, choiceId) =>
          applyChoiceAndEnterNode(currentState, story, choiceId, ctx).state,
        createInitialState(story, "story", ctx.now, ctx.rngSeed),
      );
      const node = story.nodes[state.currentNodeId];
      expect(node?.id).toBe("weight-room");
      expect(
        evaluateNodeChoices(state, node!.choices).some(
          (choice) => choice.visibility === "visible",
        ),
      ).toBe(true);
    }
  });
});
