import { useMemo } from "react";

import type { AdminAccount, AdminDashboardData } from "../components/admin";

const HOUR_MS = 60 * 60 * 1000;

export function useAdminAnalytics(viewer?: AdminAccount | null): {
  account: AdminAccount | null;
  dashboard: AdminDashboardData;
} {
  return useMemo(() => {
    const now = Date.now();
    return {
      account: viewer ?? null,
      dashboard: buildPreviewDashboard(now),
    };
  }, [viewer]);
}

function buildPreviewDashboard(now: number): AdminDashboardData {
  return {
    generatedAt: now,
    window: { from: now - 24 * HOUR_MS, to: now },
    funnel: [
      { eventName: "age_gate.shown", label: "Landing", count: 420, conversionRate: 1 },
      { eventName: "guest.created", label: "Age gate passed", count: 376, conversionRate: 0.9 },
      { eventName: "save.created", label: "First scene", count: 314, conversionRate: 0.84 },
      { eventName: "activation.completed", label: "Activated", count: 182, conversionRate: 0.58 },
      { eventName: "tutorial.completed", label: "Tutorial completed", count: 119, conversionRate: 0.65 },
      { eventName: "signup.completed", label: "Signup", count: 46, conversionRate: 0.39 },
      { eventName: "paywall.shown", label: "Paywall", count: 31, conversionRate: 0.67 },
      { eventName: "billing.subscription_started", label: "Subscribed", count: 12, conversionRate: 0.39 },
      { eventName: "billing.pro_upgraded", label: "Pro upgraded", count: 5, conversionRate: 0.42 },
      { eventName: "tale.published", label: "Published", count: 18, conversionRate: 3.6 },
      { eventName: "coop.room_created", label: "Co-op", count: 22, conversionRate: 1.22 },
    ],
    cost: [
      {
        provider: "anthropic",
        storyId: "training-room",
        sessions: 112,
        turns: 640,
        textTokens: 81200,
        imageGenerations: 0,
        videoGenerations: 0,
        storageMb: 0,
        estimatedCostCents: 1840,
        costPerTurnCents: 2.875,
      },
      {
        provider: "vertex",
        storyId: "bone-cathedral",
        sessions: 38,
        turns: 210,
        textTokens: 24600,
        imageGenerations: 18,
        videoGenerations: 2,
        storageMb: 512,
        estimatedCostCents: 1320,
        costPerTurnCents: 6.28,
      },
      {
        provider: "deepseek",
        storyId: "iron-court",
        sessions: 44,
        turns: 301,
        textTokens: 39200,
        imageGenerations: 0,
        videoGenerations: 0,
        storageMb: 0,
        estimatedCostCents: 220,
        costPerTurnCents: 0.73,
      },
    ],
    safety: [
      {
        eventName: "safety.blocked",
        count: 7,
        rate: 0.012,
        categories: { self_harm: 4, sexual_content: 3 },
        actions: { blocked: 7 },
      },
      {
        eventName: "safety.redirected",
        count: 13,
        rate: 0.022,
        categories: { despair: 9, mature: 4 },
        actions: { redirected: 13 },
      },
      {
        eventName: "safety.ended",
        count: 2,
        rate: 0.003,
        categories: { self_harm: 2 },
        actions: { ended: 2 },
      },
    ],
    live: {
      activeReads: 34,
      activeCoopRooms: 6,
      fallbackRate: 0.041,
      errorRate: 0.009,
      latency: {
        firstTokenP50Ms: 760,
        firstTokenP95Ms: 1420,
        totalP50Ms: 2140,
        totalP95Ms: 4100,
      },
    },
  };
}
