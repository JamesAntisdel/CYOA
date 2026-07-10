import { describe, expect, it } from "vitest";

import {
  buildOperatorDashboardForAccount,
  mapAnalyticsDocToRecord,
} from "../operatorDashboardFunctions";

const now = 100;

// A minimal set of raw `analytics_events`-shaped docs, mirroring what Convex
// returns from ctx.db.query (Ids as objects that stringify).
function docs(): Array<Record<string, unknown>> {
  return [
    { eventName: "age_gate.shown", payload: {}, redacted: false, createdAt: 10 },
    { accountId: "a1", eventName: "guest.created", payload: {}, redacted: false, createdAt: 11 },
    {
      accountId: "a1",
      saveId: "s1",
      eventName: "save.created",
      storyId: "training-room",
      payload: {},
      redacted: false,
      createdAt: 12,
    },
    {
      accountId: "a1",
      saveId: "s1",
      eventName: "llm.completed",
      storyId: "training-room",
      provider: "anthropic",
      turnNumber: 4,
      payload: { inputTokens: 20, outputTokens: 80, estimatedCostCents: 12, firstTokenMs: 300, totalMs: 1200 },
      redacted: false,
      createdAt: 17,
    },
    {
      accountId: "a1",
      saveId: "s1",
      eventName: "live_read.heartbeat",
      payload: {},
      redacted: false,
      createdAt: 98,
    },
  ];
}

describe("operator dashboard admin gate", () => {
  it("throws admin_required for a non-admin account", () => {
    expect(() =>
      buildOperatorDashboardForAccount({ account: { _id: "acct" }, docs: docs(), now }),
    ).toThrow("admin_required");
  });

  it("throws admin_required for a null account", () => {
    expect(() =>
      buildOperatorDashboardForAccount({ account: null, docs: [], now }),
    ).toThrow("admin_required");
  });

  it("returns aggregated metrics for an admin account", () => {
    const dashboard = buildOperatorDashboardForAccount({
      account: { _id: "admin", isAdmin: true },
      docs: docs(),
      now,
      windowMs: 100,
    });

    expect(dashboard.funnel.find((m) => m.eventName === "save.created")?.count).toBe(1);
    expect(dashboard.cost[0]).toMatchObject({
      provider: "anthropic",
      storyId: "training-room",
      textTokens: 100,
      estimatedCostCents: 12,
    });
    expect(dashboard.live.activeReads).toBe(1);
    expect(dashboard.window).toEqual({ from: now - 100, to: now });
  });
});

describe("mapAnalyticsDocToRecord", () => {
  it("stringifies ids and drops absent optionals", () => {
    const record = mapAnalyticsDocToRecord({
      accountId: { toString: () => "acct-id" },
      eventName: "guest.created",
      payload: { foo: 1 },
      redacted: false,
      createdAt: 42,
    });

    expect(record).toEqual({
      accountId: "acct-id",
      eventName: "guest.created",
      payload: { foo: 1 },
      redacted: false,
      createdAt: 42,
    });
    // Absent optionals are omitted, not set to undefined.
    expect(record).not.toHaveProperty("saveId");
    expect(record).not.toHaveProperty("storyId");
    expect(record).not.toHaveProperty("provider");
    expect(record).not.toHaveProperty("turnNumber");
  });

  it("preserves provided optional fields and defaults a missing payload", () => {
    const record = mapAnalyticsDocToRecord({
      accountId: "a1",
      saveId: "s1",
      taleId: "t1",
      roomId: "r1",
      eventName: "llm.completed",
      storyId: "training-room",
      turnNumber: 3,
      provider: "vertex",
      redacted: true,
      createdAt: 7,
    });

    expect(record).toEqual({
      accountId: "a1",
      saveId: "s1",
      taleId: "t1",
      roomId: "r1",
      eventName: "llm.completed",
      storyId: "training-room",
      turnNumber: 3,
      provider: "vertex",
      payload: {},
      redacted: true,
      createdAt: 7,
    });
  });
});
