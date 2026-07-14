// Handler + pure-projection tests for convex/dailyTurns.ts (Panel-2 Wave 2
// "candle truth"). Covers the four funnel states the client renders off
// getDailyTurnState — fresh day, partial burn, exhausted candle, and a guest
// caller — plus the tolerance branches (missing rows, malformed turnsUsed,
// stale resetAt) that keep the projection from ever throwing.

import { describe, expect, it } from "vitest";

import {
  buildDailyTurnState,
  getDailyTurnState,
  type DailyTurnStateProjection,
} from "../dailyTurns";
import { freeEntitlement, type EntitlementRecord } from "../billing/entitlements";

type AnyDoc = Record<string, any>;

// Fixed reference instant: 2026-07-12T08:00:00Z -> dayKey "2026-07-12",
// next UTC midnight = 2026-07-13T00:00:00Z.
const NOW = Date.UTC(2026, 6, 12, 8, 0, 0);
const NEXT_MIDNIGHT = Date.UTC(2026, 6, 13, 0, 0, 0);
const TODAY_KEY = "2026-07-12";

function paidEntitlement(tier: "pro" | "unlimited"): EntitlementRecord {
  return {
    accountId: "acct1",
    tier,
    source: "stripe",
    status: "active",
    overageOptIn: false,
    updatedAt: NOW,
  };
}

// -----------------------------------------------------------------------------
// Pure projection
// -----------------------------------------------------------------------------
describe("buildDailyTurnState (pure)", () => {
  it("fresh day: no counter row -> 0 used, full free allowance remaining", () => {
    const state = buildDailyTurnState({
      counter: null,
      entitlement: freeEntitlement("acct1", NOW),
      now: NOW,
    });
    expect(state).toEqual<DailyTurnStateProjection>({
      turnsUsedToday: 0,
      allowance: 10,
      remaining: 10,
      resetsAtUtc: NEXT_MIDNIGHT,
      tier: "free",
    });
  });

  it("partial burn: remaining is allowance minus used, reset from the row", () => {
    const state = buildDailyTurnState({
      counter: { turnsUsed: 4, resetAt: NEXT_MIDNIGHT },
      entitlement: freeEntitlement("acct1", NOW),
      now: NOW,
    });
    expect(state.turnsUsedToday).toBe(4);
    expect(state.allowance).toBe(10);
    expect(state.remaining).toBe(6);
    expect(state.resetsAtUtc).toBe(NEXT_MIDNIGHT);
  });

  it("exhausted candle: used >= allowance clamps remaining to 0 (never negative)", () => {
    const state = buildDailyTurnState({
      counter: { turnsUsed: 12, resetAt: NEXT_MIDNIGHT },
      entitlement: freeEntitlement("acct1", NOW),
      now: NOW,
    });
    expect(state.turnsUsedToday).toBe(12);
    expect(state.remaining).toBe(0);
  });

  it("active paid tier collapses allowance and remaining to unlimited but keeps real used count", () => {
    const state = buildDailyTurnState({
      counter: { turnsUsed: 37, resetAt: NEXT_MIDNIGHT },
      entitlement: paidEntitlement("unlimited"),
      now: NOW,
    });
    expect(state.allowance).toBe("unlimited");
    expect(state.remaining).toBe("unlimited");
    expect(state.turnsUsedToday).toBe(37);
    expect(state.tier).toBe("unlimited");
  });

  it("pro tier is also unlimited daily turns", () => {
    const state = buildDailyTurnState({
      counter: null,
      entitlement: paidEntitlement("pro"),
      now: NOW,
    });
    expect(state.allowance).toBe("unlimited");
    expect(state.tier).toBe("pro");
  });

  it("grace/expired paid tier falls to the free floor (fails closed)", () => {
    const lapsed: EntitlementRecord = { ...paidEntitlement("pro"), status: "grace" };
    const state = buildDailyTurnState({ counter: null, entitlement: lapsed, now: NOW });
    // includedTurnsPerDay is undefined for a paid record -> floors to 10.
    expect(state.allowance).toBe(10);
    expect(state.remaining).toBe(10);
  });

  it("tolerates a malformed turnsUsed (negative / fractional / NaN) by clamping to a whole >= 0", () => {
    const base = { entitlement: freeEntitlement("acct1", NOW), now: NOW };
    expect(buildDailyTurnState({ counter: { turnsUsed: -3 }, ...base }).turnsUsedToday).toBe(0);
    expect(buildDailyTurnState({ counter: { turnsUsed: 2.9 }, ...base }).turnsUsedToday).toBe(2);
    expect(buildDailyTurnState({ counter: { turnsUsed: NaN }, ...base }).turnsUsedToday).toBe(0);
  });

  it("recomputes resetsAtUtc when the stored resetAt is absent or already past", () => {
    const base = { entitlement: freeEntitlement("acct1", NOW), now: NOW };
    // absent resetAt
    expect(buildDailyTurnState({ counter: { turnsUsed: 1 }, ...base }).resetsAtUtc).toBe(
      NEXT_MIDNIGHT,
    );
    // stale resetAt (yesterday) -> recompute
    expect(
      buildDailyTurnState({ counter: { turnsUsed: 1, resetAt: NOW - 1 }, ...base }).resetsAtUtc,
    ).toBe(NEXT_MIDNIGHT);
  });
});

// -----------------------------------------------------------------------------
// Query handler (auth + row loading)
// -----------------------------------------------------------------------------
type Seed = {
  accounts?: AnyDoc[];
  daily_turn_counter?: AnyDoc[];
  entitlements?: AnyDoc[];
  identity?: { subject?: string } | null;
};

function makeCtx(seed: Seed) {
  const tables: Record<string, AnyDoc[]> = {
    accounts: seed.accounts ?? [],
    daily_turn_counter: seed.daily_turn_counter ?? [],
    entitlements: seed.entitlements ?? [],
  };
  const byId = new Map<string, AnyDoc>();
  for (const rows of Object.values(tables)) {
    for (const row of rows) byId.set(String(row._id), row);
  }
  return {
    auth: { getUserIdentity: async () => seed.identity ?? null },
    db: {
      async get(id: any) {
        return byId.get(String(id)) ?? null;
      },
      query(table: string) {
        const rows = tables[table] ?? [];
        const constraints: Array<[string, unknown]> = [];
        const q = {
          eq(field: string, value: unknown) {
            constraints.push([field, value]);
            return q;
          },
        };
        const chain = {
          withIndex(_name: string, build?: (qq: any) => any) {
            if (build) build(q);
            return chain;
          },
          async first() {
            return (
              rows.find((row) => constraints.every(([f, val]) => row[f] === val)) ?? null
            );
          },
        };
        return chain;
      },
    },
  };
}

const invoke = (ctx: any, args: any) => (getDailyTurnState as any)._handler(ctx, args);

// The handler reads the wall clock (Date.now), so counter rows must be seeded
// under the REAL current UTC day key to match its by_account_day lookup.
const CURRENT_DAY = new Date().toISOString().slice(0, 10);
const OTHER_DAY = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const guestAccount = {
  _id: "acct1",
  kind: "guest" as const,
  guestTokenHash: "hash-abc",
};

describe("getDailyTurnState (handler)", () => {
  it("fresh reader (no counter, no entitlement) -> full free candle", async () => {
    const ctx = makeCtx({ accounts: [guestAccount] });
    const state = await invoke(ctx, { accountId: "acct1", guestTokenHash: "hash-abc" });
    expect(state.turnsUsedToday).toBe(0);
    expect(state.allowance).toBe(10);
    expect(state.remaining).toBe(10);
    expect(state.tier).toBe("free");
    expect(typeof state.resetsAtUtc).toBe("number");
  });

  it("partial: reads today's counter row via by_account_day", async () => {
    const ctx = makeCtx({
      accounts: [guestAccount],
      daily_turn_counter: [
        { _id: "dtc1", accountId: "acct1", dayKey: CURRENT_DAY, turnsUsed: 3, resetAt: 1 },
        // a stale row for another day must NOT be matched
        { _id: "dtc0", accountId: "acct1", dayKey: OTHER_DAY, turnsUsed: 9 },
      ],
    });
    const state = await invoke(ctx, { accountId: "acct1", guestTokenHash: "hash-abc" });
    expect(state.turnsUsedToday).toBe(3);
    expect(state.remaining).toBe(7);
  });

  it("exhausted: used == allowance -> remaining 0", async () => {
    const ctx = makeCtx({
      accounts: [guestAccount],
      daily_turn_counter: [
        { _id: "dtc1", accountId: "acct1", dayKey: CURRENT_DAY, turnsUsed: 10 },
      ],
    });
    const state = await invoke(ctx, { accountId: "acct1", guestTokenHash: "hash-abc" });
    expect(state.turnsUsedToday).toBe(10);
    expect(state.remaining).toBe(0);
  });

  it("guest auth: matching guest token is authorized", async () => {
    const ctx = makeCtx({ accounts: [guestAccount] });
    await expect(
      invoke(ctx, { accountId: "acct1", guestTokenHash: "hash-abc" }),
    ).resolves.toMatchObject({ tier: "free" });
  });

  it("guest auth: wrong / missing guest token is rejected", async () => {
    const ctx = makeCtx({ accounts: [guestAccount] });
    await expect(
      invoke(ctx, { accountId: "acct1", guestTokenHash: "wrong" }),
    ).rejects.toThrow();
    await expect(invoke(ctx, { accountId: "acct1" })).rejects.toThrow();
  });

  it("unknown account rejects with account_not_found", async () => {
    const ctx = makeCtx({ accounts: [] });
    await expect(
      invoke(ctx, { accountId: "ghost", guestTokenHash: "x" }),
    ).rejects.toThrow(/account_not_found/);
  });

  it("paid entitlement row projects unlimited", async () => {
    const ctx = makeCtx({
      accounts: [guestAccount],
      entitlements: [
        {
          _id: "ent1",
          accountId: "acct1",
          tier: "pro",
          source: "stripe",
          status: "active",
          overageOptIn: false,
          updatedAt: NOW,
        },
      ],
      daily_turn_counter: [
        { _id: "dtc1", accountId: "acct1", dayKey: CURRENT_DAY, turnsUsed: 42 },
      ],
    });
    const state = await invoke(ctx, { accountId: "acct1", guestTokenHash: "hash-abc" });
    expect(state.allowance).toBe("unlimited");
    expect(state.remaining).toBe("unlimited");
    expect(state.turnsUsedToday).toBe(42);
    expect(state.tier).toBe("pro");
  });
});
