import { describe, expect, it } from "vitest";

import { selectPurgeableGuests, type PurgeableAccount } from "../lifecycle";

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
