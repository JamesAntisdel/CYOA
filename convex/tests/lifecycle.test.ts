import { describe, expect, it } from "vitest";

import { purgeExpiredGuests, selectPurgeableGuests, type PurgeableAccount } from "../lifecycle";

const now = 1_000_000;

function guest(overrides: Partial<PurgeableAccount> = {}): PurgeableAccount {
  return {
    _id: "guest",
    kind: "guest",
    ageBand: "13-17",
    matureContentEnabled: false,
    createdAt: now - 10_000,
    lastActiveAt: now - 10_000,
    ttlExpiresAt: now - 1, // expired by default
    ...overrides,
  };
}

describe("selectPurgeableGuests", () => {
  it("selects guest sessions whose TTL has passed", () => {
    const expired = guest({ _id: "expired", ttlExpiresAt: now - 1 });
    const boundary = guest({ _id: "boundary", ttlExpiresAt: now }); // <= now → purge

    const result = selectPurgeableGuests([expired, boundary], now);

    expect(result.map((a) => a._id)).toEqual(["expired", "boundary"]);
  });

  it("never purges claimed kind:user accounts even without a TTL", () => {
    // claimGuest clears ttlExpiresAt, but the by_ttlExpiresAt index range
    // still surfaces these rows (absent field sorts lowest). The predicate
    // must filter them back out.
    const claimedNoTtl: PurgeableAccount = {
      _id: "claimed",
      kind: "user",
      userId: "reader@example.com",
      ageBand: "18+",
      matureContentEnabled: false,
      createdAt: now - 100_000,
      lastActiveAt: now,
      // ttlExpiresAt intentionally absent
    };
    // A user row that somehow still carried a stale, passed TTL must also
    // be protected — only guests are ever purged.
    const claimedStaleTtl = { ...claimedNoTtl, _id: "claimed2", ttlExpiresAt: now - 5 };

    expect(selectPurgeableGuests([claimedNoTtl, claimedStaleTtl], now)).toEqual([]);
  });

  it("keeps guests whose TTL is still in the future", () => {
    const fresh = guest({ _id: "fresh", ttlExpiresAt: now + 60_000 });
    expect(selectPurgeableGuests([fresh], now)).toEqual([]);
  });

  it("skips guests with an absent TTL (defensive; should not normally exist)", () => {
    const noTtl = guest({ _id: "no-ttl" });
    delete (noTtl as { ttlExpiresAt?: number }).ttlExpiresAt;
    expect(selectPurgeableGuests([noTtl], now)).toEqual([]);
  });

  it("returns only the expired subset from a mixed batch", () => {
    const batch = [
      guest({ _id: "e1", ttlExpiresAt: now - 100 }),
      guest({ _id: "user", kind: "user", userId: "u" }),
      guest({ _id: "e2", ttlExpiresAt: now - 1 }),
      guest({ _id: "future", ttlExpiresAt: now + 1 }),
    ];
    expect(selectPurgeableGuests(batch, now).map((a) => a._id)).toEqual(["e1", "e2"]);
  });
});

type AnyDoc = Record<string, any>;

// ctx mock with range-query + delete support, enough to drive the purge cascade
// through the shared cascadeAccountData helper (review finding M2).
function makePurgeCtx(seed: Record<string, AnyDoc[]>) {
  const tables = new Map<string, AnyDoc[]>();
  const idToTable = new Map<string, string>();
  for (const [table, rows] of Object.entries(seed)) {
    const copy = rows.map((row) => ({ ...row }));
    tables.set(table, copy);
    for (const row of copy) idToTable.set(String(row._id), table);
  }
  return {
    db: {
      query(table: string) {
        const rows = tables.get(table) ?? [];
        const eqs: Array<[string, unknown]> = [];
        const q = {
          eq(field: string, value: unknown) {
            eqs.push([field, value]);
            return q;
          },
          // Range ops are no-ops here; selectPurgeableGuests re-filters accounts
          // and the eq constraints carry the real per-account scoping.
          gt() {
            return q;
          },
          lte() {
            return q;
          },
        };
        const filtered = () => rows.filter((row) => eqs.every(([f, v]) => row[f] === v));
        const chain = {
          withIndex(_name: string, build?: (qq: any) => any) {
            if (build) build(q);
            return chain;
          },
          async take(n: number) {
            return filtered().slice(0, n);
          },
          async collect() {
            return filtered();
          },
        };
        return chain;
      },
      async delete(id: any) {
        const key = String(id);
        const table = idToTable.get(key);
        if (table) {
          const rows = tables.get(table)!;
          const idx = rows.findIndex((row) => String(row._id) === key);
          if (idx >= 0) rows.splice(idx, 1);
        }
        idToTable.delete(key);
      },
    },
  } as any;
}

describe("purgeExpiredGuests — cascade (M2 parity with deleteAccount)", () => {
  it("sweeps story_bibles, daily_results, and leaderboard_entries for an expired guest", async () => {
    const ctx = makePurgeCtx({
      accounts: [
        {
          _id: "g1",
          kind: "guest",
          ageBand: "18+",
          matureContentEnabled: false,
          createdAt: now - 10_000,
          lastActiveAt: now - 10_000,
          ttlExpiresAt: now - 1,
        },
      ],
      saves: [{ _id: "s1", accountId: "g1" }],
      story_bibles: [{ _id: "b1", saveId: "s1", status: "ready", retryCount: 0 }],
      leaderboard_entries: [{ _id: "lb1", accountId: "g1" }],
      daily_results: [
        { _id: "dr1", accountId: "g1", dailyId: "d" },
        { _id: "dr_other", accountId: "other", dailyId: "d" },
      ],
      entitlements: [{ _id: "e1", accountId: "g1" }],
      published_tales: [{ _id: "pt1", ownerAccountId: "g1" }],
      coop_rooms: [{ _id: "cr1", hostAccountId: "g1" }],
    });

    const summary = await (purgeExpiredGuests as any)._handler(ctx, { now });

    expect(summary.accountsPurged).toBe(1);
    expect(await ctx.db.query("story_bibles").collect()).toEqual([]);
    expect(await ctx.db.query("leaderboard_entries").collect()).toEqual([]);
    const remainingDaily = await ctx.db.query("daily_results").collect();
    expect(remainingDaily.map((r: AnyDoc) => r._id)).toEqual(["dr_other"]);
    // Purge hard-deletes tales/rooms (divergent from deleteAccount).
    expect(await ctx.db.query("published_tales").collect()).toEqual([]);
    expect(await ctx.db.query("coop_rooms").collect()).toEqual([]);
  });
});
