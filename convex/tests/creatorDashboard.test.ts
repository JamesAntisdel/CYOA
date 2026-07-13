// Creator analytics dashboard (core-read-loop Req 22.4/22.5): play-time
// attribution writer + per-seed aggregation. Pure helpers are exercised
// directly; the registered getSeedStats query runs against a hand-built ctx
// mock (same style as creatorFunctions.test.ts). A source drift-guard pins
// the three game.ts turn-completion call sites, since those handlers are too
// entangled to mount here.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PLAY_SECONDS_CAP,
  PLAY_SECONDS_MIN,
  QUIT_STALE_AFTER_MS,
  READING_ACTIVE_WITHIN_MS,
  aggregatePlayTimeBySeed,
  buildSeedStats,
  clampPlaySeconds,
  getSeedStats,
  insertCreatorPlayTimeAttribution,
  resolveSaveEnding,
} from "../creatorDashboard";

type AnyDoc = Record<string, any>;

function makeCtx(seed: Record<string, AnyDoc[]>) {
  const tables = new Map<string, AnyDoc[]>();
  const byId = new Map<string, AnyDoc>();
  for (const [table, rows] of Object.entries(seed)) {
    const copy = rows.map((row) => ({ ...row }));
    tables.set(table, copy);
    for (const row of copy) byId.set(String(row._id), row);
  }
  let nextId = 1;

  const ctx = {
    auth: { getUserIdentity: async () => null },
    db: {
      async get(id: any) {
        return byId.get(String(id)) ?? null;
      },
      query(table: string) {
        const rows = tables.get(table) ?? [];
        const constraints: Array<[string, unknown]> = [];
        let reversed = false;
        const q = {
          eq(field: string, value: unknown) {
            constraints.push([field, value]);
            return q;
          },
        };
        const filtered = () => {
          const matched = rows.filter((row) =>
            constraints.every(([field, value]) => row[field] === value),
          );
          return reversed ? [...matched].reverse() : matched;
        };
        const chain = {
          withIndex(_name: string, build?: (qq: any) => any) {
            if (build) build(q);
            return chain;
          },
          order(direction: "asc" | "desc") {
            reversed = direction === "desc";
            return chain;
          },
          async first() {
            return filtered()[0] ?? null;
          },
          async take(count: number) {
            return filtered().slice(0, count);
          },
          async collect() {
            return filtered();
          },
        };
        return chain;
      },
      async insert(table: string, doc: any) {
        const id = `${table}_${nextId++}`;
        const row = { ...doc, _id: id };
        if (!tables.has(table)) tables.set(table, []);
        tables.get(table)!.push(row);
        byId.set(id, row);
        return id;
      },
      async patch(id: any, patch: any) {
        const existing = byId.get(String(id));
        if (!existing) return;
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) delete existing[key];
          else existing[key] = value;
        }
      },
    },
  };
  return { ctx, tables };
}

function storyDoc() {
  return {
    id: "lantern-market",
    version: 1,
    title: "Lantern Market",
    startNodeId: "start",
    initialState: { vitality: 3, currency: 0 },
    endings: {
      "ending-careful": { id: "ending-careful", label: "A Clear Route", kind: "success" },
      "ending-risk": { id: "ending-risk", label: "The Lantern Goes Out", kind: "death" },
    },
    nodes: {
      start: {
        id: "start",
        seed: "A clean opening.",
        choices: [
          { id: "careful", label: "Careful", targetNodeId: "ending-careful" },
          { id: "bold", label: "Bold", targetNodeId: "ending-risk" },
        ],
      },
      "ending-careful": { id: "ending-careful", endingId: "ending-careful", choices: [] },
      "ending-risk": { id: "ending-risk", endingId: "ending-risk", isDeath: true, choices: [] },
    },
  };
}

function seedDoc(overrides: AnyDoc = {}): AnyDoc {
  return {
    _id: "seed1",
    ownerAccountId: "acct_owner",
    title: "Lantern Market",
    status: "published",
    story: storyDoc(),
    safetySummary: { action: "allow", safetyCategories: [], matureCategories: [], redacted: false },
    createdAt: 1,
    updatedAt: 10,
    ...overrides,
  };
}

const NOW = 1_000_000_000;

function saveRow(overrides: AnyDoc = {}): AnyDoc {
  return {
    _id: `save_${Math.random().toString(36).slice(2)}`,
    accountId: "acct_reader",
    storyId: "authored_seed:seed1",
    status: "active",
    currentNodeId: "start",
    turnNumber: 1,
    updatedAt: NOW - 1000,
    ...overrides,
  };
}

describe("creatorDashboard — clampPlaySeconds", () => {
  it("clamps into [min, cap] and floors fractions", () => {
    expect(clampPlaySeconds(0)).toBe(PLAY_SECONDS_MIN);
    expect(clampPlaySeconds(-40)).toBe(PLAY_SECONDS_MIN);
    expect(clampPlaySeconds(42.9)).toBe(42);
    expect(clampPlaySeconds(3 * 60 * 60)).toBe(PLAY_SECONDS_CAP);
    expect(clampPlaySeconds(Number.NaN)).toBe(PLAY_SECONDS_MIN);
  });
});

describe("creatorDashboard — insertCreatorPlayTimeAttribution", () => {
  it("skips non-authored storyIds without touching the db", async () => {
    const { ctx, tables } = makeCtx({ authored_seeds: [seedDoc()] });
    await insertCreatorPlayTimeAttribution(ctx as any, {
      save: { storyId: "training-room", updatedAt: NOW - 30_000 },
      readerAccountId: "acct_reader",
      now: NOW,
    });
    expect(tables.get("analytics_events")).toBeUndefined();
  });

  it("skips silently when the seed row is gone", async () => {
    const { ctx, tables } = makeCtx({});
    await insertCreatorPlayTimeAttribution(ctx as any, {
      save: { storyId: "authored_seed:missing", updatedAt: NOW - 30_000 },
      readerAccountId: "acct_reader",
      now: NOW,
    });
    expect(tables.get("analytics_events")).toBeUndefined();
  });

  it("credits an external reader's turn slice to the creator", async () => {
    const { ctx, tables } = makeCtx({ authored_seeds: [seedDoc()] });
    await insertCreatorPlayTimeAttribution(ctx as any, {
      save: { storyId: "authored_seed:seed1", updatedAt: NOW - 90_000 },
      readerAccountId: "acct_reader",
      now: NOW,
    });
    const rows = tables.get("analytics_events")!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventName: "creator.play_time",
      accountId: "acct_reader",
      storyId: "lantern-market",
      redacted: true,
      createdAt: NOW,
      payload: {
        creatorAccountId: "acct_owner",
        authoredSeedId: "seed1",
        seconds: 90,
        selfPlay: false,
      },
    });
  });

  it("flags owner self-play so the dashboard can separate it", async () => {
    const { ctx, tables } = makeCtx({ authored_seeds: [seedDoc()] });
    await insertCreatorPlayTimeAttribution(ctx as any, {
      save: { storyId: "authored_seed:seed1", updatedAt: NOW - 5_000 },
      readerAccountId: "acct_owner",
      now: NOW,
    });
    expect(tables.get("analytics_events")![0]!.payload.selfPlay).toBe(true);
  });

  it("caps a parked-tab delta at the per-turn ceiling", async () => {
    const { ctx, tables } = makeCtx({ authored_seeds: [seedDoc()] });
    await insertCreatorPlayTimeAttribution(ctx as any, {
      save: { storyId: "authored_seed:seed1", updatedAt: NOW - 6 * 60 * 60 * 1000 },
      readerAccountId: "acct_reader",
      now: NOW,
    });
    expect(tables.get("analytics_events")![0]!.payload.seconds).toBe(PLAY_SECONDS_CAP);
  });

  it("never throws out of the caller when the insert fails", async () => {
    const { ctx } = makeCtx({ authored_seeds: [seedDoc()] });
    (ctx.db as any).insert = async () => {
      throw new Error("write conflict");
    };
    await expect(
      insertCreatorPlayTimeAttribution(ctx as any, {
        save: { storyId: "authored_seed:seed1", updatedAt: NOW - 5_000 },
        readerAccountId: "acct_reader",
        now: NOW,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("creatorDashboard — resolveSaveEnding", () => {
  it("labels endings from the seed's own story graph", () => {
    const ending = resolveSaveEnding(
      storyDoc() as any,
      { currentNodeId: "ending-careful" },
      "ended",
    );
    expect(ending).toEqual({ endingId: "ending-careful", label: "A Clear Route" });
  });

  it("buckets safety exits as the synthetic safe ending", () => {
    expect(resolveSaveEnding(storyDoc() as any, { currentNodeId: "start" }, "ended_safely"))
      .toEqual({ endingId: "ending-safe", label: "Safe exit" });
  });

  it("falls back to unknown instead of dropping the terminal", () => {
    expect(resolveSaveEnding(null, { currentNodeId: "gone" }, "dead"))
      .toEqual({ endingId: "unknown", label: null });
  });
});

describe("creatorDashboard — buildSeedStats", () => {
  const seed = {
    _id: "seed1",
    ownerAccountId: "acct_owner",
    title: "Lantern Market",
    story: storyDoc(),
    updatedAt: 10,
  };

  it("splits plays, terminals, quit points, and self-play", () => {
    const stats = buildSeedStats({
      seed,
      storyId: "authored_seed:seed1",
      saves: [
        // Terminal outcomes.
        saveRow({ status: "ended", currentNodeId: "ending-careful", turnNumber: 4 }),
        saveRow({ status: "ended", currentNodeId: "ending-careful", turnNumber: 5 }),
        saveRow({ status: "dead", currentNodeId: "ending-risk", turnNumber: 2 }),
        saveRow({ status: "ended_safely", currentNodeId: "start", turnNumber: 3 }),
        // Owner self-play, still terminal — counted AND flagged.
        saveRow({ accountId: "acct_owner", status: "dead", currentNodeId: "ending-risk", turnNumber: 1 }),
        // Stale mid-story runs → quit points at their resting turn.
        saveRow({ status: "active", turnNumber: 3, updatedAt: NOW - QUIT_STALE_AFTER_MS - 1 }),
        saveRow({ status: "active", turnNumber: 3, updatedAt: NOW - QUIT_STALE_AFTER_MS - 5 }),
        saveRow({ status: "active", turnNumber: 6, updatedAt: NOW - QUIT_STALE_AFTER_MS - 5 }),
        // Fresh active run → still reading, not churn.
        saveRow({ status: "active", turnNumber: 2, updatedAt: NOW - 60_000 }),
        // Malformed row → tolerant-drop.
        saveRow({ status: undefined }),
      ],
      forkCount: 2,
      playSeconds: { total: 640.4, external: 500.6 },
      now: NOW,
    });

    expect(stats.seedId).toBe("seed1");
    expect(stats.storyId).toBe("authored_seed:seed1");
    expect(stats.plays).toBe(9);
    expect(stats.selfPlays).toBe(1);
    expect(stats.externalPlays).toBe(8);
    expect(stats.completions).toBe(2);
    expect(stats.deaths).toBe(2);
    expect(stats.safeExits).toBe(1);
    expect(stats.inProgress).toBe(1);
    expect(stats.forks).toBe(2);
    expect(stats.playSeconds).toBe(640);
    expect(stats.externalPlaySeconds).toBe(501);
    // Histogram sorted by turn; the client renders "drift away around turn 3".
    expect(stats.quitPoints).toEqual([
      { turnNumber: 3, count: 2 },
      { turnNumber: 6, count: 1 },
    ]);
    // Distribution sorted by count, labeled from the authored story JSON.
    expect(stats.endings[0]).toMatchObject({ endingId: "ending-careful", label: "A Clear Route", count: 2 });
    expect(stats.endings).toContainEqual({ endingId: "ending-risk", label: "The Lantern Goes Out", count: 2 });
    expect(stats.endings).toContainEqual({ endingId: "ending-safe", label: "Safe exit", count: 1 });
  });

  it("returns zeroed stats for a seed nobody has played", () => {
    const stats = buildSeedStats({
      seed,
      storyId: "authored_seed:seed1",
      saves: [],
      forkCount: 0,
      playSeconds: { total: 0, external: 0 },
      now: NOW,
    });
    expect(stats.plays).toBe(0);
    expect(stats.endings).toEqual([]);
    expect(stats.quitPoints).toEqual([]);
  });

  it("does not misreport a recent quitter as 'still reading' (panel-2 honesty fix)", () => {
    const stats = buildSeedStats({
      seed,
      storyId: "authored_seed:seed1",
      saves: [
        // Touched 20 min ago → confidently reading.
        saveRow({ status: "active", turnNumber: 2, updatedAt: NOW - 20 * 60_000 }),
        // Idle 10h: drifted (2h–48h) → NOT "still reading", NOT yet a quit.
        saveRow({ status: "active", turnNumber: 3, updatedAt: NOW - 10 * 60 * 60_000 }),
        // Idle > 48h → confirmed quit point.
        saveRow({ status: "active", turnNumber: 4, updatedAt: NOW - QUIT_STALE_AFTER_MS - 1 }),
      ],
      forkCount: 0,
      playSeconds: { total: 0, external: 0 },
      now: NOW,
    });
    expect(stats.inProgress).toBe(1); // only the 20-min-ago save
    expect(stats.idle).toBe(1); // the 10h drifter — surfaced, not hidden in inProgress
    expect(stats.quitPoints).toEqual([{ turnNumber: 4, count: 1 }]);
    expect(stats.quitStaleAfterMs).toBe(QUIT_STALE_AFTER_MS);
  });

  it("honors a custom reading-active window boundary", () => {
    const atBoundary = buildSeedStats({
      seed,
      storyId: "authored_seed:seed1",
      saves: [saveRow({ status: "active", turnNumber: 2, updatedAt: NOW - READING_ACTIVE_WITHIN_MS })],
      forkCount: 0,
      playSeconds: { total: 0, external: 0 },
      now: NOW,
    });
    // Exactly at the window → idle (>=), not reading.
    expect(atBoundary.inProgress).toBe(0);
    expect(atBoundary.idle).toBe(1);
  });

  it("flags playSecondsApprox when the play-time scan was saturated", () => {
    const base = {
      seed,
      storyId: "authored_seed:seed1",
      saves: [] as Array<Record<string, unknown>>,
      forkCount: 0,
      playSeconds: { total: 120, external: 90 },
      now: NOW,
    };
    expect(buildSeedStats({ ...base, playSecondsApprox: true }).playSecondsApprox).toBe(true);
    // Default (exact) when the flag is absent.
    expect(buildSeedStats(base).playSecondsApprox).toBe(false);
  });
});

describe("creatorDashboard — aggregatePlayTimeBySeed", () => {
  it("groups seconds per seed and excludes self-play from external", () => {
    const grouped = aggregatePlayTimeBySeed([
      { payload: { authoredSeedId: "seed1", seconds: 60, selfPlay: false } },
      { payload: { authoredSeedId: "seed1", seconds: 30, selfPlay: true } },
      { payload: { authoredSeedId: "seed2", seconds: 10 } },
      // Tolerant-drop rows.
      { payload: { authoredSeedId: "seed1", seconds: -5 } },
      { payload: { seconds: 15 } },
      { payload: null },
      {},
    ]);
    expect(grouped.get("seed1")).toEqual({ total: 90, external: 60 });
    expect(grouped.get("seed2")).toEqual({ total: 10, external: 10 });
    expect(grouped.size).toBe(2);
  });
});

describe("creatorDashboard — getSeedStats (registered query)", () => {
  function ownerAccount(): AnyDoc {
    return {
      _id: "acct_owner",
      kind: "guest",
      guestTokenHash: "owner_token",
      ageBand: "18+",
      matureContentEnabled: false,
      createdAt: 1,
      lastActiveAt: 1,
    };
  }

  function baseSeed(extra: Record<string, AnyDoc[]> = {}) {
    return {
      accounts: [ownerAccount()],
      authored_seeds: [
        seedDoc(),
        seedDoc({ _id: "seed_draft", status: "draft" }),
        seedDoc({ _id: "seed_other", ownerAccountId: "acct_stranger" }),
      ],
      ...extra,
    };
  }

  async function run(ctx: any, overrides: Record<string, unknown> = {}) {
    return (getSeedStats as any)._handler(ctx, {
      accountId: "acct_owner",
      guestTokenHash: "owner_token",
      ...overrides,
    });
  }

  it("rejects a session token that does not match the owner", async () => {
    const { ctx } = makeCtx(baseSeed());
    await expect(run(ctx, { guestTokenHash: "wrong" })).rejects.toThrow("resource_not_owned");
  });

  it("returns the empty shape for a creator with no published seeds", async () => {
    const { ctx } = makeCtx({
      accounts: [ownerAccount()],
      authored_seeds: [seedDoc({ status: "draft" })],
    });
    await expect(run(ctx)).resolves.toEqual({ seeds: [] });
  });

  it("aggregates saves, play time, and forks per published seed only", async () => {
    const { ctx } = makeCtx(
      baseSeed({
        saves: [
          saveRow({ status: "ended", currentNodeId: "ending-careful", turnNumber: 4 }),
          saveRow({ status: "active", turnNumber: 2, updatedAt: 0 }), // ancient → quit point
          saveRow({ accountId: "acct_owner", status: "dead", currentNodeId: "ending-risk", turnNumber: 1 }),
          // Save on someone else's seed must not leak into acct_owner's stats.
          saveRow({ storyId: "authored_seed:seed_other", status: "ended", currentNodeId: "ending-careful" }),
        ],
        analytics_events: [
          {
            _id: "evt1",
            eventName: "creator.play_time",
            payload: { creatorAccountId: "acct_owner", authoredSeedId: "seed1", seconds: 120, selfPlay: false },
            redacted: true,
            createdAt: 5,
          },
          {
            _id: "evt2",
            eventName: "creator.play_time",
            payload: { creatorAccountId: "acct_owner", authoredSeedId: "seed1", seconds: 30, selfPlay: true },
            redacted: true,
            createdAt: 6,
          },
          { _id: "evt3", eventName: "turn.completed", payload: {}, redacted: true, createdAt: 7 },
        ],
        published_tales: [
          { _id: "tale1", ownerAccountId: "acct_reader", storyId: "authored_seed:seed1" },
          { _id: "tale2", ownerAccountId: "acct_reader", storyId: "open-canvas" },
        ],
        tale_forks: [
          { _id: "fork1", taleId: "tale1", accountId: "acct_x", createdAt: 1 },
          { _id: "fork2", taleId: "tale1", accountId: "acct_y", createdAt: 2 },
          { _id: "fork3", taleId: "tale2", accountId: "acct_z", createdAt: 3 },
        ],
      }),
    );

    const result = await run(ctx);
    expect(result.seeds).toHaveLength(1); // draft + foreign seeds excluded
    const stats = result.seeds[0]!;
    expect(stats.seedId).toBe("seed1");
    expect(stats.plays).toBe(3);
    expect(stats.selfPlays).toBe(1);
    expect(stats.completions).toBe(1);
    expect(stats.deaths).toBe(1);
    expect(stats.quitPoints).toEqual([{ turnNumber: 2, count: 1 }]);
    expect(stats.playSeconds).toBe(150);
    expect(stats.externalPlaySeconds).toBe(120);
    expect(stats.forks).toBe(2); // tale2's fork belongs to another story
    expect(stats.endings).toContainEqual({ endingId: "ending-careful", label: "A Clear Route", count: 1 });
  });
});

describe("creatorDashboard — game.ts wiring drift-guard", () => {
  const src = readFileSync(resolve(__dirname, "../game.ts"), "utf8");

  it("imports the attribution writer", () => {
    expect(src).toMatch(/import \{ insertCreatorPlayTimeAttribution \} from "\.\/creatorDashboard";/);
  });

  it("fires attribution in all three turn-completion paths", () => {
    // submitChoice (authored non-streaming), beginStreamingChoice (authored
    // deterministic step), completeSceneStream (authored streamed prose).
    const calls = src.match(/await insertCreatorPlayTimeAttribution\(ctx, \{/g) ?? [];
    expect(calls).toHaveLength(3);
    // Every call anchors on the PRE-patch save (readerAccountId + now ride along).
    const anchored = src.match(
      /await insertCreatorPlayTimeAttribution\(ctx, \{\s*save,\s*readerAccountId: args\.accountId,\s*now,\s*\}\);/g,
    ) ?? [];
    expect(anchored).toHaveLength(3);
  });
});
