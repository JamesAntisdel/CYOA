import { describe, expect, it } from "vitest";

import type { Story } from "@cyoa/engine";
import { createSaveRecord, LlmRouter, submitTurn } from "../index";

const story: Story = {
  id: "story",
  version: 1,
  title: "Story",
  startNodeId: "start",
  deathNodeId: "death",
  initialState: { vitality: 3, currency: 0 },
  endings: {
    death: { id: "death", label: "Death", kind: "death" },
    win: { id: "win", label: "Win", kind: "success" },
  },
  nodes: {
    start: {
      id: "start",
      seed: "Start.",
      choices: [
        { id: "safe", label: "Safe", targetNodeId: "middle" },
        {
          id: "bad",
          label: "Bad",
          targetNodeId: "death",
          effects: [{ kind: "stat", statId: "vitality", delta: -5 }],
        },
      ],
    },
    middle: {
      id: "middle",
      seed: "Middle.",
      choices: [{ id: "win", label: "Win", targetNodeId: "win" }],
    },
    death: { id: "death", endingId: "death", isDeath: true, choices: [] },
    win: { id: "win", endingId: "win", choices: [] },
  },
};

describe("turn orchestrator", () => {
  it("submits a non-terminal turn through engine and router", async () => {
    const save = { ...createSaveRecord({ accountId: "acct", story, mode: "story", now: 1, rngSeed: "r" }), _id: "save" };
    const result = await submitTurn({
      save,
      story,
      choiceId: "safe",
      requestId: "request-1",
      accountId: "acct",
      now: 2,
      dailyCounter: null,
      dailyAllowance: 3,
      dayKey: "2026-04-26",
      resetAt: 10,
      router: new LlmRouter(),
    });

    expect(result.save.currentNodeId).toBe("middle");
    expect(result.dailyCounter.turnsUsed).toBe(1);
    expect(result.prose.length).toBeGreaterThan(0);
    expect(result.history.engineEvents.map((event) => event.kind)).toContain("choice_applied");
  });

  it("does not call LLM for death branches", async () => {
    const save = { ...createSaveRecord({ accountId: "acct", story, mode: "story", now: 1, rngSeed: "r" }), _id: "save" };
    const result = await submitTurn({
      save,
      story,
      choiceId: "bad",
      requestId: "request-2",
      accountId: "acct",
      now: 2,
      dailyCounter: null,
      dailyAllowance: 3,
      dayKey: "2026-04-26",
      resetAt: 10,
    });

    expect(result.save.status).toBe("dead");
    expect(result.prose).toBe("");
    expect(result.provider).toBe("deterministic");
  });

  it("rejects duplicate in-progress and exhausted daily turns", async () => {
    const save = {
      ...createSaveRecord({ accountId: "acct", story, mode: "story", now: 1, rngSeed: "r" }),
      activeTurnRequestId: "other-request",
    };
    await expect(
      submitTurn({
        save,
        story,
        choiceId: "safe",
        requestId: "request-3",
        accountId: "acct",
        now: 2,
        dailyCounter: null,
        dailyAllowance: 3,
        dayKey: "2026-04-26",
        resetAt: 10,
      }),
    ).rejects.toThrow("turn_in_progress");

    await expect(
      submitTurn({
        save: createSaveRecord({ accountId: "acct", story, mode: "story", now: 1, rngSeed: "r" }),
        story,
        choiceId: "safe",
        requestId: "request-4",
        accountId: "acct",
        now: 2,
        dailyCounter: { accountId: "acct", dayKey: "2026-04-26", turnsUsed: 1, resetAt: 10, updatedAt: 1 },
        dailyAllowance: 1,
        dayKey: "2026-04-26",
        resetAt: 10,
      }),
    ).rejects.toThrow("daily_turns_exhausted");
  });
});
