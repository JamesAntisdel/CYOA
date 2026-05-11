import type { StarterStory } from "./metadata";

function starterStub(args: {
  id: string;
  title: string;
  summary: string;
  tone: string;
  difficulty: "easy" | "medium" | "hard";
}): StarterStory {
  return {
    summary: {
      ...args,
      estimatedLength: args.difficulty === "hard" ? "25-35 minutes" : "15-25 minutes",
      entitlementRequired: "free",
      safetyProfile: "general",
    },
    story: {
      id: args.id,
      version: 1,
      title: args.title,
      defaultSceneLength: args.difficulty === "hard" ? "rich" : "standard",
      startNodeId: "start",
      deathNodeId: "ending-death",
      initialState: {
        vitality: 10,
        currency: 0,
        attributes: {
          resolve: {
            id: "resolve",
            label: "Resolve",
            value: 1,
            visibility: "hidden",
          },
        },
        inventory: [],
        flags: {},
      },
      endings: {
        "ending-death": {
          id: "ending-death",
          label: "A Door Closes",
          kind: "death",
        },
        "ending-success": {
          id: "ending-success",
          label: "A Path Opens",
          kind: "success",
        },
      },
      nodes: {
        start: {
          id: "start",
          seed: `${args.title} begins with a general-audience premise and a clear first choice.`,
          choices: [
            {
              id: "careful-path",
              label: "Choose the careful path.",
              targetNodeId: "ending-success",
              effects: [{ kind: "stat", statId: "resolve", delta: 1 }],
            },
            {
              id: "reckless-path",
              label: "Choose the reckless path.",
              targetNodeId: "ending-death",
              effects: [{ kind: "stat", statId: "vitality", delta: -10 }],
            },
          ],
        },
        "ending-death": {
          id: "ending-death",
          seed: "An external hazard ends the attempt without unsafe self-directed framing.",
          endingId: "ending-death",
          isDeath: true,
          choices: [],
        },
        "ending-success": {
          id: "ending-success",
          seed: "The player reaches a safe success ending.",
          endingId: "ending-success",
          choices: [],
        },
      },
    },
  };
}

export const boneCathedral = starterStub({
  id: "bone-cathedral",
  title: "Bone Cathedral",
  summary: "A gothic expedition through a silent cathedral of relics and vows.",
  tone: "gothic mystery",
  difficulty: "medium",
});

export const ironCourt = starterStub({
  id: "iron-court",
  title: "Iron Court",
  summary: "A court-intrigue tale of favors, masks, and locked-room diplomacy.",
  tone: "political intrigue",
  difficulty: "medium",
});

export const ashfall = starterStub({
  id: "ashfall",
  title: "Ashfall",
  summary: "A hard survival journey across a city buried in warm gray ash.",
  tone: "survival",
  difficulty: "hard",
});
