import { describe, expect, it } from "vitest";

import type { Story } from "@cyoa/engine";
import {
  applySaveState,
  assertCanAccessSave,
  buildSaveMigrationPlan,
  buildTrophyCrypt,
  buildVisitedPathMap,
  createSaveRecord,
  endingRecordFromUnlock,
  projectCurrentScene,
} from "../index";
import { projectAuthoredSceneFromRecord } from "../game";
import { projectLlmDrivenScene } from "../saves";

const story: Story = {
  id: "training-room",
  version: 1,
  title: "Training Room",
  startNodeId: "start",
  deathNodeId: "death",
  initialState: {
    vitality: 5,
    currency: 0,
    attributes: {
      focus: { id: "focus", label: "Focus", value: 2, visibility: "visible" },
      secret: { id: "secret", label: "Secret", value: 1, visibility: "hidden" },
    },
    inventory: [],
    flags: {},
  },
  endings: {
    win: { id: "win", label: "Win", kind: "success" },
    death: { id: "death", label: "Death", kind: "death" },
  },
  nodes: {
    start: {
      id: "start",
      seed: "Start prose.",
      choices: [
        { id: "go", label: "Go", targetNodeId: "win" },
        {
          id: "locked",
          label: "Locked",
          targetNodeId: "win",
          conditions: [{ kind: "has_item", itemId: "key" }],
        },
        { id: "hidden", label: "Hidden", targetNodeId: "win", visibility: "hidden" },
      ],
    },
    win: { id: "win", endingId: "win", choices: [] },
    death: { id: "death", endingId: "death", isDeath: true, choices: [] },
  },
};

describe("save domain", () => {
  it("creates save records from starter stories", () => {
    const save = createSaveRecord({ accountId: "acct", story, mode: "story", now: 1, rngSeed: "r" });

    expect(save).toMatchObject({
      accountId: "acct",
      storyId: "training-room",
      currentNodeId: "start",
      turnNumber: 0,
      status: "active",
    });
  });

  it("projects current scene without hidden choices or hidden stats", () => {
    const save = { ...createSaveRecord({ accountId: "acct", story, mode: "story", now: 1, rngSeed: "r" }), _id: "save" };

    const projection = projectCurrentScene(save, story);

    expect(projection.choices.map((choice) => choice.choice.id)).toEqual(["go", "locked"]);
    expect(projection.visibleStats).toEqual([{ statId: "focus", label: "Focus", value: 2 }]);
    expect(projection.prose).toBe("Start prose.");
  });

  it("authored scene projection prefers LLM-elaborated prose from the scene record", async () => {
    const save = {
      ...createSaveRecord({ accountId: "acct", story, mode: "story", now: 1, rngSeed: "r" }),
      _id: "save",
      currentSceneId: "scene_1",
    };
    const elaborated =
      "The lantern's glow pulls forward, catching dust motes between two locked alcoves and a low chalked sigil.";
    const ctx = {
      db: {
        get: async (id: string) => {
          if (id === "scene_1") {
            return { _id: "scene_1", prose: elaborated, streamStatus: "complete" };
          }
          return null;
        },
      },
    };

    const projection = await projectAuthoredSceneFromRecord(ctx, save, story);

    expect(projection.prose).toBe(elaborated);
    expect(projection.streamStatus).toBe("complete");
  });

  it("authored scene projection falls back to seed prose when scene record is empty", async () => {
    const save = {
      ...createSaveRecord({ accountId: "acct", story, mode: "story", now: 1, rngSeed: "r" }),
      _id: "save",
      currentSceneId: "scene_1",
    };
    const ctx = {
      db: {
        get: async (id: string) => {
          if (id === "scene_1") {
            return { _id: "scene_1", prose: "", streamStatus: "pending" };
          }
          return null;
        },
      },
    };

    const projection = await projectAuthoredSceneFromRecord(ctx, save, story);

    expect(projection.prose).toBe("Start prose.");
    expect(projection.streamStatus).toBe("pending");
  });

  it("authored scene projection surfaces isFallback when the scene record carries the sentinel", async () => {
    // Bug fix guard: the deterministic-fallback marker must travel from
    // the scene record onto the projection so the reader UI can render
    // the FallbackTurnPanel. Authored-mode branch of
    // `projectAuthoredSceneFromRecord`.
    const save = {
      ...createSaveRecord({ accountId: "acct", story, mode: "story", now: 1, rngSeed: "r" }),
      _id: "save",
      currentSceneId: "scene_1",
    };
    const ctx = {
      db: {
        get: async (id: string) => {
          if (id === "scene_1") {
            return {
              _id: "scene_1",
              prose: "Deterministic placeholder prose.",
              streamStatus: "complete",
              isFallback: true,
            };
          }
          return null;
        },
      },
    };

    const projection = await projectAuthoredSceneFromRecord(ctx, save, story);

    expect(projection.isFallback).toBe(true);
  });

  it("projectLlmDrivenScene surfaces isFallback when input.isFallback === true", () => {
    // The llm-driven branch carries the sentinel through a different
    // helper than the authored branch; pin its behaviour here so a future
    // refactor doesn't silently drop the field for one mode.
    const save = {
      ...createSaveRecord({ accountId: "acct", story, mode: "story", now: 1, rngSeed: "r" }),
      _id: "save",
    };
    const fallback = projectLlmDrivenScene({
      save,
      proposal: null,
      prose: "Deterministic placeholder.",
      streamStatus: "complete",
      isFallback: true,
    });
    const real = projectLlmDrivenScene({
      save,
      proposal: null,
      prose: "Real provider prose.",
      streamStatus: "complete",
    });
    expect(fallback.isFallback).toBe(true);
    expect(real.isFallback).toBeUndefined();
  });

  it("authored scene projection omits isFallback when the scene record is from a real provider", async () => {
    // Counterpart of the above: a real-provider scene record must NOT
    // surface the sentinel, or every reader's turn would render the
    // FallbackTurnPanel.
    const save = {
      ...createSaveRecord({ accountId: "acct", story, mode: "story", now: 1, rngSeed: "r" }),
      _id: "save",
      currentSceneId: "scene_1",
    };
    const ctx = {
      db: {
        get: async (id: string) => {
          if (id === "scene_1") {
            return {
              _id: "scene_1",
              prose: "Real provider prose.",
              streamStatus: "complete",
              isFallback: false,
            };
          }
          return null;
        },
      },
    };

    const projection = await projectAuthoredSceneFromRecord(ctx, save, story);

    expect(projection.isFallback).toBeUndefined();
  });

  it("authored scene projection skips DB read when currentSceneId is absent", async () => {
    const save = createSaveRecord({ accountId: "acct", story, mode: "story", now: 1, rngSeed: "r" });
    let dbCalls = 0;
    const ctx = {
      db: {
        get: async () => {
          dbCalls += 1;
          return null;
        },
      },
    };

    const projection = await projectAuthoredSceneFromRecord(ctx, save, story);

    expect(dbCalls).toBe(0);
    expect(projection.prose).toBe("Start prose.");
  });

  it("applies migrated save state and access guards", () => {
    const save = createSaveRecord({ accountId: "acct", story, mode: "story", now: 1, rngSeed: "r" });
    const next = applySaveState(save, { ...save.state, vitality: 0 }, 2);

    expect(next.status).toBe("dead");
    expect(() => assertCanAccessSave("other", save)).toThrow("save_forbidden");
    expect(() => assertCanAccessSave("acct", save)).not.toThrow();
  });

  it("builds migration logs for old engine state", () => {
    const save = {
      ...createSaveRecord({ accountId: "acct", story, mode: "story", now: 1, rngSeed: "r" }),
      _id: "save",
    };
    const plan = buildSaveMigrationPlan(
      { ...save, engineVersion: 0, state: { ...save.state, schemaVersion: 0 } },
      3,
    );

    expect(plan.migrated).toBe(true);
    expect(plan.log).toMatchObject({ saveId: "save", fromEngineVersion: 0, status: "applied" });
  });
});

describe("ending projections", () => {
  it("builds trophy crypt and visited path projections", () => {
    const record = endingRecordFromUnlock("acct", {
      storyId: "story",
      endingId: "win",
      firstSeenTurn: 4,
      mode: "story",
      path: ["start", "win"],
    });

    expect(buildTrophyCrypt(["win", "death"], [record])).toEqual([
      { endingId: "win", unlocked: true, firstSeen: 4, mode: "story" },
      { endingId: "death", unlocked: false },
    ]);
    expect(buildVisitedPathMap([record])).toEqual(["start", "win"]);
  });
});
