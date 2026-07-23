// Handler-level tests for the account-erasure + export seams in
// convex/accountFunctions.ts, focused on review finding M2: the deletion
// cascade must sweep story_bibles, daily_results, and leaderboard_entries (the
// tables it had been dropping), and the export bundle must carry story_bibles
// (non-spoiler metadata only). Built on a hand-rolled ctx mock with delete
// support (the creatorFunctions mock is patch-only).

import { describe, expect, it } from "vitest";

import { claimGuest, deleteAccount, exportAccount, getProfile } from "../accountFunctions";

type AnyDoc = Record<string, any>;

function makeCtx(seed: Record<string, AnyDoc[]>) {
  const tables = new Map<string, AnyDoc[]>();
  const idToTable = new Map<string, string>();
  const byId = new Map<string, AnyDoc>();
  for (const [table, rows] of Object.entries(seed)) {
    const copy = rows.map((row) => ({ ...row }));
    tables.set(table, copy);
    for (const row of copy) {
      byId.set(String(row._id), row);
      idToTable.set(String(row._id), table);
    }
  }

  const ctx = {
    auth: { getUserIdentity: async () => null },
    db: {
      async get(id: any) {
        return byId.get(String(id)) ?? null;
      },
      query(table: string) {
        const rows = tables.get(table) ?? [];
        const constraints: Array<[string, unknown]> = [];
        const q = {
          eq(field: string, value: unknown) {
            constraints.push([field, value]);
            return q;
          },
        };
        const filtered = () =>
          rows.filter((row) => constraints.every(([field, value]) => row[field] === value));
        const chain = {
          withIndex(_name: string, build?: (qq: any) => any) {
            if (build) build(q);
            return chain;
          },
          async first() {
            return filtered()[0] ?? null;
          },
          async collect() {
            return filtered();
          },
        };
        return chain;
      },
      async patch(id: any, patch: any) {
        const existing = byId.get(String(id));
        if (!existing) return;
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) delete existing[key];
          else existing[key] = value;
        }
      },
      async delete(id: any) {
        const key = String(id);
        const table = idToTable.get(key);
        if (table) {
          const rows = tables.get(table)!;
          const idx = rows.findIndex((row) => String(row._id) === key);
          if (idx >= 0) rows.splice(idx, 1);
        }
        byId.delete(key);
        idToTable.delete(key);
      },
    },
  };
  return { ctx, tables };
}

function guestOwner(): AnyDoc {
  return {
    _id: "acct1",
    kind: "guest",
    guestTokenHash: "t1",
    ageBand: "18+",
    matureContentEnabled: false,
    createdAt: 1,
    lastActiveAt: 1,
  };
}

// A fully-populated account so the cascade has a row in every table it sweeps,
// plus a foreign account's rows to prove per-account scoping.
function fullSeed(): Record<string, AnyDoc[]> {
  return {
    accounts: [guestOwner()],
    saves: [
      { _id: "save1", accountId: "acct1" },
      { _id: "save2", accountId: "acct1" },
    ],
    scenes: [{ _id: "scene1", saveId: "save1", turnNumber: 0 }],
    turn_history: [{ _id: "th1", saveId: "save1", turnNumber: 0 }],
    story_bibles: [
      {
        _id: "bible1",
        saveId: "save1",
        status: "ready",
        bible: { keys: ["spoiler-registry"], twists: ["the-butler"] },
        attachedAtTurn: 3,
        lastRefreshAct: 1,
        retryCount: 0,
        createdAt: 1,
        updatedAt: 2,
      },
      {
        _id: "bible2",
        saveId: "save2",
        status: "queued",
        retryCount: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    endings_unlocked: [{ _id: "end1", accountId: "acct1", storyId: "s" }],
    entitlements: [{ _id: "ent1", accountId: "acct1", tier: "free" }],
    usage_meters: [{ _id: "um1", accountId: "acct1" }],
    daily_turn_counter: [{ _id: "dtc1", accountId: "acct1", dayKey: "d" }],
    analytics_events: [{ _id: "ae1", accountId: "acct1" }],
    assets: [{ _id: "asset1", accountId: "acct1" }],
    tale_reads: [{ _id: "tr1", accountId: "acct1" }],
    tale_forks: [{ _id: "tf1", accountId: "acct1" }],
    leaderboard_entries: [
      { _id: "lb1", accountId: "acct1", seasonId: "sea1", kind: "completion" },
      { _id: "lb_other", accountId: "acct2", seasonId: "sea1", kind: "completion" },
    ],
    daily_results: [
      { _id: "dr1", accountId: "acct1", dailyId: "2026-07-12", endingId: "e" },
      { _id: "dr2", accountId: "acct1", dailyId: "2026-07-11", endingId: "e" },
      { _id: "dr_other", accountId: "acct2", dailyId: "2026-07-12", endingId: "e" },
    ],
    authored_seeds: [{ _id: "seed1", ownerAccountId: "acct1", status: "draft" }],
    published_tales: [{ _id: "tale1", ownerAccountId: "acct1" }],
    coop_rooms: [{ _id: "room1", hostAccountId: "acct1", status: "open" }],
  };
}

describe("accountFunctions — deleteAccount cascade (M2)", () => {
  it("hard-deletes story_bibles, daily_results, and leaderboard_entries scoped to the account", async () => {
    const { ctx, tables } = makeCtx(fullSeed());

    const summary = await (deleteAccount as any)._handler(ctx, {
      accountId: "acct1",
      guestTokenHash: "t1",
      confirm: "DELETE",
    });

    // The three tables the finding flagged: the account's rows are gone…
    expect(tables.get("story_bibles")).toEqual([]);
    expect(tables.get("leaderboard_entries")!.map((r) => r._id)).toEqual(["lb_other"]);
    expect(tables.get("daily_results")!.map((r) => r._id)).toEqual(["dr_other"]);

    // …and the rest of the cascade still fires.
    expect(tables.get("saves")).toEqual([]);
    expect(tables.get("scenes")).toEqual([]);
    expect(tables.get("turn_history")).toEqual([]);
    expect(tables.get("assets")).toEqual([]);
    expect(byId(tables, "accounts", "acct1")).toBeUndefined();

    // Soft-retirement (divergent from purge) still applies.
    expect(tables.get("authored_seeds")![0]!.status).toBe("archived");
    expect(tables.get("published_tales")![0]!.accessRevokedAt).toBeGreaterThan(0);
    expect(tables.get("coop_rooms")![0]!.status).toBe("closed");

    expect(summary.savesDeleted).toBe(2);
    expect(summary.scenesDeleted).toBe(1);
  });
});

describe("accountFunctions — exportAccount (M2)", () => {
  it("includes story_bibles metadata but never the server-only bible payload (BC10)", async () => {
    const { ctx } = makeCtx(fullSeed());

    const bundle = await (exportAccount as any)._handler(ctx, {
      accountId: "acct1",
      guestTokenHash: "t1",
    });

    expect(Array.isArray(bundle.storyBibles)).toBe(true);
    expect(bundle.storyBibles).toHaveLength(2);
    const ready = bundle.storyBibles.find((b: AnyDoc) => b.status === "ready");
    expect(ready).toMatchObject({
      saveId: "save1",
      status: "ready",
      attachedAtTurn: 3,
      retryCount: 0,
    });
    // The spoiler payload must not ride into the export.
    expect(ready).not.toHaveProperty("bible");
    for (const b of bundle.storyBibles) {
      expect(b).not.toHaveProperty("bible");
    }
  });
});

function byId(tables: Map<string, AnyDoc[]>, table: string, id: string): AnyDoc | undefined {
  return (tables.get(table) ?? []).find((row) => String(row._id) === id);
}

// ---------------------------------------------------------------------------
// Act-mementos (task 3.1): getProfile projection additions (rankProgress +
// capped mementos, AM3 / R2.4 / R3.2) and the lifecycle loop (deleteAccount
// purge R2.3, exportAccount inclusion R2.3, save-deletion survival R2.1,
// post-claim survival R2.2).
// ---------------------------------------------------------------------------

let mementoSeq = 0;
function memento(overrides: AnyDoc = {}): AnyDoc {
  mementoSeq += 1;
  return {
    _id: `mem${mementoSeq}`,
    _creationTime: mementoSeq,
    accountId: "acct1",
    saveId: "save1",
    storyId: "story-1",
    act: 2,
    label: "Act II — The Drowned Bell Tolls",
    description: "You crossed into the second act.",
    storyTitle: "The Drowned Bell",
    createdAt: mementoSeq,
    ...overrides,
  };
}

async function callProfile(ctx: any, args: AnyDoc = {}) {
  return (getProfile as any)._handler(ctx, {
    accountId: "acct1",
    guestTokenHash: "t1",
    ...args,
  });
}

describe("accountFunctions — getProfile rankProgress ticker (AM3 / R3.2)", () => {
  it("derives rankProgress from the SAME metrics as the librarian rank chip", async () => {
    // One ending, no beats, no tales ⇒ Novice, whose next rung is Keeper at 3
    // endings. The chip and the ticker must agree on that single endings count.
    const { ctx } = makeCtx({
      accounts: [guestOwner()],
      endings_unlocked: [{ _id: "e1", accountId: "acct1", storyId: "s" }],
    });

    const profile = await callProfile(ctx);

    expect(profile.librarianRank.tier).toBe("novice");
    expect(profile.librarianRank.endings).toBe(1);
    expect(profile.rankProgress).toEqual({
      nextTier: "keeper",
      nextLabel: "Keeper",
      needsEndings: 2, // 3 (keeper threshold) − 1 (the chip's endings count)
      needsBeats: 0,
      needsTales: 0,
    });
    // No mementos ⇒ the shelf field is null-for-absent (R4.2), never [] or undefined.
    expect(profile.mementos).toBeNull();
  });

  it("emits rankProgress null at the top tier (The Unwritten)", async () => {
    const endings = Array.from({ length: 30 }, (_, i) => ({
      _id: `e${i}`,
      accountId: "acct1",
      storyId: `s${i}`,
    }));
    const tales = Array.from({ length: 10 }, (_, i) => ({
      _id: `t${i}`,
      ownerAccountId: "acct1",
    }));
    const firedBeats = Array.from({ length: 10 }, (_, i) => ({
      id: `b${i}`,
      status: "fired",
    }));
    const { ctx } = makeCtx({
      accounts: [guestOwner()],
      endings_unlocked: endings,
      published_tales: tales,
      saves: [{ _id: "save1", accountId: "acct1", state: { arc: { beats: firedBeats } } }],
    });

    const profile = await callProfile(ctx);

    expect(profile.librarianRank.tier).toBe("unwritten");
    expect(profile.rankProgress).toBeNull();
  });
});

describe("accountFunctions — getProfile mementos projection (R2.4)", () => {
  it("caps the shelf at the newest 12 and reports the true total", async () => {
    mementoSeq = 0;
    const rows = Array.from({ length: 15 }, (_, i) =>
      memento({ _id: `mem${i}`, createdAt: i + 1, act: (i % 2) + 2 }),
    );
    const { ctx } = makeCtx({ accounts: [guestOwner()], mementos: rows });

    const profile = await callProfile(ctx);

    expect(profile.mementos.total).toBe(15);
    expect(profile.mementos.items).toHaveLength(12);
    // Newest first, and only the newest 12 survive the cap (createdAt 15…4).
    expect(profile.mementos.items[0].createdAt).toBe(15);
    expect(profile.mementos.items[11].createdAt).toBe(4);
    const times = profile.mementos.items.map((m: AnyDoc) => m.createdAt);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    // Only the display fields ride out to the client (design §3 wire shape).
    expect(Object.keys(profile.mementos.items[0]).sort()).toEqual([
      "act",
      "createdAt",
      "description",
      "label",
      "storyTitle",
    ]);
  });
});

describe("accountFunctions — mementos lifecycle (R2.1 / R2.2 / R2.3)", () => {
  it("deleteAccount purges the account's mementos and leaves other accounts' rows (R2.3)", async () => {
    mementoSeq = 0;
    const { ctx, tables } = makeCtx({
      accounts: [guestOwner()],
      mementos: [memento(), memento(), memento({ accountId: "acct2" })],
    });

    await (deleteAccount as any)._handler(ctx, {
      accountId: "acct1",
      guestTokenHash: "t1",
      confirm: "DELETE",
    });

    expect(tables.get("mementos")!.map((r) => r.accountId)).toEqual(["acct2"]);
  });

  it("exportAccount carries the mementos in the bundle, system fields stripped (R2.3)", async () => {
    mementoSeq = 0;
    const { ctx } = makeCtx({
      accounts: [guestOwner()],
      mementos: [memento({ act: 3, label: "Act III — The Last Peal" })],
    });

    const bundle = await (exportAccount as any)._handler(ctx, {
      accountId: "acct1",
      guestTokenHash: "t1",
    });

    expect(bundle.mementos).toHaveLength(1);
    expect(bundle.mementos[0]).toMatchObject({
      accountId: "acct1",
      act: 3,
      label: "Act III — The Last Peal",
      storyTitle: "The Drowned Bell",
    });
    expect(bundle.mementos[0]).not.toHaveProperty("_id");
    expect(bundle.mementos[0]).not.toHaveProperty("_creationTime");
  });

  it("save deletion leaves mementos intact — they read by accountId, not saveId (R2.1)", async () => {
    mementoSeq = 0;
    const { ctx, tables } = makeCtx({
      accounts: [guestOwner()],
      saves: [{ _id: "save1", accountId: "acct1" }],
      mementos: [memento({ saveId: "save1" })],
    });

    // The save row is gone (rewind purge / hardcore permadeath happen elsewhere),
    // but the memento — keyed by accountId — must survive and still project.
    await ctx.db.delete("save1");
    const profile = await callProfile(ctx);

    expect(tables.get("saves")).toEqual([]);
    expect(profile.mementos.total).toBe(1);
    expect(profile.mementos.items[0].label).toBe("Act II — The Drowned Bell Tolls");
  });

  it("guest claim leaves mementos in place — rows keyed by stable accountId (R2.2)", async () => {
    mementoSeq = 0;
    const { ctx, tables } = makeCtx({
      accounts: [guestOwner()],
      mementos: [memento(), memento()],
    });

    await (claimGuest as any)._handler(ctx, {
      accountId: "acct1",
      guestTokenHash: "t1",
      userId: "reader@example.com",
    });

    // No migration, no touch: the two rows still hang off acct1 …
    expect(tables.get("mementos")!.map((r) => r.accountId)).toEqual(["acct1", "acct1"]);
    // … and the profile still surfaces them after the claim.
    const profile = await callProfile(ctx);
    expect(profile.mementos.total).toBe(2);
  });
});
