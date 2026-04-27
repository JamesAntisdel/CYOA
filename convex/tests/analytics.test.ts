import { describe, expect, it } from "vitest";

import {
  buildAnalyticsEvent,
  buildOperatorDashboard,
  requireAdminDashboard,
  sanitizePayload,
} from "../index";

describe("analytics", () => {
  it("redacts unsafe, mature, email, OAuth, payment, and invite fields", () => {
    const event = buildAnalyticsEvent({
      accountId: "acct",
      saveId: "save",
      eventName: "safety.blocked",
      payload: {
        category: "self_harm",
        unsafeText: "blocked unsafe prose",
        matureText: "blocked mature prose",
        email: "reader@example.com",
        oauthProfile: { displayName: "Reader" },
        rawPaymentData: { card: "4242" },
        inviteUrl: "https://example.test/room/private-token",
        nested: { prompt: "raw prompt text" },
      },
      redacted: false,
      createdAt: 10,
    });

    expect(event.redacted).toBe(true);
    expect(event.payload.unsafeText).toBe("[redacted]");
    expect(event.payload.matureText).toBe("[redacted]");
    expect(event.payload.email).toBe("[redacted]");
    expect(event.payload.oauthProfile).toBe("[redacted]");
    expect(event.payload.rawPaymentData).toBe("[redacted]");
    expect(event.payload.inviteUrl).toBe("[redacted]");
    expect(event.payload.nested).toEqual({ prompt: "[redacted]" });
  });

  it("rejects non-admin dashboard access", () => {
    expect(() => requireAdminDashboard({ _id: "acct" })).toThrow("admin_required");
    expect(() => buildOperatorDashboard({ account: null, events: [], now: 100 })).toThrow("admin_required");
  });

  it("aggregates funnel, cost, safety, live, fallback, latency, and errors", () => {
    const events = [
      buildAnalyticsEvent({ eventName: "age_gate.shown", createdAt: 10 }),
      buildAnalyticsEvent({ accountId: "a1", eventName: "guest.created", createdAt: 11 }),
      buildAnalyticsEvent({ accountId: "a1", saveId: "s1", eventName: "save.created", storyId: "training-room", createdAt: 12 }),
      buildAnalyticsEvent({ accountId: "a1", saveId: "s1", eventName: "activation.completed", storyId: "training-room", createdAt: 13 }),
      buildAnalyticsEvent({ accountId: "a1", eventName: "signup.completed", createdAt: 14 }),
      buildAnalyticsEvent({ accountId: "a1", eventName: "billing.subscription_started", createdAt: 15 }),
      buildAnalyticsEvent({ accountId: "a1", eventName: "billing.pro_upgraded", createdAt: 16 }),
      buildAnalyticsEvent({
        accountId: "a1",
        saveId: "s1",
        eventName: "llm.completed",
        storyId: "training-room",
        provider: "anthropic",
        turnNumber: 4,
        payload: { inputTokens: 20, outputTokens: 80, estimatedCostCents: 12, firstTokenMs: 300, totalMs: 1200 },
        createdAt: 17,
      }),
      buildAnalyticsEvent({
        accountId: "a1",
        saveId: "s1",
        eventName: "provider.fallback",
        storyId: "training-room",
        provider: "vertex",
        payload: { fallback: true, firstTokenMs: 700, totalMs: 1800 },
        createdAt: 18,
      }),
      buildAnalyticsEvent({
        accountId: "a1",
        saveId: "s1",
        eventName: "safety.redirected",
        payload: { category: "despair", action: "redirected" },
        createdAt: 19,
      }),
      buildAnalyticsEvent({ accountId: "a1", saveId: "s1", eventName: "live_read.heartbeat", createdAt: 98 }),
      buildAnalyticsEvent({ accountId: "a1", roomId: "r1", eventName: "coop.joined", createdAt: 99 }),
      buildAnalyticsEvent({ accountId: "a1", eventName: "error.recorded", payload: { code: "parser" }, createdAt: 100 }),
    ];

    const dashboard = buildOperatorDashboard({
      account: { _id: "admin", isAdmin: true },
      events,
      now: 100,
      windowMs: 100,
    });

    expect(dashboard.funnel.find((metric) => metric.eventName === "activation.completed")?.count).toBe(1);
    expect(dashboard.cost[0]).toMatchObject({
      provider: "anthropic",
      storyId: "training-room",
      textTokens: 100,
      estimatedCostCents: 12,
    });
    expect(dashboard.safety.find((metric) => metric.eventName === "safety.redirected")?.categories).toEqual({ despair: 1 });
    expect(dashboard.live.activeReads).toBe(1);
    expect(dashboard.live.activeCoopRooms).toBe(1);
    expect(dashboard.live.fallbackRate).toBeGreaterThan(0);
    expect(dashboard.live.errorRate).toBeGreaterThan(0);
    expect(dashboard.live.latency.firstTokenP95Ms).toBe(700);
  });

  it("reports whether a payload was redacted without mutating safe metadata", () => {
    const result = sanitizePayload({ provider: "deepseek", outputTokens: 25 });

    expect(result.redacted).toBe(false);
    expect(result.payload).toEqual({ provider: "deepseek", outputTokens: 25 });
  });
});
