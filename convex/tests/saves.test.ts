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
