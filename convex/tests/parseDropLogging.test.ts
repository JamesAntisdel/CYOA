// W1-S7: the convex parse boundary logs tolerant-drops (effects, conditions,
// storyArc, beatFired) so model drift stays visible (BC5). Drop-logging is
// best-effort and must NEVER throw. Exercised through `parseLlmDrivenScene`,
// which calls the private `logDroppedLlmEffects` before validating.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseLlmDrivenScene } from "../llm/parse";

let warnings: string[] = [];

beforeEach(() => {
  warnings = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function sceneJson(extra: Record<string, unknown>): string {
  return JSON.stringify({
    prose: "The tide claws at the seawall.",
    choices: [
      { id: "a", label: "Hold the line" },
      { id: "b", label: "Fall back" },
    ],
    ...extra,
  });
}

describe("logDroppedLlmEffects (W1-S7)", () => {
  it("logs dropped conditions without failing the scene", () => {
    const raw = sceneJson({
      choices: [
        {
          id: "a",
          label: "Hold",
          // One valid condition + one bogus-kind entry → the bogus one drops.
          conditions: [
            { kind: "has_item", itemId: "key" },
            { kind: "totally-made-up", value: 3 },
          ],
        },
        { id: "b", label: "Fall back" },
      ],
    });
    const parsed = parseLlmDrivenScene(raw);
    expect(parsed.choices).toHaveLength(2);
    expect(warnings.some((w) => w.includes("invalid llm condition"))).toBe(true);
  });

  it("logs a dropped malformed storyArc without failing the scene", () => {
    const raw = sceneJson({ storyArc: "this is not an arc object" });
    // Malformed storyArc is caught → undefined; the scene still parses.
    expect(() => parseLlmDrivenScene(raw)).not.toThrow();
    expect(warnings.some((w) => w.includes("storyArc"))).toBe(true);
  });

  it("still logs dropped effects (regression)", () => {
    const raw = sceneJson({
      choices: [
        {
          id: "a",
          label: "Hold",
          effects: [{ kind: "nonsense_effect", value: 1 }],
        },
        { id: "b", label: "Fall back" },
      ],
    });
    parseLlmDrivenScene(raw);
    expect(warnings.some((w) => w.includes("invalid llm effect"))).toBe(true);
  });

  it("does not log for a clean scene", () => {
    parseLlmDrivenScene(sceneJson({}));
    expect(warnings).toHaveLength(0);
  });

  it("never throws from drop-logging itself on structurally odd input", () => {
    // A shape the scene schema rejects → parse throws the EXPECTED error, but
    // the drop-logging that runs first must not raise its own exception.
    const raw = JSON.stringify({ prose: "", choices: "not-an-array", beatFired: 42 });
    expect(() => parseLlmDrivenScene(raw)).toThrow("llm_scene_invalid_shape");
  });
});
