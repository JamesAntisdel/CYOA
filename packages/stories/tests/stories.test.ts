import { describe, expect, it } from "vitest";

import {
  assertValidStory,
  getStory,
  listStarterStories,
  listStarterStoryDefinitions,
  trainingRoom,
  validateStory,
} from "../src";

describe("starter stories", () => {
  it("lists all V1 starter adventures", () => {
    expect(listStarterStories().map((story) => story.id)).toEqual([
      "training-room",
      "bone-cathedral",
      "iron-court",
      "ashfall",
    ]);
  });

  it("returns stories by id", () => {
    expect(getStory("training-room").title).toBe("Escape the Training Room");
    expect(() => getStory("missing")).toThrow("story_not_found:missing");
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
});
