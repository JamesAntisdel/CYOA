import type { StarterStory } from "../metadata";

/**
 * The "Open Canvas" starter is a shell adventure used by the seed-flow's
 * open-premise launch path. Reader-authored seeds bind a real premise via
 * `save.seedPremise` on the save record; the engine's LLM pipeline reads
 * that override and uses it as the opening — the starter's own `start.seed`
 * is just a generic fallback so the contract stays well-formed when no
 * override is supplied (e.g. in tests).
 *
 * Initial state is intentionally generic — no themed attributes (no
 * "resolve", no "lantern"), zero currency, empty inventory and flags — so
 * the LLM is free to introduce whatever stats / items the reader's premise
 * suggests rather than being primed by the starter scaffolding.
 *
 * The node graph is the minimum the validator accepts for an "authored"
 * shape: a `start` node and a single registered `ending-default` (success).
 * The summary still declares `mode: "llm-driven"` so the runtime treats
 * every turn as LLM-proposed; the ending node only exists so the success
 * registration has a referencing node and so the validator does not flag
 * an unused registered ending.
 */
export const openCanvas: StarterStory = {
  summary: {
    id: "open-canvas",
    title: "Open Canvas",
    summary:
      "A blank starter for reader-authored premises — bring your own world, the engine fills in the rest.",
    tone: "open",
    difficulty: "medium",
    estimatedLength: "15-25 minutes",
    entitlementRequired: "free",
    safetyProfile: "general",
    mode: "llm-driven",
  },
  story: {
    id: "open-canvas",
    version: 1,
    title: "Open Canvas",
    defaultSceneLength: "standard",
    startNodeId: "start",
    initialState: {
      vitality: 5,
      currency: 0,
      attributes: {},
      inventory: [],
      flags: {},
    },
    endings: {
      "ending-default": {
        id: "ending-default",
        label: "An ending arrives",
        kind: "success",
      },
    },
    nodes: {
      start: {
        id: "start",
        title: "Open Canvas",
        seed: "The story begins.",
        choices: [],
      },
      "ending-default": {
        id: "ending-default",
        title: "An ending arrives",
        seed: "The story closes on its own terms.",
        endingId: "ending-default",
        choices: [],
      },
    },
  },
};

export const OPEN_STARTER_ID = "open-canvas";
