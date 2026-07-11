// W3-SERVER-DAILY coverage (story-engagement R13, design §6–§7).
//
// - PURE daily.ts: premise determinism per date, distribution math (pct sums +
//   first-finder selection), result-row shaping.
// - dailyFunctions.ts: authorDailyStoryArc fallback-on-LLM-failure, mint
//   idempotency per date (insertDailyTaleRow), startDaily one-per-day guard +
//   guest start, getResults distribution assembly.
//
// Handlers are invoked the same way the rest of the suite does — via the
// registered function's `_handler(ctx, args)` with a hand-built in-memory ctx.

import { describe, expect, it } from "vitest";

import {
  anonymousReaderName,
  buildDailyPremise,
  buildDailyResultRow,
  computeDistribution,
  DAILY_PREMISE_BANK,
  DAILY_TONE_ROTATION,
  epochDayFromISO,
  isoDateFromMillis,
} from "../daily";
import {
  authorDailyStoryArc,
  getResults,
  insertDailyResultIfAbsent,
  insertDailyTaleRow,
  startDaily,
} from "../dailyFunctions";

// ---------------------------------------------------------------------------
// PURE: daily.ts
// ---------------------------------------------------------------------------

describe("buildDailyPremise (R13.1 determinism)", () => {
  it("is deterministic per date — same date, same output", () => {
    const a = buildDailyPremise("2026-07-10");
    const b = buildDailyPremise("2026-07-10");
    expect(a).toEqual(b);
    expect(a.tone.length).toBeGreaterThan(0);
    expect(a.premise.length).toBeGreaterThan(0);
    expect(a.title.length).toBeGreaterThan(0);
  });

  it("rotates the tone on a 14-day cycle and always lands inside the banks", () => {
    // Consecutive days step the tone rotation by one (epoch-day + 1).
    const d0 = buildDailyPremise("2026-07-10");
    const d1 = buildDailyPremise("2026-07-11");
    const idx0 = DAILY_TONE_ROTATION.indexOf(d0.tone);
    const idx1 = DAILY_TONE_ROTATION.indexOf(d1.tone);
    expect(idx1).toBe((idx0 + 1) % DAILY_TONE_ROTATION.length);

    // 14 days later the tone repeats (rotation length).
    const d14 = buildDailyPremise("2026-07-24");
    expect(d14.tone).toBe(d0.tone);

    // Every premise/title comes from the curated bank.
    for (const date of ["2026-01-01", "2026-06-15", "2027-12-31"]) {
      const p = buildDailyPremise(date);
      expect(DAILY_PREMISE_BANK.some((e) => e.premise === p.premise && e.title === p.title)).toBe(true);
      expect(DAILY_TONE_ROTATION).toContain(p.tone);
    }
  });

  it("epochDayFromISO increments by one per calendar day and is UTC-stable", () => {
    expect(epochDayFromISO("2026-07-11") - epochDayFromISO("2026-07-10")).toBe(1);
    expect(epochDayFromISO("2026-01-01") - epochDayFromISO("2025-12-31")).toBe(1);
    // 1970-01-01 is epoch day 0.
    expect(epochDayFromISO("1970-01-01")).toBe(0);
    expect(isoDateFromMillis(0)).toBe("1970-01-01");
  });
});

describe("computeDistribution (R13.3 results math)", () => {
  const labelFor = (id: string) => ({ crown: "The Drowned Crown", risen: "The Risen City" }[id] ?? id);
  const names: Record<string, string> = { a1: "Reader A", a2: "Reader B", a3: "Reader C" };
  const nameFor = (id: string) => names[id];

  it("counts, rounds pct, and pct sums to ~100 across groups", () => {
    const rows = [
      { endingId: "crown", accountId: "a1", finishedAt: 30 },
      { endingId: "crown", accountId: "a2", finishedAt: 10 },
      { endingId: "crown", accountId: "a3", finishedAt: 20 },
      { endingId: "risen", accountId: "a1", finishedAt: 40 },
    ];
    const dist = computeDistribution(rows, labelFor, nameFor);
    // Sorted by count desc: crown (3) then risen (1).
    expect(dist.map((d) => d.endingId)).toEqual(["crown", "risen"]);
    expect(dist[0]).toMatchObject({ count: 3, pct: 75, label: "The Drowned Crown" });
    expect(dist[1]).toMatchObject({ count: 1, pct: 25, label: "The Risen City" });
    expect(dist.reduce((s, d) => s + d.pct, 0)).toBe(100);
  });

  it("selects the EARLIEST finisher for the first-finder badge", () => {
    const rows = [
      { endingId: "crown", accountId: "a1", finishedAt: 30 },
      { endingId: "crown", accountId: "a2", finishedAt: 10 }, // earliest → first finder
      { endingId: "crown", accountId: "a3", finishedAt: 20 },
    ];
    const dist = computeDistribution(rows, labelFor, nameFor);
    expect(dist[0]!.firstAccountName).toBe("Reader B");
  });

  it("omits firstAccountName when no nameFor is supplied (BC4)", () => {
    const rows = [{ endingId: "crown", accountId: "a1", finishedAt: 10 }];
    const dist = computeDistribution(rows, labelFor);
    expect(dist[0]!.firstAccountName).toBeUndefined();
    expect("firstAccountName" in dist[0]!).toBe(false);
  });

  it("returns [] on no results", () => {
    expect(computeDistribution([], labelFor)).toEqual([]);
  });
});

describe("buildDailyResultRow / anonymousReaderName", () => {
  it("shapes the terminal row and floors turnCount", () => {
    const row = buildDailyResultRow({
      dailyId: "d1",
      accountId: "a1",
      endingId: "crown",
      turnCount: 12.9,
      finishedAt: 999,
    });
    expect(row).toEqual({ dailyId: "d1", accountId: "a1", endingId: "crown", turnCount: 12, finishedAt: 999 });
  });

  it("derives a PII-free stable handle", () => {
    expect(anonymousReaderName("acct_ABCD1234")).toBe("Reader 1234");
    expect(anonymousReaderName("")).toBe("A reader");
  });
});

// ---------------------------------------------------------------------------
// authorDailyStoryArc (design §6 — one LLM call + deterministic fallback)
// ---------------------------------------------------------------------------

const VALID_ARC = {
  dramaticQuestion: "Will you keep the light burning until the ship reaches harbor?",
  protagonistWant: "to guide the lost ship home",
  stakes: "the ship and everyone aboard drowns in the dark",
  beats: [
    { id: "inciting", label: "The distress signal", kind: "inciting", priorityHint: "early", requiredBeforeEnding: false },
    { id: "midpoint", label: "The lamp oil runs low", kind: "midpoint", priorityHint: "mid", requiredBeforeEnding: false },
    { id: "climax", label: "The final approach", kind: "climax", priorityHint: "late", requiredBeforeEnding: true },
  ],
  candidateEndings: [
    { id: "safe-harbor", label: "Safe Harbor", hint: "the ship lands" },
    { id: "the-dark", label: "Into the Dark", hint: "the light fails" },
  ],
};

function routerReturning(proposal: unknown) {
  return {
    generateScene: async () =>
      ({ parsed: { proposal }, generation: { provider: "deterministic" }, safetyAction: "allow" }) as any,
  };
}

const ALL_AGES = { surface: "generation" as const, entitlementTier: "free" as const, matureContentEnabled: false };

describe("authorDailyStoryArc (design §6)", () => {
  it("uses the model's arc when valid, stamped source:daily", async () => {
    const out = await authorDailyStoryArc({
      date: "2026-07-10",
      premise: "A lighthouse keeper answers a signal.",
      tone: "hopeful",
      title: "The Lamp at World's Edge",
      router: routerReturning({ storyArc: VALID_ARC }),
      context: ALL_AGES,
    });
    expect(out.source).toBe("llm");
    expect(out.storyArc.source).toBe("daily");
    expect(out.storyArc.dramaticQuestion).toBe(VALID_ARC.dramaticQuestion);
  });

  it("falls back to a synthesized arc when the model omits/malforms storyArc", async () => {
    const out = await authorDailyStoryArc({
      date: "2026-07-10",
      premise: "A lighthouse keeper answers a signal.",
      tone: "hopeful",
      title: "The Lamp at World's Edge",
      router: routerReturning({ prose: "no arc here" }),
      context: ALL_AGES,
    });
    expect(out.source).toBe("synthesized");
    expect(out.storyArc.source).toBe("daily");
    expect(out.storyArc.beats.some((b) => b.requiredBeforeEnding)).toBe(true);
  });

  it("falls back when the router throws (LLM failure — never a mint failure)", async () => {
    const out = await authorDailyStoryArc({
      date: "2026-07-10",
      premise: "A lighthouse keeper answers a signal.",
      tone: "hopeful",
      title: "The Lamp at World's Edge",
      router: {
        generateScene: async () => {
          throw new Error("provider down");
        },
      },
      context: ALL_AGES,
    });
    expect(out.source).toBe("synthesized");
    expect(out.storyArc.candidateEndings.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Fake convex ctx harness (in-memory tables + auth + runMutation/runQuery)
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

function makeCtx(seed: { tables?: Record<string, Row[]>; guestTokenHash?: string } = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed.tables ?? {})) {
    tables[name] = rows.map((r, i) => ({ _id: r._id ?? `${name}_${i}`, ...r }));
  }
  const inserted: Array<{ table: string; doc: Row }> = [];
  const runMutationCalls: Array<{ ref: any; args: any }> = [];
  let nextId = 1000;

  function makeQuery(table: string) {
    const eqs: Array<[string, any]> = [];
    const filters: Array<(row: Row) => boolean> = [];
    const chain: any = {
      withIndex(_name: string, build: (q: any) => any) {
        const q = {
          eq(field: string, value: any) {
            eqs.push([field, value]);
            return q;
          },
        };
        build(q);
        return chain;
      },
      filter(build: (q: any) => any) {
        const q = {
          field: (name: string) => ({ __field: name }),
          eq: (a: any, b: any) => ({ __eq: [a, b] }),
        };
        const expr = build(q);
        filters.push((row: Row) => {
          const [a, b] = expr.__eq;
          const left = a && a.__field ? row[a.__field] : a;
          return left === b;
        });
        return chain;
      },
      rows() {
        return (tables[table] ?? []).filter(
          (row) => eqs.every(([f, val]) => row[f] === val) && filters.every((fn) => fn(row)),
        );
      },
      async first() {
        return chain.rows()[0] ?? null;
      },
      async collect() {
        return chain.rows();
      },
    };
    return chain;
  }

  const ctx: any = {
    db: {
      async get(id: any) {
        for (const rows of Object.values(tables)) {
          const hit = rows.find((r) => String(r._id) === String(id));
          if (hit) return hit;
        }
        return null;
      },
      query: (table: string) => makeQuery(table),
      async insert(table: string, doc: Row) {
        const _id = `${table}_${nextId++}`;
        const row = { _id, ...doc };
        (tables[table] ??= []).push(row);
        inserted.push({ table, doc: row });
        return _id;
      },
    },
    auth: {
      async getUserIdentity() {
        return null;
      },
    },
    async runMutation(ref: any, args: any) {
      runMutationCalls.push({ ref, args });
      return { saveId: "save_new" };
    },
    async runQuery() {
      return null;
    },
  };

  return { ctx, tables, inserted, runMutationCalls };
}

function guestAccount(id = "acct_1", hash = "guest_hash"): Row {
  return { _id: id, kind: "guest", ageBand: "18+", guestTokenHash: hash, createdAt: 1, lastActiveAt: 1 };
}

function dailyRow(id = "daily_1", date = isoDateFromMillis(Date.now())): Row {
  return {
    _id: id,
    date,
    premise: "A lighthouse keeper answers a signal.",
    tone: "hopeful",
    title: "The Lamp at World's Edge",
    storyArc: { ...VALID_ARC, act: 1, source: "daily" },
    createdAt: 1,
  };
}

// ---------------------------------------------------------------------------
// insertDailyTaleRow — idempotency per date (mint idempotency)
// ---------------------------------------------------------------------------

describe("insertDailyTaleRow (R13.1 idempotency per date)", () => {
  it("inserts once, and a second call for the same date returns the existing id", async () => {
    const { ctx, tables } = makeCtx({ tables: { daily_tales: [] } });
    const args = {
      date: "2026-07-10",
      premise: "p",
      tone: "hopeful",
      title: "t",
      storyArc: { ...VALID_ARC, source: "daily" },
      createdAt: 1,
    };
    const first = await (insertDailyTaleRow as any)._handler(ctx, args);
    const second = await (insertDailyTaleRow as any)._handler(ctx, args);
    expect(first.dailyId).toBe(second.dailyId);
    expect(tables.daily_tales).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// startDaily — one-per-day guard + guest start
// ---------------------------------------------------------------------------

describe("startDaily (R13.2)", () => {
  it("creates a save for a guest with no prior play", async () => {
    const { ctx, runMutationCalls } = makeCtx({
      tables: { accounts: [guestAccount()], daily_tales: [dailyRow()], daily_results: [], saves: [] },
    });
    const out = await (startDaily as any)._handler(ctx, { accountId: "acct_1", guestTokenHash: "guest_hash" });
    expect(out).toEqual({ saveId: "save_new" });
    // Delegated to game:createSave with the daily arc injected via dailyId.
    expect(runMutationCalls).toHaveLength(1);
    expect(runMutationCalls[0]!.args).toMatchObject({
      accountId: "acct_1",
      storyId: "open-canvas",
      mode: "story",
      dailyId: "daily_1",
      seedPremise: "A lighthouse keeper answers a signal.",
    });
  });

  it("throws daily_already_played when a daily_results row exists", async () => {
    const { ctx } = makeCtx({
      tables: {
        accounts: [guestAccount()],
        daily_tales: [dailyRow()],
        daily_results: [{ dailyId: "daily_1", accountId: "acct_1", endingId: "crown", turnCount: 5, finishedAt: 1 }],
        saves: [],
      },
    });
    await expect(
      (startDaily as any)._handler(ctx, { accountId: "acct_1", guestTokenHash: "guest_hash" }),
    ).rejects.toThrow(/daily_already_played/);
  });

  it("throws daily_already_played when a save already carries this dailyId", async () => {
    const { ctx } = makeCtx({
      tables: {
        accounts: [guestAccount()],
        daily_tales: [dailyRow()],
        daily_results: [],
        saves: [{ dailyId: "daily_1", accountId: "acct_1" }],
      },
    });
    await expect(
      (startDaily as any)._handler(ctx, { accountId: "acct_1", guestTokenHash: "guest_hash" }),
    ).rejects.toThrow(/daily_already_played/);
  });

  it("throws daily_not_available when there is no daily for today", async () => {
    const { ctx } = makeCtx({
      tables: { accounts: [guestAccount()], daily_tales: [], daily_results: [], saves: [] },
    });
    await expect(
      (startDaily as any)._handler(ctx, { accountId: "acct_1", guestTokenHash: "guest_hash" }),
    ).rejects.toThrow(/daily_not_available/);
  });
});

// ---------------------------------------------------------------------------
// getResults — distribution assembly + yours
// ---------------------------------------------------------------------------

describe("getResults (R13.3 / design §7)", () => {
  it("returns yours + the global distribution with labels from the arc", async () => {
    const { ctx } = makeCtx({
      tables: {
        accounts: [guestAccount()],
        daily_tales: [dailyRow()],
        daily_results: [
          { dailyId: "daily_1", accountId: "acct_1", endingId: "safe-harbor", turnCount: 8, finishedAt: 20 },
          { dailyId: "daily_1", accountId: "acct_2", endingId: "safe-harbor", turnCount: 9, finishedAt: 10 },
          { dailyId: "daily_1", accountId: "acct_3", endingId: "the-dark", turnCount: 7, finishedAt: 30 },
        ],
      },
    });
    const out = await (getResults as any)._handler(ctx, {
      dailyId: "daily_1",
      accountId: "acct_1",
      guestTokenHash: "guest_hash",
    });
    expect(out.yours).toEqual({ endingId: "safe-harbor", label: "Safe Harbor" });
    expect(out.distribution.map((d: any) => d.endingId)).toEqual(["safe-harbor", "the-dark"]);
    expect(out.distribution[0]).toMatchObject({ count: 2, pct: 67, label: "Safe Harbor" });
    // Earliest finisher of safe-harbor is acct_2 (finishedAt 10).
    expect(out.distribution[0].firstAccountName).toBe(anonymousReaderName("acct_2"));
  });

  it("returns yours:null when the caller has no result", async () => {
    const { ctx } = makeCtx({
      tables: { accounts: [guestAccount()], daily_tales: [dailyRow()], daily_results: [] },
    });
    const out = await (getResults as any)._handler(ctx, {
      dailyId: "daily_1",
      accountId: "acct_1",
      guestTokenHash: "guest_hash",
    });
    expect(out.yours).toBeNull();
    expect(out.distribution).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// insertDailyResultIfAbsent — terminal hook idempotency (W3-D3)
// ---------------------------------------------------------------------------

describe("insertDailyResultIfAbsent (R13.3 terminal hook)", () => {
  it("inserts once per (accountId, dailyId), no-ops on repeat", async () => {
    const { ctx, tables } = makeCtx({ tables: { daily_results: [], analytics_events: [] } });
    const input = { dailyId: "daily_1", accountId: "acct_1", endingId: "safe-harbor", turnCount: 8, finishedAt: 100 };
    const first = await insertDailyResultIfAbsent(ctx, input);
    const second = await insertDailyResultIfAbsent(ctx, input);
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(tables.daily_results).toHaveLength(1);
    expect(tables.daily_results![0]).toMatchObject({ dailyId: "daily_1", accountId: "acct_1", endingId: "safe-harbor", turnCount: 8 });
  });
});
