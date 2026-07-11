import type { NpcState } from "@cyoa/engine";

import type { StarterStory } from "./metadata";

/**
 * Compact helper for a starter NPC (story-engagement W2 / R8.2). Every starter
 * declares a small cast so relationships (disposition, facts) have somewhere to
 * land from turn 1 and the reader's roster is never empty. `location: "start"`
 * puts the NPC in scope for the OPENING scene (currentNodeId is the start node
 * until the first choice); after that the LLM keeps them in scope via
 * `npcMentions`. Dispositions sit near ±20 so a companion reads warm and a
 * rival/antagonist reads wary without being pinned to an extreme.
 */
function starterNpc(args: {
  id: string;
  name: string;
  role: NpcState["role"];
  disposition: number;
  description: string;
}): NpcState {
  return {
    id: args.id,
    name: args.name,
    role: args.role,
    description: args.description,
    disposition: args.disposition,
    location: "start",
    attributes: {},
    knownFacts: [],
    flags: {},
  };
}

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
  /**
   * Starting currency (story-engagement W2 / R10.1). Non-zero so scarcity has
   * teeth from turn 1 — the prompt frames prices against this pool. Defaults to
   * 0 for stubs that don't opt in.
   */
  currency?: number;
  /**
   * Starting NPC cast (R8.2): 1 companion-role + 1 rival/antagonist-role each.
   * Merged into `PlayerState.npcs` by the engine's `createInitialState`; the
   * creator seed-flow splices its own NPCs on top (game.ts) without clobbering
   * these.
   */
  initialNpcs?: Record<string, NpcState>;
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
        currency: args.currency ?? 0,
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
      ...(args.initialNpcs ? { initialNpcs: args.initialNpcs } : {}),
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
  currency: 15,
  initialNpcs: {
    "sister-vell": starterNpc({
      id: "sister-vell",
      name: "Sister Vell",
      role: "companion",
      disposition: 20,
      description:
        "A pale bone-keeper acolyte in ash-grey habit, one eye milk-blind, who tends the cold candles and seems to have been waiting for you.",
    }),
    "the-verger": starterNpc({
      id: "the-verger",
      name: "The Verger",
      role: "antagonist",
      disposition: -20,
      description:
        "The cathedral's hooded warden, keeper of the humming iron door, who counts trespasses the way the high bell counts the hours.",
    }),
  },
});

export const ironCourt = llmDrivenStub({
  id: "iron-court",
  title: "Iron Court",
  summary: "A court-intrigue tale of favors, masks, and locked-room diplomacy.",
  tone: "political intrigue",
  difficulty: "medium",
  premise:
    "Tonight the Iron Court convenes behind sealed doors, and the queen has named you petitioner-of-record. The masks are already on; the ledgers are already burning in tasteful, decorative braziers. You hold three favors and one secret. Everyone you bow to is measuring what to take from you first.",
  currency: 40,
  initialNpcs: {
    corvin: starterNpc({
      id: "corvin",
      name: "Corvin",
      role: "companion",
      disposition: 20,
      description:
        "Your assigned court page — quick, ink-stained, and quietly loyal — who knows which braziers hide which ledgers and which smiles hide knives.",
    }),
    "lady-ferrant": starterNpc({
      id: "lady-ferrant",
      name: "Lady Ferrant",
      role: "rival",
      disposition: -20,
      description:
        "A rival petitioner in an iron half-mask, all velvet courtesy, who wants your favors spent on her ledger and your secret spent on your ruin.",
    }),
  },
});

export const ashfall = llmDrivenStub({
  id: "ashfall",
  title: "Ashfall",
  summary: "A hard survival journey across a city buried in warm gray ash.",
  tone: "survival",
  difficulty: "hard",
  premise:
    "Three days ago the mountain woke and the city stopped breathing. Now the streets are knee-deep in warm gray ash and the sun is a copper coin behind soot. You have a damp cloth tied across your face, a half-bottle of water, and a map that no longer matches the skyline. The road out is across town. The road out may not exist.",
  currency: 10,
  initialNpcs: {
    juno: starterNpc({
      id: "juno",
      name: "Juno",
      role: "companion",
      disposition: 20,
      description:
        "A wiry scavenger with a rebreather and a scrounger's map, who shared her water once already and hasn't decided yet whether that was a mistake.",
    }),
    marek: starterNpc({
      id: "marek",
      name: "Marek",
      role: "rival",
      disposition: -20,
      description:
        "A broad, ash-caked survivor who has claimed the last working fuel pumps as his own and charges in water, favors, or blood for passage.",
    }),
  },
});
