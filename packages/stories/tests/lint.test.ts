import { describe, expect, it } from "vitest";

import type {
  AttributeState,
  Effect,
  InventoryItem,
  Story,
  StoryNode,
} from "@cyoa/engine";

import { lintStoryGates, type StoryLintIssue } from "../src/lint";

function makeStory(input: {
  nodes: Record<string, StoryNode>;
  startNodeId?: string;
  vitality?: number;
  inventory?: InventoryItem[];
  flags?: Record<string, boolean | number | string>;
  attributes?: Record<string, AttributeState>;
}): Story {
  return {
    id: "lint-fixture",
    version: 1,
    title: "Lint Fixture",
    startNodeId: input.startNodeId ?? "start",
    initialState: {
      vitality: input.vitality ?? 10,
      currency: 0,
      ...(input.inventory ? { inventory: input.inventory } : {}),
      ...(input.flags ? { flags: input.flags } : {}),
      ...(input.attributes ? { attributes: input.attributes } : {}),
    },
    endings: {},
    nodes: input.nodes,
  };
}

function grant(id: string, label: string): Effect[] {
  return [{ kind: "inventory_add", item: { id, label } }];
}

function codes(issues: StoryLintIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

describe("lintStoryGates", () => {
  // Table: graphs where every gate is provably satisfiable → zero issues.
  const cleanCases: Array<{ name: string; story: Story }> = [
    {
      name: "linear graph with exact grants (removals/currency ignored)",
      story: makeStory({
        nodes: {
          start: {
            id: "start",
            choices: [
              {
                id: "grab",
                label: "Grab the key.",
                targetNodeId: "hall",
                effects: [
                  ...grant("bone_key", "Bone Key"),
                  { kind: "flag_set", flag: "brave", value: true },
                  { kind: "currency", delta: 5 },
                  { kind: "flag_unset", flag: "asleep" },
                ],
              },
            ],
          },
          hall: {
            id: "hall",
            choices: [
              {
                id: "open",
                label: "Open the door.",
                targetNodeId: "end",
                conditions: [
                  { kind: "has_item", itemId: "bone_key" },
                  { kind: "flag_equals", flag: "brave", value: true },
                ],
                effects: [{ kind: "inventory_remove", itemId: "bone_key" }],
              },
            ],
          },
          end: { id: "end", choices: [] },
        },
      }),
    },
    {
      name: "branching graph where ANY route into the gate node grants the key",
      story: makeStory({
        nodes: {
          start: {
            id: "start",
            choices: [
              { id: "left", label: "Left.", targetNodeId: "a" },
              { id: "right", label: "Right.", targetNodeId: "b" },
            ],
          },
          a: {
            id: "a",
            choices: [
              { id: "on", label: "Onward.", targetNodeId: "hall", effects: grant("key", "Key") },
            ],
          },
          b: {
            id: "b",
            choices: [{ id: "on", label: "Onward.", targetNodeId: "hall" }],
          },
          hall: {
            id: "hall",
            choices: [
              {
                id: "open",
                label: "Unlock.",
                targetNodeId: "end",
                conditions: [{ kind: "has_item", itemId: "key" }],
              },
            ],
          },
          end: { id: "end", choices: [] },
        },
      }),
    },
    {
      name: "delayed bundle grants count from the moment they are scheduled",
      story: makeStory({
        nodes: {
          start: {
            id: "start",
            effectsOnEnter: [
              {
                kind: "delayed",
                delayNodes: 2,
                effects: [{ kind: "inventory_add", item: { id: "ember", label: "Ember" } }],
              },
            ],
            choices: [{ id: "walk", label: "Walk.", targetNodeId: "hall" }],
          },
          hall: {
            id: "hall",
            choices: [
              {
                id: "burn",
                label: "Burn the vines.",
                targetNodeId: "end",
                conditions: [{ kind: "has_item", itemId: "ember" }],
              },
            ],
          },
          end: { id: "end", choices: [] },
        },
      }),
    },
    {
      name: "initial inventory and initial flags satisfy gates",
      story: makeStory({
        inventory: [{ id: "torch", label: "Torch" }],
        flags: { oath_sworn: true },
        nodes: {
          start: {
            id: "start",
            choices: [
              {
                id: "descend",
                label: "Descend.",
                targetNodeId: "end",
                conditions: [
                  { kind: "has_item", itemId: "torch" },
                  { kind: "flag_equals", flag: "oath_sworn", value: true },
                  { kind: "missing_item", itemId: "torch" },
                ],
              },
            ],
          },
          end: { id: "end", choices: [] },
        },
      }),
    },
    {
      name: "always and mode_is conditions need no grants",
      story: makeStory({
        nodes: {
          start: {
            id: "start",
            choices: [
              {
                id: "go",
                label: "Go.",
                targetNodeId: "end",
                conditions: [{ kind: "always" }, { kind: "mode_is", mode: "hardcore" }],
              },
            ],
          },
          end: { id: "end", choices: [] },
        },
      }),
    },
  ];

  it.each(cleanCases)("passes clean story: $name", ({ story }) => {
    expect(lintStoryGates(story)).toEqual([]);
  });

  it("flags a has_item gate no path can ever grant (dead key)", () => {
    const story = makeStory({
      nodes: {
        start: {
          id: "start",
          choices: [{ id: "walk", label: "Walk.", targetNodeId: "hall" }],
        },
        hall: {
          id: "hall",
          choices: [
            {
              id: "open",
              label: "Use the golden key.",
              targetNodeId: "end",
              conditions: [{ kind: "has_item", itemId: "golden_key" }],
            },
          ],
        },
        end: { id: "end", choices: [] },
      },
    });

    const issues = lintStoryGates(story);
    expect(codes(issues)).toEqual(["dead_item_gate"]);
    expect(issues[0]).toMatchObject({
      path: "nodes.hall.choices.open.conditions.0",
      severity: "error",
    });
    expect(issues[0]?.message).toContain('"golden_key"');
    expect(issues[0]?.message).toContain('"Use the golden key."');
    expect(issues[0]?.message).toContain('node "hall"');
    expect(issues[0]?.message).toContain("inventory_add");
  });

  it("flags gates satisfiable only via fuzzy spelling drift, citing both spellings", () => {
    const story = makeStory({
      nodes: {
        start: {
          id: "start",
          choices: [
            {
              id: "grab",
              label: "Grab.",
              targetNodeId: "hall",
              effects: grant("bone_key", "Bone Key"),
            },
          ],
        },
        hall: {
          id: "hall",
          choices: [
            {
              id: "open",
              label: "Open.",
              targetNodeId: "end",
              conditions: [{ kind: "has_item", itemId: "Bone-Key" }],
            },
          ],
        },
        end: { id: "end", choices: [] },
      },
    });

    const issues = lintStoryGates(story);
    expect(codes(issues)).toEqual(["fuzzy_item_gate"]);
    expect(issues[0]?.severity).toBe("error");
    // Both the gate's spelling and the granted spellings are cited so the
    // creator knows exactly which two strings to reconcile.
    expect(issues[0]?.message).toContain('"Bone-Key"');
    expect(issues[0]?.message).toContain('"bone_key"');
    expect(issues[0]?.message).toContain('"Bone Key"');
    expect(issues[0]?.message).toContain("exactly");
  });

  it("diagnoses fuzzy drift against item labels too", () => {
    const story = makeStory({
      nodes: {
        start: {
          id: "start",
          choices: [
            {
              id: "grab",
              label: "Pocket the coin.",
              targetNodeId: "hall",
              effects: grant("k1", "Silver Coin"),
            },
          ],
        },
        hall: {
          id: "hall",
          choices: [
            {
              id: "pay",
              label: "Pay the toll.",
              targetNodeId: "end",
              conditions: [{ kind: "has_item", itemId: "silver_coin" }],
            },
          ],
        },
        end: { id: "end", choices: [] },
      },
    });

    const issues = lintStoryGates(story);
    expect(codes(issues)).toEqual(["fuzzy_item_gate"]);
    expect(issues[0]?.message).toContain('"Silver Coin"');
  });

  it("does not credit grants from branches that never reach the gate node", () => {
    const story = makeStory({
      nodes: {
        start: {
          id: "start",
          choices: [
            { id: "left", label: "Left.", targetNodeId: "a" },
            { id: "right", label: "Right.", targetNodeId: "hall" },
          ],
        },
        // The key exists in the story — but only on a branch that dead-ends
        // away from the gate. Per-node path unions catch this; a global
        // "is it granted anywhere" check would not.
        a: {
          id: "a",
          choices: [
            {
              id: "on",
              label: "Onward.",
              targetNodeId: "deadend",
              effects: grant("key", "Key"),
            },
          ],
        },
        deadend: { id: "deadend", choices: [] },
        hall: {
          id: "hall",
          choices: [
            {
              id: "open",
              label: "Unlock.",
              targetNodeId: "end",
              conditions: [{ kind: "has_item", itemId: "key" }],
            },
          ],
        },
        end: { id: "end", choices: [] },
      },
    });

    expect(codes(lintStoryGates(story))).toEqual(["dead_item_gate"]);
  });

  it("flags flag_equals gates on flags never set, and on values never granted", () => {
    const story = makeStory({
      nodes: {
        start: {
          id: "start",
          choices: [
            {
              id: "swear",
              label: "Swear.",
              targetNodeId: "hall",
              effects: [{ kind: "flag_set", flag: "courage", value: "high" }],
            },
            {
              id: "mutter",
              label: "Mutter.",
              targetNodeId: "hall",
              effects: [{ kind: "flag_set", flag: "courage", value: "high" }],
            },
          ],
        },
        hall: {
          id: "hall",
          choices: [
            {
              id: "never-set",
              label: "Speak the unset word.",
              targetNodeId: "end",
              conditions: [{ kind: "flag_equals", flag: "ghost_flag", value: true }],
            },
            {
              id: "wrong-value",
              label: "Whisper.",
              targetNodeId: "end",
              conditions: [{ kind: "flag_equals", flag: "courage", value: "low" }],
            },
          ],
        },
        end: { id: "end", choices: [] },
      },
    });

    const issues = lintStoryGates(story);
    expect(codes(issues)).toEqual(["dead_flag_gate", "dead_flag_gate"]);
    expect(issues[0]?.message).toContain('"ghost_flag"');
    expect(issues[0]?.message).toContain("ever sets that flag");
    expect(issues[1]?.message).toContain('"low"');
    expect(issues[1]?.message).toContain('"high"');
  });

  it("warns on stat_at_least thresholds above the optimistic maximum", () => {
    const story = makeStory({
      attributes: {
        resolve: { id: "resolve", label: "Resolve", value: 1, visibility: "hidden" },
      },
      nodes: {
        start: {
          id: "start",
          choices: [
            {
              id: "train",
              label: "Train.",
              targetNodeId: "hall",
              effects: [{ kind: "stat", statId: "resolve", delta: 1 }],
            },
          ],
        },
        hall: {
          id: "hall",
          choices: [
            {
              id: "leap",
              label: "Leap the chasm.",
              targetNodeId: "end",
              conditions: [{ kind: "stat_at_least", statId: "resolve", value: 5 }],
            },
          ],
        },
        end: { id: "end", choices: [] },
      },
    });

    const issues = lintStoryGates(story);
    expect(codes(issues)).toEqual(["unreachable_stat_gate"]);
    expect(issues[0]?.severity).toBe("warning");
    expect(issues[0]?.message).toContain('"resolve" >= 5');
    expect(issues[0]?.message).toContain("is 2");
  });

  it("does not warn when repeat visits around a cycle can grind the stat (widening)", () => {
    // grit climbs +1 and doom sinks -1 per lap of a self-loop; both are
    // undeclared (unclamped) attributes, so the fixpoint widens them to
    // +/-Infinity instead of looping forever — and neither gate warns.
    const story = makeStory({
      nodes: {
        start: {
          id: "start",
          choices: [{ id: "enter", label: "Enter.", targetNodeId: "loop" }],
        },
        loop: {
          id: "loop",
          choices: [
            {
              id: "lap",
              label: "Run another lap.",
              targetNodeId: "loop",
              effects: [
                { kind: "stat", statId: "grit", delta: 1 },
                { kind: "stat", statId: "doom", delta: -1 },
              ],
            },
            {
              id: "exit-high",
              label: "Leave hardened.",
              targetNodeId: "end",
              conditions: [{ kind: "stat_at_least", statId: "grit", value: 50 }],
            },
            {
              id: "exit-low",
              label: "Leave hollowed.",
              targetNodeId: "end",
              conditions: [{ kind: "stat_at_most", statId: "doom", value: -50 }],
            },
          ],
        },
        end: { id: "end", choices: [] },
      },
    });

    expect(lintStoryGates(story)).toEqual([]);
  });

  it("keeps warning when a declared attribute max clamps a grinding cycle", () => {
    const story = makeStory({
      attributes: {
        resolve: { id: "resolve", label: "Resolve", value: 1, visibility: "hidden", min: 0, max: 3 },
      },
      nodes: {
        start: {
          id: "start",
          choices: [{ id: "enter", label: "Enter.", targetNodeId: "loop" }],
        },
        loop: {
          id: "loop",
          choices: [
            {
              id: "lap",
              label: "Meditate again.",
              targetNodeId: "loop",
              effects: [{ kind: "stat", statId: "resolve", delta: 1 }],
            },
            {
              id: "ascend",
              label: "Ascend.",
              targetNodeId: "end",
              conditions: [{ kind: "stat_at_least", statId: "resolve", value: 5 }],
            },
          ],
        },
        end: { id: "end", choices: [] },
      },
    });

    const issues = lintStoryGates(story);
    expect(codes(issues)).toEqual(["unreachable_stat_gate"]);
    expect(issues[0]?.message).toContain("is 3");
  });

  it("warns on stat_at_most gates below the clamped minimum", () => {
    // Vitality is engine-clamped to >= 0, so a <= -1 gate can never pass no
    // matter which of the three bleed routes the reader takes.
    const story = makeStory({
      vitality: 5,
      nodes: {
        start: {
          id: "start",
          choices: [
            {
              id: "graze",
              label: "Take a graze.",
              targetNodeId: "low",
              effects: [{ kind: "stat", statId: "vitality", delta: -2 }],
            },
            {
              id: "plummet",
              label: "Take the fall.",
              targetNodeId: "low",
              effects: [{ kind: "stat", statId: "vitality", delta: -10 }],
            },
            {
              id: "scratch",
              label: "Take a scratch.",
              targetNodeId: "low",
              effects: [{ kind: "stat", statId: "vitality", delta: -1 }],
            },
          ],
        },
        low: {
          id: "low",
          choices: [
            {
              id: "ghost",
              label: "Slip through as a ghost.",
              targetNodeId: "end",
              conditions: [{ kind: "stat_at_most", statId: "vitality", value: -1 }],
            },
          ],
        },
        end: { id: "end", choices: [] },
      },
    });

    const issues = lintStoryGates(story);
    expect(codes(issues)).toEqual(["unreachable_stat_gate"]);
    expect(issues[0]?.message).toContain('"vitality" <= -1');
    expect(issues[0]?.message).toContain("is 0");
  });

  it("reports never-grantable missing_item conditions as trivially-true info", () => {
    const story = makeStory({
      nodes: {
        start: {
          id: "start",
          choices: [
            {
              id: "grab",
              label: "Grab.",
              targetNodeId: "hall",
              effects: grant("bone_key", "Bone Key"),
            },
          ],
        },
        hall: {
          id: "hall",
          choices: [
            {
              id: "sneak",
              label: "Sneak past unburdened.",
              targetNodeId: "end",
              conditions: [{ kind: "missing_item", itemId: "cursed_idol" }],
            },
            {
              id: "sneak-fuzzy",
              label: "Sneak with clean hands.",
              targetNodeId: "end",
              conditions: [{ kind: "missing_item", itemId: "Bone-Key" }],
            },
          ],
        },
        end: { id: "end", choices: [] },
      },
    });

    const issues = lintStoryGates(story);
    expect(codes(issues)).toEqual(["trivial_missing_item", "trivial_missing_item"]);
    expect(issues.every((issue) => issue.severity === "info")).toBe(true);
    expect(issues[0]?.message).toContain('"cursed_idol"');
    expect(issues[0]?.message).toContain("always true");
    // The fuzzy-drift variant tells the creator the near-miss spellings.
    expect(issues[1]?.message).toContain("do not count");
    expect(issues[1]?.message).toContain('"bone_key"');
  });

  it("skips statically hidden choices: their gates are unlintable and their grants never apply", () => {
    const story = makeStory({
      nodes: {
        start: {
          id: "start",
          choices: [
            {
              id: "secret",
              label: "A choice no reader ever sees.",
              targetNodeId: "hall",
              visibility: "hidden",
              effects: grant("key", "Key"),
            },
            { id: "walk", label: "Walk.", targetNodeId: "hall" },
          ],
        },
        hall: {
          id: "hall",
          choices: [
            {
              id: "open",
              label: "Unlock.",
              targetNodeId: "end",
              conditions: [{ kind: "has_item", itemId: "key" }],
            },
            {
              id: "phantom",
              label: "Hidden and impossible.",
              targetNodeId: "end",
              visibility: "hidden",
              conditions: [{ kind: "has_item", itemId: "nonexistent" }],
            },
          ],
        },
        end: { id: "end", choices: [] },
      },
    });

    // Only the VISIBLE dead gate fires: the hidden grant did not count toward
    // it, and the hidden impossible gate is not reported at all.
    const issues = lintStoryGates(story);
    expect(codes(issues)).toEqual(["dead_item_gate"]);
    expect(issues[0]?.path).toBe("nodes.hall.choices.open.conditions.0");
  });

  it("stays silent when the start node is missing (structural validation owns that)", () => {
    const story = makeStory({
      startNodeId: "nope",
      nodes: {
        hall: {
          id: "hall",
          choices: [
            {
              id: "open",
              label: "Unlock.",
              targetNodeId: "hall",
              conditions: [{ kind: "has_item", itemId: "key" }],
            },
          ],
        },
      },
    });

    expect(lintStoryGates(story)).toEqual([]);
  });

  it("skips edges to missing nodes and does not lint unreachable islands", () => {
    const story = makeStory({
      nodes: {
        start: {
          id: "start",
          choices: [{ id: "walk", label: "Walk into the void.", targetNodeId: "ghost-node" }],
        },
        island: {
          id: "island",
          choices: [
            {
              id: "open",
              label: "Unlock.",
              targetNodeId: "island",
              conditions: [{ kind: "has_item", itemId: "key" }],
            },
          ],
        },
      },
    });

    expect(lintStoryGates(story)).toEqual([]);
  });

  it("ignores item spellings that normalize to nothing", () => {
    const story = makeStory({
      nodes: {
        start: {
          id: "start",
          choices: [
            {
              id: "grab",
              label: "Grab the unnameable.",
              targetNodeId: "hall",
              effects: grant("!!!", "???"),
            },
          ],
        },
        hall: {
          id: "hall",
          choices: [
            {
              id: "open",
              label: "Unlock.",
              targetNodeId: "end",
              conditions: [{ kind: "has_item", itemId: "key" }],
            },
          ],
        },
        end: { id: "end", choices: [] },
      },
    });

    // The punctuation-only grant produces no fuzzy match key; the real gate
    // is reported dead, not fuzzy.
    expect(codes(lintStoryGates(story))).toEqual(["dead_item_gate"]);
  });
});
