// =============================================================================
// Daily Killcam — server helpers + query (daily-killcam tasks 2.1 / 2.2).
//
// Fake-ctx coverage for the DK-SERVER surface:
//   - recordDailyChoiceIfEligible: eligible insert, upsert-same-save patch,
//     fork no-op (DK6), cap / non-daily / authored / follower / no-choice
//     no-ops (R1.5), free-form key (DK4 — typed text never persisted),
//     swallowed throw (R1.1 / BC5), and the daily.choice_recorded analytics
//     payload (DK2 / R1.6).
//   - deleteDailyChoicesFromTurn: boundary delete + save scoping + swallow.
//   - getChoicePulse: authorization (getResults parity), own-bucket-only
//     payload (BC10 — asserts NO foreign keys/labels leave), threshold
//     omission (R2.2), and post-claim resolution (DK3).
//
// The pure math (choiceKeyForLabel / computeChoicePulse / phrase tiers) lives
// in convex/daily.ts (Agent DK-PURE) and is covered by daily.test.ts; here we
// only exercise the handler/helper wiring around it.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  FREE_FORM_KEY,
  KILLCAM_MIN_READERS,
} from "../daily";
import {
  deleteDailyChoicesFromTurn,
  getChoicePulse,
  recordDailyChoiceIfEligible,
} from "../dailyFunctions";

type AnyDoc = Record<string, any>;

// ---------------------------------------------------------------------------
// Fake ctx — an in-memory table store supporting the index reads the killcam
// helpers use (by_daily_account, by_daily_turn, by_save), plus insert / patch /
// delete / get and a configurable auth identity for the authorization tests.
// The query builder matches every `eq` constraint against row fields, so it
// stands in for both a real single-field index and a compound one.
// ---------------------------------------------------------------------------
function makeCtx(
  seed: {
    daily_choice_results?: AnyDoc[];
    accounts?: AnyDoc[];
    analytics_events?: AnyDoc[];
    identity?: { subject?: string; email?: string | null } | null;
  } = {},
) {
  const tables: Record<string, AnyDoc[]> = {
    daily_choice_results: seed.daily_choice_results ?? [],
    accounts: seed.accounts ?? [],
    analytics_events: seed.analytics_events ?? [],
  };
  let n = 0;
  let insertThrows = false;

  const ctx = {
    db: {
      query(table: string) {
        const rows = tables[table] ?? [];
        const constraints: Array<[string, unknown]> = [];
        const q = {
          eq(field: string, value: unknown) {
            constraints.push([field, value]);
            return q;
          },
        };
        const match = () =>
          rows.filter((row) => constraints.every(([f, val]) => row[f] === val));
        const chain = {
          withIndex(_name: string, build?: (qq: any) => any) {
            if (build) build(q);
            return chain;
          },
          async first() {
            return match()[0] ?? null;
          },
          async collect() {
            return match();
          },
        };
        return chain;
      },
      async insert(table: string, doc: AnyDoc) {
        if (insertThrows) throw new Error("boom");
        const _id = `${table}_${++n}`;
        const row = { _id, ...doc };
        (tables[table] ??= []).push(row);
        return _id;
      },
      async patch(id: any, doc: AnyDoc) {
        const row = Object.values(tables)
          .flat()
          .find((r) => r._id === id);
        if (row) Object.assign(row, doc);
      },
      async delete(id: any) {
        for (const key of Object.keys(tables)) {
          tables[key] = tables[key]!.filter((r) => r._id !== id);
        }
      },
      async get(id: any) {
        return (
          Object.values(tables)
            .flat()
            .find((r) => r._id === id) ?? null
        );
      },
    },
    auth: {
      async getUserIdentity() {
        return seed.identity ?? null;
      },
    },
  };
  return {
    ctx,
    tables,
    breakInserts() {
      insertThrows = true;
    },
  };
}

function baseInput() {
  return {
    dailyId: "daily-2026-07-20",
    accountId: "acct1",
    saveId: "save1",
    turnNumber: 1,
    choiceLabel: "Answer the signal!",
    now: 1_700_000_000_000,
  };
}

// ---------------------------------------------------------------------------
// recordDailyChoiceIfEligible
// ---------------------------------------------------------------------------
describe("recordDailyChoiceIfEligible (daily-killcam R1)", () => {
  it("inserts one row with the normalized choiceKey on an eligible early turn", async () => {
    const { ctx, tables } = makeCtx();
    const out = await recordDailyChoiceIfEligible(ctx, baseInput());

    expect(out.recorded).toBe(true);
    expect(tables.daily_choice_results).toHaveLength(1);
    const row = tables.daily_choice_results![0]!;
    expect(row).toMatchObject({
      dailyId: "daily-2026-07-20",
      accountId: "acct1",
      saveId: "save1",
      turnNumber: 1,
      choiceKey: "answer-the-signal", // trim/lowercase/strip-punct/slugify
      freeForm: false,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
  });

  it("fires daily.choice_recorded with the design payload (dailyId, turnNumber, choiceKey, freeForm)", async () => {
    const { ctx, tables } = makeCtx();
    await recordDailyChoiceIfEligible(ctx, baseInput());

    expect(tables.analytics_events).toHaveLength(1);
    const evt = tables.analytics_events![0]!;
    expect(evt.eventName).toBe("daily.choice_recorded");
    expect(evt.accountId).toBe("acct1");
    expect(evt.saveId).toBe("save1");
    expect(evt.payload).toEqual({
      dailyId: "daily-2026-07-20",
      turnNumber: 1,
      choiceKey: "answer-the-signal",
      freeForm: false,
    });
  });

  it("records the reserved free-form key and NEVER persists the typed text (DK4)", async () => {
    const { ctx, tables } = makeCtx();
    const typed = "I slip a coded note under the door for the courier";
    const out = await recordDailyChoiceIfEligible(ctx, {
      ...baseInput(),
      choiceLabel: typed,
      freeForm: true,
    });

    expect(out.recorded).toBe(true);
    const row = tables.daily_choice_results![0]!;
    expect(row.choiceKey).toBe(FREE_FORM_KEY);
    expect(row.freeForm).toBe(true);
    // The reader's typed action is not stored anywhere on the row (privacy +
    // spoilers): no field carries it, and the key is the reserved slug.
    expect(JSON.stringify(row)).not.toContain("courier");
    expect(JSON.stringify(row)).not.toContain(typed);
    // Analytics likewise carries only the reserved key, never the text.
    expect(JSON.stringify(tables.analytics_events)).not.toContain("courier");
  });

  it("upserts by (dailyId, accountId, turnNumber): a same-save replay replaces the bucket", async () => {
    const { ctx, tables } = makeCtx();
    await recordDailyChoiceIfEligible(ctx, baseInput());
    // Rewind → re-choose the same turn with a different label, same save.
    const out = await recordDailyChoiceIfEligible(ctx, {
      ...baseInput(),
      choiceLabel: "Row toward the dark",
      now: 1_700_000_009_999,
    });

    expect(out.recorded).toBe(true);
    expect(tables.daily_choice_results).toHaveLength(1); // still one vote per turn
    const row = tables.daily_choice_results![0]!;
    expect(row.choiceKey).toBe("row-toward-the-dark");
    expect(row.createdAt).toBe(1_700_000_000_000); // original create preserved
    expect(row.updatedAt).toBe(1_700_000_009_999); // bumped
  });

  it("does NOT overwrite a row voted by a different save — the first daily run wins (DK6 fork guard)", async () => {
    const seededRow = {
      _id: "daily_choice_results_pre",
      dailyId: "daily-2026-07-20",
      accountId: "acct1",
      saveId: "original-save",
      turnNumber: 1,
      choiceKey: "answer-the-signal",
      freeForm: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const { ctx, tables } = makeCtx({ daily_choice_results: [seededRow] });
    // A forked copy of the daily save (different saveId) replays turn 1.
    const out = await recordDailyChoiceIfEligible(ctx, {
      ...baseInput(),
      saveId: "forked-save",
      choiceLabel: "Row toward the dark",
    });

    expect(out.recorded).toBe(false);
    expect(tables.daily_choice_results).toHaveLength(1);
    expect(tables.daily_choice_results![0]!.saveId).toBe("original-save");
    expect(tables.daily_choice_results![0]!.choiceKey).toBe("answer-the-signal");
    expect(tables.analytics_events).toHaveLength(0); // no vote, no event
  });

  it("no-ops past the turn cap", async () => {
    const { ctx, tables } = makeCtx();
    const out = await recordDailyChoiceIfEligible(ctx, { ...baseInput(), turnNumber: 4 });
    expect(out.recorded).toBe(false);
    expect(tables.daily_choice_results).toHaveLength(0);
    expect(tables.analytics_events).toHaveLength(0);
  });

  it("no-ops on a non-daily save (no dailyId), authored save, and co-op follower", async () => {
    const { ctx, tables } = makeCtx();
    const { dailyId: _omit, ...nonDaily } = baseInput();
    expect((await recordDailyChoiceIfEligible(ctx, nonDaily)).recorded).toBe(false);
    expect((await recordDailyChoiceIfEligible(ctx, { ...baseInput(), dailyId: "  " })).recorded).toBe(false);
    expect((await recordDailyChoiceIfEligible(ctx, { ...baseInput(), isAuthored: true })).recorded).toBe(false);
    expect((await recordDailyChoiceIfEligible(ctx, { ...baseInput(), isFollower: true })).recorded).toBe(false);
    expect(tables.daily_choice_results).toHaveLength(0);
  });

  it("no-ops when no choice is present (empty label, not free-form)", async () => {
    const { ctx, tables } = makeCtx();
    const out = await recordDailyChoiceIfEligible(ctx, { ...baseInput(), choiceLabel: "   " });
    expect(out.recorded).toBe(false);
    expect(tables.daily_choice_results).toHaveLength(0);
  });

  it("swallows a thrown db error — a killcam failure never fails the turn (R1.1 / BC5)", async () => {
    const harness = makeCtx();
    harness.breakInserts();
    // Must resolve (not reject) with recorded:false; the turn proceeds.
    await expect(recordDailyChoiceIfEligible(harness.ctx, baseInput())).resolves.toEqual({
      recorded: false,
    });
    expect(harness.tables.daily_choice_results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// deleteDailyChoicesFromTurn
// ---------------------------------------------------------------------------
describe("deleteDailyChoicesFromTurn (daily-killcam R1.4)", () => {
  function rows(): AnyDoc[] {
    return [
      { _id: "r1", saveId: "save1", turnNumber: 1, dailyId: "d", accountId: "a", choiceKey: "k1" },
      { _id: "r2", saveId: "save1", turnNumber: 2, dailyId: "d", accountId: "a", choiceKey: "k2" },
      { _id: "r3", saveId: "save1", turnNumber: 3, dailyId: "d", accountId: "a", choiceKey: "k3" },
      { _id: "r-other", saveId: "save2", turnNumber: 2, dailyId: "d", accountId: "b", choiceKey: "k4" },
    ];
  }

  it("deletes this save's rows at or after fromTurnNumber and keeps earlier ones", async () => {
    const { ctx, tables } = makeCtx({ daily_choice_results: rows() });
    const out = await deleteDailyChoicesFromTurn(ctx, "save1", 2);

    expect(out.deleted).toBe(2); // turns 2 and 3 of save1
    const remaining = tables.daily_choice_results!.map((r) => r._id).sort();
    expect(remaining).toEqual(["r-other", "r1"]); // turn 1 kept, other save untouched
  });

  it("only touches the given save (by_save scoping)", async () => {
    const { ctx, tables } = makeCtx({ daily_choice_results: rows() });
    await deleteDailyChoicesFromTurn(ctx, "save1", 1);
    // save2's row survives even though its turnNumber (2) ≥ fromTurn.
    expect(tables.daily_choice_results!.map((r) => r._id)).toEqual(["r-other"]);
  });

  it("swallows failures — never fails the rewind (BC5)", async () => {
    const badCtx = {
      db: {
        query() {
          throw new Error("boom");
        },
        async delete() {},
      },
    } as any;
    await expect(deleteDailyChoicesFromTurn(badCtx, "save1", 1)).resolves.toEqual({ deleted: 0 });
  });
});

// ---------------------------------------------------------------------------
// getChoicePulse
// ---------------------------------------------------------------------------
const DAILY_ID = "daily_tales_1";
const GUEST = { _id: "acct-guest", kind: "guest", guestTokenHash: "gt-secret" };

/** Build `count` foreign rows at a turn with a DISTINCT foreign choiceKey. */
function foreignRows(turnNumber: number, choiceKey: string, count: number, startId: number): AnyDoc[] {
  return Array.from({ length: count }, (_v, i) => ({
    _id: `f_${startId + i}`,
    dailyId: DAILY_ID,
    accountId: `other-${startId + i}`,
    saveId: `other-save-${startId + i}`,
    turnNumber,
    choiceKey,
    freeForm: false,
    createdAt: 1,
    updatedAt: 1,
  }));
}

describe("getChoicePulse (daily-killcam R2)", () => {
  it("rejects a caller who cannot prove ownership (getResults authorization parity)", async () => {
    const { ctx } = makeCtx({ accounts: [GUEST] });
    await expect(
      (getChoicePulse as any)._handler(ctx as any, {
        dailyId: DAILY_ID as any,
        accountId: "acct-guest" as any,
        guestTokenHash: "wrong-token",
      }),
    ).rejects.toBeTruthy();
  });

  it("returns ONLY the reader's own bucket per turn — no foreign keys/labels leak (BC10)", async () => {
    // Reader chose "answer-the-signal" at turn 1; the day splits across three
    // distinct foreign keys the reader must NEVER see.
    const readerRow = {
      _id: "mine",
      dailyId: DAILY_ID,
      accountId: "acct-guest",
      saveId: "my-save",
      turnNumber: 1,
      choiceKey: "answer-the-signal",
      freeForm: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const day = [
      readerRow,
      ...foreignRows(1, "answer-the-signal", 5, 100), // 6 total share reader's key
      ...foreignRows(1, "row-toward-the-dark", 3, 200),
      ...foreignRows(1, "wait-on-the-shore", 4, 300),
    ]; // 13 readers at turn 1 (≥ floor)
    const { ctx } = makeCtx({ accounts: [GUEST], daily_choice_results: day });

    const out = await (getChoicePulse as any)._handler(ctx as any, {
      dailyId: DAILY_ID as any,
      accountId: "acct-guest" as any,
      guestTokenHash: "gt-secret",
    });

    expect(out.pulses).toHaveLength(1);
    // 4.3 — the reader's OWN daily save id (anchor of their winning run) rides
    // alongside the pulses so the results route can fetch their own labels.
    expect(out.readerSaveId).toBe("my-save");
    const entry = out.pulses[0]!;
    expect(entry.turnNumber).toBe(1);
    expect(entry.totalReaders).toBe(13);
    expect(entry.sameCount).toBe(6);
    expect(entry.sharePct).toBe(Math.round((6 / 13) * 100)); // server-computed (DK5)
    // BC10: the wire payload carries ONLY aggregate numbers + a phrase — no
    // choiceKey field at all, and none of the foreign bucket keys anywhere.
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("choiceKey");
    expect(serialized).not.toContain("answer-the-signal");
    expect(serialized).not.toContain("row-toward-the-dark");
    expect(serialized).not.toContain("wait-on-the-shore");
    expect(Object.keys(entry).sort()).toEqual(
      ["phrase", "sameCount", "sharePct", "totalReaders", "turnNumber"].sort(),
    );
  });

  it("omits a turn entirely when it is under the reader floor (R2.2 silence)", async () => {
    const readerRow = {
      _id: "mine",
      dailyId: DAILY_ID,
      accountId: "acct-guest",
      saveId: "my-save",
      turnNumber: 1,
      choiceKey: "answer-the-signal",
      freeForm: false,
      createdAt: 1,
      updatedAt: 1,
    };
    // Only 5 readers total at turn 1 — below KILLCAM_MIN_READERS (10).
    const day = [readerRow, ...foreignRows(1, "answer-the-signal", 4, 400)];
    expect(day.length).toBeLessThan(KILLCAM_MIN_READERS);
    const { ctx } = makeCtx({ accounts: [GUEST], daily_choice_results: day });

    const out = await (getChoicePulse as any)._handler(ctx as any, {
      dailyId: DAILY_ID as any,
      accountId: "acct-guest" as any,
      guestTokenHash: "gt-secret",
    });
    expect(out.pulses).toEqual([]);
    // 4.3 — readerSaveId is independent of the floor: the reader HAS a row, so
    // their own save id is still returned even though no bucket qualifies.
    expect(out.readerSaveId).toBe("my-save");
  });

  it("returns the EARLIEST-turn save id as readerSaveId (winning-run anchor, 4.3)", async () => {
    // The reader recorded turns 1 and 2 from the same winning run; a later forked
    // copy could only add rows the first run lacked, so anchoring on the earliest
    // turn's saveId identifies the run whose history holds the reader's labels.
    const day = [
      { _id: "r2", dailyId: DAILY_ID, accountId: "acct-guest", saveId: "winning-run", turnNumber: 2, choiceKey: "k2", freeForm: false, createdAt: 2, updatedAt: 2 },
      { _id: "r1", dailyId: DAILY_ID, accountId: "acct-guest", saveId: "winning-run", turnNumber: 1, choiceKey: "k1", freeForm: false, createdAt: 1, updatedAt: 1 },
    ];
    const { ctx } = makeCtx({ accounts: [GUEST], daily_choice_results: day });
    const out = await (getChoicePulse as any)._handler(ctx as any, {
      dailyId: DAILY_ID as any,
      accountId: "acct-guest" as any,
      guestTokenHash: "gt-secret",
    });
    expect(out.readerSaveId).toBe("winning-run");
  });

  it("returns readerSaveId=null when the reader has no recorded rows (strip hides)", async () => {
    const { ctx } = makeCtx({ accounts: [GUEST], daily_choice_results: [] });
    const out = await (getChoicePulse as any)._handler(ctx as any, {
      dailyId: DAILY_ID as any,
      accountId: "acct-guest" as any,
      guestTokenHash: "gt-secret",
    });
    expect(out.pulses).toEqual([]);
    expect(out.readerSaveId).toBeNull();
  });

  it("resolves identically after guest→account claim — rows keyed by stable accountId (DK3)", async () => {
    const readerRow = {
      _id: "mine",
      dailyId: DAILY_ID,
      accountId: "acct-guest", // stable across claim
      saveId: "my-save",
      turnNumber: 1,
      choiceKey: "answer-the-signal",
      freeForm: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const day = [readerRow, ...foreignRows(1, "answer-the-signal", 5, 500), ...foreignRows(1, "other", 6, 600)];

    // Before claim: a guest account.
    const before = makeCtx({ accounts: [GUEST], daily_choice_results: day });
    const outGuest = await (getChoicePulse as any)._handler(before.ctx as any, {
      dailyId: DAILY_ID as any,
      accountId: "acct-guest" as any,
      guestTokenHash: "gt-secret",
    });

    // After claimGuest PATCHES the SAME row in place: kind→user, userId set,
    // guestTokenHash retained (real sign-in not yet wired). Same _id, same rows.
    const claimed = { _id: "acct-guest", kind: "user", userId: "me@example.com", guestTokenHash: "gt-secret" };
    const after = makeCtx({ accounts: [claimed], daily_choice_results: day, identity: null });
    const outUser = await (getChoicePulse as any)._handler(after.ctx as any, {
      dailyId: DAILY_ID as any,
      accountId: "acct-guest" as any,
      guestTokenHash: "gt-secret",
    });

    expect(outUser).toEqual(outGuest);
    expect(outUser.pulses[0]!.sameCount).toBe(6);
    expect(outUser.pulses[0]!.totalReaders).toBe(12);
  });
});
