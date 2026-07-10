import type { StarterStory } from "./metadata";

/**
 * LLM-driven starter stub. The story ships only a `start` node carrying the
 * premise / seed text and the initial player state; everything past the
 * opening scene is proposed by the LLM and validated by the engine.
 *
 * No hardcoded endings or choice graphs — the engine treats this as a
 * generative scaffold and stamps synthetic node ids per turn so save state
 * still has a stable cursor.
 */
function llmDrivenStub(args: {
  id: string;
  title: string;
  summary: string;
  tone: string;
  difficulty: "easy" | "medium" | "hard";
  premise: string;
  initialFlags?: Record<string, boolean | number | string>;
  initialAttributes?: Record<string, { id: string; label: string; value: number; visibility: "visible" | "hidden"; min?: number; max?: number }>;
}): StarterStory {
  return {
    summary: {
      id: args.id,
      title: args.title,
      summary: args.summary,
      tone: args.tone,
      difficulty: args.difficulty,
      estimatedLength: args.difficulty === "hard" ? "25-35 minutes" : "15-25 minutes",
      entitlementRequired: "free",
      safetyProfile: "general",
      mode: "llm-driven",
    },
    story: {
      id: args.id,
      version: 1,
      title: args.title,
      defaultSceneLength: args.difficulty === "hard" ? "rich" : "standard",
      startNodeId: "start",
      initialState: {
        vitality: 10,
        currency: 0,
        attributes: args.initialAttributes ?? {
          resolve: {
            id: "resolve",
            label: "Resolve",
            value: 1,
            visibility: "hidden",
          },
        },
        inventory: [],
        flags: args.initialFlags ?? {},
      },
      endings: {},
      nodes: {
        start: {
          id: "start",
          title: args.title,
          seed: args.premise,
          choices: [],
        },
      },
    },
  };
}

export const boneCathedral = llmDrivenStub({
  id: "bone-cathedral",
  title: "Bone Cathedral",
  summary: "A gothic expedition through a silent cathedral of relics and vows.",
  tone: "gothic mystery",
  difficulty: "medium",
  premise:
    "You wake at the threshold of a vast cathedral built from yellowed bone. Candles burn cold and a censer rocks of its own accord. Reliquaries line the nave; behind one, an iron door hums. The air smells of myrrh and old water. Somewhere far above, a bell counts to a number you have not yet earned.",
});

export const ironCourt = llmDrivenStub({
  id: "iron-court",
  title: "Iron Court",
  summary: "A court-intrigue tale of favors, masks, and locked-room diplomacy.",
  tone: "political intrigue",
  difficulty: "medium",
  premise:
    "Tonight the Iron Court convenes behind sealed doors, and the queen has named you petitioner-of-record. The masks are already on; the ledgers are already burning in tasteful, decorative braziers. You hold three favors and one secret. Everyone you bow to is measuring what to take from you first.",
});

export const ashfall = llmDrivenStub({
  id: "ashfall",
  title: "Ashfall",
  summary: "A hard survival journey across a city buried in warm gray ash.",
  tone: "survival",
  difficulty: "hard",
  premise:
    "Three days ago the mountain woke and the city stopped breathing. Now the streets are knee-deep in warm gray ash and the sun is a copper coin behind soot. You have a damp cloth tied across your face, a half-bottle of water, and a map that no longer matches the skyline. The road out is across town. The road out may not exist.",
});
