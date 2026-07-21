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
  advanceDailyStreak,
  anonymousReaderName,
  buildDailyPremise,
  buildDailyResultRow,
  choiceKeyForLabel,
  computeChoicePulse,
  computeDistribution,
  DAILY_PREMISE_BANK,
  DAILY_TONE_ROTATION,
  emptyStreak,
  epochDayFromISO,
  FREE_FORM_KEY,
  isoDateFromMillis,
  KILLCAM_MIN_READERS,
  KILLCAM_TURN_CAP,
  pulsePhrase,
  type PulseEntry,
} from "../daily";
import {
  authorDailyStoryArc,
  getResults,
  getStreak,
  getToday,
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
// PURE: daily killcam — constants, choiceKeyForLabel, pulsePhrase (R1.2/R2.4/R4.1)
// ---------------------------------------------------------------------------

describe("killcam constants (R4.1)", () => {
  it("caps at the opening 3 forks and floors at 10 readers", () => {
    expect(KILLCAM_TURN_CAP).toBe(3);
    expect(KILLCAM_MIN_READERS).toBe(10);
    expect(FREE_FORM_KEY).toBe("free-form");
  });
});

describe("choiceKeyForLabel (R1.2 normalization)", () => {
  it("lowercases, trims, collapses whitespace, and slugifies punctuation", () => {
    expect(choiceKeyForLabel("Row Toward the Dark", false)).toBe("row-toward-the-dark");
    expect(choiceKeyForLabel("  Answer the Signal  ", false)).toBe("answer-the-signal");
    expect(choiceKeyForLabel("Follow    the   light", false)).toBe("follow-the-light");
    // Case-insensitive: two casings collapse to the SAME bucket key.
    expect(choiceKeyForLabel("Open the Door", false)).toBe(
      choiceKeyForLabel("OPEN THE DOOR", false),
    );
  });

  it("strips punctuation and never emits leading/trailing separators", () => {
    expect(choiceKeyForLabel("Wait... and listen!", false)).toBe("wait-and-listen");
    expect(choiceKeyForLabel("\"Run,\" she said.", false)).toBe("run-she-said");
    expect(choiceKeyForLabel("--edge--", false)).toBe("edge");
  });

  it("maps free-form turns to the reserved key regardless of the label", () => {
    expect(choiceKeyForLabel("literally anything the reader typed", true)).toBe(FREE_FORM_KEY);
    expect(choiceKeyForLabel("", true)).toBe(FREE_FORM_KEY);
  });

  it("falls back to free-form when the normalized label is empty", () => {
    expect(choiceKeyForLabel("", false)).toBe(FREE_FORM_KEY);
    expect(choiceKeyForLabel("   ", false)).toBe(FREE_FORM_KEY);
    expect(choiceKeyForLabel("!!!???", false)).toBe(FREE_FORM_KEY);
    // Non-latin script slugs to nothing under the ascii slug discipline.
    expect(choiceKeyForLabel("日本語", false)).toBe(FREE_FORM_KEY);
  });

  it("is total on unicode — never throws, deterministic", () => {
    // Accented latin: the accented char is a separator, the ascii tail survives.
    expect(choiceKeyForLabel("Café résumé", false)).toBe("caf-r-sum");
    const once = choiceKeyForLabel("Naïve café ☕ path", false);
    expect(choiceKeyForLabel("Naïve café ☕ path", false)).toBe(once);
    expect(() => choiceKeyForLabel("🎲🔥", false)).not.toThrow();
    expect(choiceKeyForLabel("🎲🔥", false)).toBe(FREE_FORM_KEY);
  });

  it("clamps the slug to 64 chars with no dangling separator", () => {
    const long = "word ".repeat(40).trim(); // 200 chars → slug far over 64
    const key = choiceKeyForLabel(long, false);
    expect(key.length).toBeLessThanOrEqual(64);
    expect(key.endsWith("-")).toBe(false);
    expect(key.startsWith("-")).toBe(false);
    // Just under the cap survives intact.
    const under = "a".repeat(64);
    expect(choiceKeyForLabel(under, false)).toBe(under);
  });
});

describe("pulsePhrase (R2.4 tier boundaries)", () => {
  it("selects tiers at the inclusive floor boundaries", () => {
    // under 25 → the road less traveled (24/25 boundary)
    expect(pulsePhrase(0, false)).toBe("the road less traveled");
    expect(pulsePhrase(24, false)).toBe("the road less traveled");
    // 25–59 → a common thread (25 and 59)
    expect(pulsePhrase(25, false)).toBe("a common thread");
    expect(pulsePhrase(59, false)).toBe("a common thread");
    // 60+ → the well-worn path (59/60 boundary)
    expect(pulsePhrase(60, false)).toBe("the well-worn path");
    expect(pulsePhrase(100, false)).toBe("the well-worn path");
  });

  it("free-form overrides every tier", () => {
    expect(pulsePhrase(0, true)).toBe("wrote their own page");
    expect(pulsePhrase(62, true)).toBe("wrote their own page");
    expect(pulsePhrase(100, true)).toBe("wrote their own page");
  });
});

// ---------------------------------------------------------------------------
// PURE: computeChoicePulse (R2.1/R2.2/R2.3)
// ---------------------------------------------------------------------------

/** Build `n` rows at a turn: `same` of them match `key`, the rest are "other". */
function rowsAt(turnNumber: number, key: string, same: number, total: number) {
  const rows: { turnNumber: number; choiceKey: string }[] = [];
  for (let i = 0; i < total; i++) {
    rows.push({ turnNumber, choiceKey: i < same ? key : `other-${i}` });
  }
  return rows;
}

describe("computeChoicePulse (R2 spoiler-safe aggregation)", () => {
  it("emits the reader's own bucket with a server-rounded sharePct", () => {
    const readerRows = [{ turnNumber: 1, choiceKey: "answer-the-signal" }];
    const allRows = rowsAt(1, "answer-the-signal", 6, 10);
    const out = computeChoicePulse(readerRows, allRows);
    expect(out).toEqual<PulseEntry[]>([
      {
        turnNumber: 1,
        sharePct: 60,
        sameCount: 6,
        totalReaders: 10,
        phrase: "the well-worn path",
      },
    ]);
  });

  it("includes a turn at EXACTLY the 10-reader floor and omits one below it", () => {
    const readerRows = [{ turnNumber: 1, choiceKey: "k" }];
    // 10 total → kept.
    expect(computeChoicePulse(readerRows, rowsAt(1, "k", 5, 10))).toHaveLength(1);
    // 9 total → omitted entirely (silence, not a low-confidence number).
    expect(computeChoicePulse(readerRows, rowsAt(1, "k", 5, 9))).toEqual([]);
  });

  it("rounds sharePct with the same Math.round discipline as computeDistribution", () => {
    // 2 of 3 → 66.67 → 67, mirroring computeDistribution's rounding.
    const out = computeChoicePulse(
      [{ turnNumber: 1, choiceKey: "k" }],
      [
        ...rowsAt(1, "k", 2, 3),
        // pad to the floor with distinct other rows, preserving the 2/… ratio target
      ],
    );
    // With only 3 rows we are under the floor, so assert rounding on a floor-passing set:
    void out;
    const passing = computeChoicePulse(
      [{ turnNumber: 1, choiceKey: "k" }],
      rowsAt(1, "k", 8, 12), // 8/12 = 66.67 → 67
    );
    expect(passing[0]!.sharePct).toBe(67);
    expect(Math.round((8 / 12) * 100)).toBe(passing[0]!.sharePct);
  });

  it("drops a reader row that has no matching aggregate rows", () => {
    // Reader voted turn 2, but the day has no rows for turn 2 → omitted.
    const out = computeChoicePulse(
      [{ turnNumber: 2, choiceKey: "k" }],
      rowsAt(1, "k", 5, 10), // only turn 1 in the aggregate
    );
    expect(out).toEqual([]);
  });

  it("returns entries sorted ascending by turnNumber across multiple turns", () => {
    const readerRows = [
      { turnNumber: 3, choiceKey: "c3" },
      { turnNumber: 1, choiceKey: "c1" },
      { turnNumber: 2, choiceKey: "c2" },
    ];
    const allRows = [
      ...rowsAt(1, "c1", 7, 10), // 70% → well-worn
      ...rowsAt(2, "c2", 3, 10), // 30% → common thread
      ...rowsAt(3, "c3", 1, 20), // 5%  → road less traveled
    ];
    const out = computeChoicePulse(readerRows, allRows);
    expect(out.map((e) => e.turnNumber)).toEqual([1, 2, 3]);
    expect(out.map((e) => e.phrase)).toEqual([
      "the well-worn path",
      "a common thread",
      "the road less traveled",
    ]);
    expect(out.map((e) => e.sharePct)).toEqual([70, 30, 5]);
  });

  it("phrases a free-form own-bucket as 'wrote their own page'", () => {
    const out = computeChoicePulse(
      [{ turnNumber: 1, choiceKey: FREE_FORM_KEY }],
      rowsAt(1, FREE_FORM_KEY, 4, 10),
    );
    expect(out[0]!.phrase).toBe("wrote their own page");
    expect(out[0]!.sharePct).toBe(40);
  });

  it("carries ONLY aggregate counts — no foreign bucket key or label (BC10)", () => {
    const out = computeChoicePulse(
      [{ turnNumber: 1, choiceKey: "mine" }],
      [
        ...rowsAt(1, "mine", 3, 6),
        { turnNumber: 1, choiceKey: "secret-foreign-path" },
        { turnNumber: 1, choiceKey: "another-foreign-path" },
        ...rowsAt(1, "filler", 0, 2),
      ],
    );
    expect(out).toHaveLength(1);
    const entry = out[0]!;
    // Exactly the whitelisted keys — nothing that could leak another run's text.
    expect(Object.keys(entry).sort()).toEqual(
      ["phrase", "sameCount", "sharePct", "totalReaders", "turnNumber"].sort(),
    );
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("secret-foreign-path");
    expect(serialized).not.toContain("another-foreign-path");
    expect(serialized).not.toContain("mine"); // the reader's OWN key isn't echoed either
  });

  it("returns [] when the reader has no rows", () => {
    expect(computeChoicePulse([], rowsAt(1, "k", 5, 10))).toEqual([]);
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
      async patch(id: any, doc: Row) {
        for (const rows of Object.values(tables)) {
          const hit = rows.find((r) => String(r._id) === String(id));
          if (hit) {
            Object.assign(hit, doc);
            return;
          }
        }
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

// ---------------------------------------------------------------------------
// PURE: advanceDailyStreak (Panel-2 W3 daily streak)
// ---------------------------------------------------------------------------

describe("advanceDailyStreak (consecutive-day streak math)", () => {
  it("starts a fresh streak at 1 when there is no prior state", () => {
    const out = advanceDailyStreak(null, "2026-07-10");
    expect(out).toEqual({
      state: { current: 1, longest: 1, lastDate: "2026-07-10" },
      changed: true,
      incremented: true,
    });
  });

  it("increments on the very next calendar day", () => {
    const prev = { current: 3, longest: 3, lastDate: "2026-07-10" };
    const out = advanceDailyStreak(prev, "2026-07-11");
    expect(out.state).toEqual({ current: 4, longest: 4, lastDate: "2026-07-11" });
    expect(out.incremented).toBe(true);
  });

  it("is an idempotent no-op when the same day is folded in twice", () => {
    const prev = { current: 4, longest: 6, lastDate: "2026-07-11" };
    const out = advanceDailyStreak(prev, "2026-07-11");
    expect(out.changed).toBe(false);
    expect(out.incremented).toBe(false);
    expect(out.state).toEqual(prev);
  });

  it("resets current to 1 on a gap of two or more days, keeping longest", () => {
    const prev = { current: 5, longest: 5, lastDate: "2026-07-10" };
    const out = advanceDailyStreak(prev, "2026-07-13");
    expect(out.state).toEqual({ current: 1, longest: 5, lastDate: "2026-07-13" });
    expect(out.changed).toBe(true);
  });

  it("never rewinds on an out-of-order/backfilled older date", () => {
    const prev = { current: 5, longest: 5, lastDate: "2026-07-10" };
    const out = advanceDailyStreak(prev, "2026-07-08");
    expect(out.changed).toBe(false);
    expect(out.state).toEqual(prev);
  });

  it("keeps longest monotonic across a break-then-rebuild", () => {
    let s = advanceDailyStreak(null, "2026-07-01").state;
    s = advanceDailyStreak(s, "2026-07-02").state;
    s = advanceDailyStreak(s, "2026-07-03").state; // current 3, longest 3
    s = advanceDailyStreak(s, "2026-07-10").state; // gap → current 1
    expect(s.current).toBe(1);
    expect(s.longest).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Streak wiring: insertDailyResultIfAbsent advances daily_streaks + mints the
// 7-day keepsake; getToday / getStreak expose it. (Panel-2 W3)
// ---------------------------------------------------------------------------

/** A daily_tales row on a chosen date, id derived from the date for clarity. */
function dailyOn(date: string): Row {
  return { ...dailyRow(`daily_${date}`, date) };
}

/** Play (finish) the account's Daily for `date`; returns the hook outcome. */
async function finishDailyOn(
  ctx: any,
  date: string,
  accountId = "acct_1",
  finishedAt = epochDayFromISO(date) * 86_400_000 + 1000,
) {
  return insertDailyResultIfAbsent(ctx, {
    dailyId: `daily_${date}`,
    accountId,
    endingId: "safe-harbor",
    turnCount: 6,
    finishedAt,
  });
}

describe("daily streak wiring (Panel-2 W3)", () => {
  it("increments the account streak across consecutive Daily completions", async () => {
    const dates = ["2026-07-10", "2026-07-11", "2026-07-12"];
    const { ctx, tables } = makeCtx({
      tables: {
        daily_tales: dates.map(dailyOn),
        daily_results: [],
        daily_streaks: [],
        analytics_events: [],
      },
    });
    for (const d of dates) await finishDailyOn(ctx, d);
    expect(tables.daily_streaks).toHaveLength(1);
    expect(tables.daily_streaks![0]).toMatchObject({
      accountId: "acct_1",
      current: 3,
      longest: 3,
      lastDate: "2026-07-12",
    });
  });

  it("resets the streak after a missed day", async () => {
    const { ctx, tables } = makeCtx({
      tables: {
        daily_tales: ["2026-07-10", "2026-07-11", "2026-07-14"].map(dailyOn),
        daily_results: [],
        daily_streaks: [],
        analytics_events: [],
      },
    });
    await finishDailyOn(ctx, "2026-07-10");
    await finishDailyOn(ctx, "2026-07-11");
    await finishDailyOn(ctx, "2026-07-14");
    expect(tables.daily_streaks![0]).toMatchObject({ current: 1, longest: 2, lastDate: "2026-07-14" });
  });

  it("mints a 7-day Ember keepsake exactly at a 7-day streak", async () => {
    const dates = Array.from({ length: 7 }, (_, i) => `2026-07-${String(10 + i).padStart(2, "0")}`);
    const { ctx, tables } = makeCtx({
      tables: {
        daily_tales: dates.map(dailyOn),
        daily_results: [],
        daily_streaks: [],
        analytics_events: [],
      },
    });
    let last: any;
    for (const d of dates) last = await finishDailyOn(ctx, d);

    // The 7th completion returns the minted keepsake id.
    expect(last.streakMintedKeepsakeId).toBe("daily-streak-7");
    const row = tables.daily_streaks![0]!;
    expect(row.current).toBe(7);
    expect(row.keepsakes).toHaveLength(1);
    expect(row.keepsakes[0]).toMatchObject({ id: "daily-streak-7", label: "7-Day Ember" });

    // Only the milestone day mints — days 1–6 grant nothing.
    const granted = (tables.analytics_events ?? []).filter(
      (e: Row) => e.eventName === "keepsake.granted",
    );
    expect(granted).toHaveLength(1);
  });

  it("gives a guest the same account-scoped streak + keepsake (attach-on-claim, R13.4)", async () => {
    // Guests play under an accounts row; claim upgrades that SAME account in
    // place, so the streak keyed by accountId already belongs to the claimant.
    const dates = Array.from({ length: 7 }, (_, i) => `2026-07-${String(10 + i).padStart(2, "0")}`);
    const { ctx, tables } = makeCtx({
      tables: {
        accounts: [guestAccount("guest_acct")],
        daily_tales: dates.map(dailyOn),
        daily_results: [],
        daily_streaks: [],
        analytics_events: [],
      },
    });
    for (const d of dates) await finishDailyOn(ctx, d, "guest_acct");
    const row = tables.daily_streaks!.find((r: Row) => r.accountId === "guest_acct");
    expect(row).toBeTruthy();
    expect(row!.current).toBe(7);
    expect(row!.keepsakes[0]).toMatchObject({ id: "daily-streak-7" });
  });

  it("is idempotent — replaying the same day never double-counts the streak", async () => {
    const { ctx, tables } = makeCtx({
      tables: {
        daily_tales: [dailyOn("2026-07-10")],
        daily_results: [],
        daily_streaks: [],
        analytics_events: [],
      },
    });
    await finishDailyOn(ctx, "2026-07-10");
    await finishDailyOn(ctx, "2026-07-10");
    expect(tables.daily_streaks![0]).toMatchObject({ current: 1, longest: 1 });
    expect(tables.daily_results).toHaveLength(1);
  });
});

describe("getToday / getStreak expose the streak (Panel-2 W3)", () => {
  it("getToday returns a zeroed streak when the reader has none", async () => {
    const { ctx } = makeCtx({
      tables: { accounts: [guestAccount()], daily_tales: [dailyRow()], daily_streaks: [] },
    });
    const out = await (getToday as any)._handler(ctx, { accountId: "acct_1", guestTokenHash: "guest_hash" });
    expect(out.streak).toEqual(emptyStreak());
  });

  it("getToday reflects an existing streak record", async () => {
    const { ctx } = makeCtx({
      tables: {
        accounts: [guestAccount()],
        daily_tales: [dailyRow()],
        daily_streaks: [
          { accountId: "acct_1", current: 4, longest: 9, lastDate: "2026-07-11", keepsakes: [], updatedAt: 1 },
        ],
      },
    });
    const out = await (getToday as any)._handler(ctx, { accountId: "acct_1", guestTokenHash: "guest_hash" });
    expect(out.streak).toEqual({ current: 4, longest: 9, lastDate: "2026-07-11" });
  });

  it("getStreak returns the streak plus its minted keepsakes", async () => {
    const { ctx } = makeCtx({
      tables: {
        accounts: [guestAccount()],
        daily_streaks: [
          {
            accountId: "acct_1",
            current: 7,
            longest: 7,
            lastDate: "2026-07-16",
            keepsakes: [{ id: "daily-streak-7", label: "7-Day Ember", description: "A steady flame." }],
            updatedAt: 1,
          },
        ],
      },
    });
    const out = await (getStreak as any)._handler(ctx, { accountId: "acct_1", guestTokenHash: "guest_hash" });
    expect(out.streak).toEqual({ current: 7, longest: 7, lastDate: "2026-07-16" });
    expect(out.keepsakes).toHaveLength(1);
    expect(out.keepsakes[0].id).toBe("daily-streak-7");
  });
});
