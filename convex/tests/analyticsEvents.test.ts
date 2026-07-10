import { describe, expect, it } from "vitest";

import {
  buildSafetyAnalyticsEvent,
  buildTurnCompletedEvent,
  safetyEventNameForAction,
} from "../analyticsEvents";
import { buildOperatorDashboard } from "../analytics";
import { endingRecordFromUnlock } from "../endings";

describe("analyticsEvents — turn-completion row", () => {
  it("carries provider, tokens, latency, and the fallback flag in the read-side shape", () => {
    const event = buildTurnCompletedEvent({
      accountId: "acct_1",
      saveId: "save_1",
      storyId: "training-room",
      turnNumber: 4,
      provider: "anthropic",
      inputTokens: 20,
      outputTokens: 80,
      engineMs: 3,
      llmMs: 1200,
      firstTokenMs: 300,
      totalMs: 1200,
      fallback: false,
      createdAt: 17,
    });

    expect(event.eventName).toBe("llm.completed");
    expect(event.provider).toBe("anthropic");
    expect(event.storyId).toBe("training-room");
    expect(event.turnNumber).toBe(4);
    expect(event.accountId).toBe("acct_1");
    expect(event.saveId).toBe("save_1");
    expect(event.redacted).toBe(false);
    expect(event.payload).toMatchObject({
      provider: "anthropic",
      inputTokens: 20,
      outputTokens: 80,
      firstTokenMs: 300,
      totalMs: 1200,
      fallback: false,
    });
  });

  it("omits absent latency stages", () => {
    const event = buildTurnCompletedEvent({
      accountId: "a",
      saveId: "s",
      storyId: "open-canvas",
      turnNumber: 1,
      provider: "deterministic",
      inputTokens: 0,
      outputTokens: 0,
      fallback: true,
      createdAt: 5,
    });
    expect(event.payload.fallback).toBe(true);
    expect(event.payload).not.toHaveProperty("firstTokenMs");
    expect(event.payload).not.toHaveProperty("llmMs");
  });
});

describe("analyticsEvents — safety row", () => {
  it("maps content-policy actions to the redacted safety event names", () => {
    expect(safetyEventNameForAction("block")).toBe("safety.blocked");
    expect(safetyEventNameForAction("rewrite")).toBe("safety.blocked");
    expect(safetyEventNameForAction("safe_end")).toBe("safety.ended");
    expect(safetyEventNameForAction("safe_redirect")).toBe("safety.redirected");
    expect(safetyEventNameForAction("allow")).toBeNull();
  });

  it("stores only category + action metadata and is flagged redacted", () => {
    const event = buildSafetyAnalyticsEvent({
      eventName: "safety.ended",
      action: "safe_end",
      categories: ["despair", "isolation"],
      accountId: "acct_1",
      saveId: "save_1",
      storyId: "training-room",
      turnNumber: 6,
      provider: "vertex",
      latencyMs: 42,
      createdAt: 19,
    });

    expect(event.eventName).toBe("safety.ended");
    expect(event.redacted).toBe(true);
    expect(event.payload).toMatchObject({
      action: "safe_end",
      category: "despair",
      categories: ["despair", "isolation"],
      latencyMs: 42,
    });
    // Never carries prose / unsafe text.
    expect(event.payload).not.toHaveProperty("prose");
  });
});

describe("analyticsEvents — feeds the operator dashboard read side", () => {
  it("aggregates written rows into cost, fallback, and safety metrics", () => {
    const events = [
      buildTurnCompletedEvent({
        accountId: "a1",
        saveId: "s1",
        storyId: "training-room",
        turnNumber: 4,
        provider: "anthropic",
        inputTokens: 20,
        outputTokens: 80,
        llmMs: 1200,
        totalMs: 1200,
        fallback: false,
        createdAt: 17,
      }),
      buildTurnCompletedEvent({
        accountId: "a1",
        saveId: "s1",
        storyId: "training-room",
        turnNumber: 5,
        provider: "deterministic",
        inputTokens: 0,
        outputTokens: 0,
        fallback: true,
        createdAt: 18,
      }),
      buildSafetyAnalyticsEvent({
        eventName: "safety.redirected",
        action: "safe_redirect",
        categories: ["despair"],
        accountId: "a1",
        saveId: "s1",
        createdAt: 19,
      }),
    ];

    const dashboard = buildOperatorDashboard({
      account: { _id: "admin", isAdmin: true },
      events,
      now: 100,
      windowMs: 100,
    });

    expect(dashboard.cost[0]).toMatchObject({
      provider: "anthropic",
      storyId: "training-room",
      textTokens: 100,
    });
    expect(dashboard.live.fallbackRate).toBeGreaterThan(0);
    expect(
      dashboard.safety.find((metric) => metric.eventName === "safety.redirected")?.categories,
    ).toEqual({ despair: 1 });
  });
});

describe("endings — endingRecordFromUnlock safetyEnding flag", () => {
  const unlock = {
    storyId: "training-room",
    endingId: "ending-safe",
    firstSeenTurn: 6,
    mode: "story" as const,
    path: ["start", "hall", "ending-safe"],
  };

  it("records firstSeen / mode / path from the engine unlock (Req 19.1)", () => {
    const record = endingRecordFromUnlock("acct_1", unlock);
    expect(record).toEqual({
      accountId: "acct_1",
      storyId: "training-room",
      endingId: "ending-safe",
      firstSeen: 6,
      mode: "story",
      path: ["start", "hall", "ending-safe"],
    });
    expect(record).not.toHaveProperty("safetyEnding");
  });

  it("sets safetyEnding only when the safe exit was safety-forced (Req 11.4)", () => {
    const record = endingRecordFromUnlock("acct_1", unlock, { safetyEnding: true });
    expect(record.safetyEnding).toBe(true);
    // false / absent option must not stamp the field.
    expect(endingRecordFromUnlock("acct_1", unlock, { safetyEnding: false })).not.toHaveProperty(
      "safetyEnding",
    );
  });
});
