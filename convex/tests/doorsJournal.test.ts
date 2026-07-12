// DOORS-JOURNAL tests (convex/llm/storyBible.ts — the reader-facing half of
// the story-bible fetch-quest loop):
//   1. projectDoorsJournal (pure): the BC10 "seen" gate — only promised/
//      adopted (gate-rendered) keys and opened doors project; state tracks
//      teased → key-in-hand → opened.
//   2. The spoiler test: the projection's serialized output can NEVER carry
//      registry keys not yet gated on-screen, surfaceBands/gateBands, unfired
//      lockPlan doors, opensHints of unseen keys, twists, ending hints,
//      motifs, ids, or turn bookkeeping.
//   3. getDoorsJournal query against a hand-built ctx mock: auth gates
//      (save_not_found / save_forbidden / session), bible-less → [] (BC9).

import { describe, expect, it } from "vitest";

import type { StoryBible } from "@cyoa/engine";

import {
  getDoorsJournal,
  projectDoorsJournal,
  type DoorsJournalEntry,
} from "../llm/storyBible";

/**
 * A mid-run bible: one promised key with a planned door (teased), one granted
 * key with an opened door, one adopted key with no door, one granted-without-
 * promise key behind an opened door, and a fully UNSEEN remainder (planned
 * keys, a planned door, twists, ending hints, motifs) that must never leak.
 */
function journalBibleFixture(): StoryBible {
  return {
    keyRegistry: [
      {
        id: "bone-key",
        label: "the Bone Key",
        opensHint: "opens the crypt gate",
        surfaceBand: "early",
        status: "promised",
        promisedAtTurn: 4,
      },
      {
        id: "ferry-token",
        label: "a ferryman's token",
        opensHint: "passage across",
        surfaceBand: "mid",
        status: "granted",
        promisedAtTurn: 3,
        grantedAtTurn: 6,
      },
      // Adopted (hallucinated-gate) key, since granted — no lockPlan door.
      {
        id: "night-pass",
        label: "Night Pass",
        opensHint: "shown at the curfew chain",
        surfaceBand: "mid",
        status: "granted",
        promisedAtTurn: 5,
        grantedAtTurn: 8,
        adopted: true,
      },
      // Granted with NO promise: its gate never rendered — key invisible, but
      // its OPENED door still journals (label only, empty hint).
      {
        id: "salt-lamp",
        label: "a salt lamp",
        opensHint: "lights the under-stair",
        surfaceBand: "mid",
        status: "granted",
        grantedAtTurn: 2,
      },
      // UNSEEN: planned, never promised — invisible in every field.
      {
        id: "iron-writ",
        label: "the Iron Writ",
        opensHint: "commands the gate guard",
        surfaceBand: "late",
        status: "planned",
      },
      // Defensive: retired entries never journal even with a stale stamp.
      {
        id: "wax-seal",
        label: "a broken wax seal",
        opensHint: "once sealed the archive",
        surfaceBand: "mid",
        status: "retired",
        promisedAtTurn: 2,
      },
    ],
    lockPlan: [
      {
        id: "crypt-gate",
        label: "the crypt gate",
        keyId: "bone-key",
        gateBand: "mid",
        note: "under the chapel",
        status: "planned",
      },
      {
        id: "ferry-chain",
        label: "the ferry chain",
        keyId: "ferry-token",
        gateBand: "mid",
        note: "the ferryman waits",
        status: "opened",
      },
      {
        id: "under-stair",
        label: "the under-stair dark",
        keyId: "salt-lamp",
        gateBand: "mid",
        note: "no light reaches",
        status: "opened",
      },
      // UNSEEN: planned door whose key was never promised — invisible.
      {
        id: "guard-post",
        label: "the gate guard's post",
        keyId: "iron-writ",
        gateBand: "late",
        note: "the writ commands him",
        status: "planned",
      },
    ],
    cast: [
      {
        id: "mira",
        label: "Mira, ferrywoman",
        want: "passage north",
        secret: "deserted the Iron Court",
        bondHint: "pay her fare honestly",
        appearance: "weathered woman, oilskin coat, grey braid",
      },
    ],
    twists: [
      {
        id: "drowned-bell",
        label: "the Drowned Bell",
        precondition: "reader trusts the ferryman",
        status: "pending",
      },
    ],
    endingHints: [{ endingId: "the-salt-throne", requires: "hold the Iron Writ" }],
    motifs: ["salt", "bells underwater"],
    source: "llm",
    version: 1,
  };
}

describe("projectDoorsJournal (BC10 seen-gate)", () => {
  it("projects only gate-rendered keys and opened doors, with the right states", () => {
    const entries = projectDoorsJournal(journalBibleFixture());
    expect(entries).toEqual([
      // Promised key + planned door → teased, door label leads.
      { label: "the crypt gate", hint: "opens the crypt gate", state: "teased" },
      // Promised-then-granted key + opened door → opened.
      { label: "the ferry chain", hint: "passage across", state: "opened" },
      // Adopted key with no lockPlan door → key label carries the entry.
      { label: "Night Pass", hint: "shown at the curfew chain", state: "key-in-hand" },
      // Opened door whose key was never promised → label only, no hint.
      { label: "the under-stair dark", hint: "", state: "opened" },
    ]);
  });

  it("reports key-in-hand for a promised key granted before its door opens", () => {
    const bible = journalBibleFixture();
    const key = bible.keyRegistry.find((k) => k.id === "bone-key")!;
    key.status = "granted";
    key.grantedAtTurn = 7;
    const entry = projectDoorsJournal(bible).find((e) => e.label === "the crypt gate");
    expect(entry).toEqual({
      label: "the crypt gate",
      hint: "opens the crypt gate",
      state: "key-in-hand",
    });
  });

  it("skips retired doors when picking the entry label", () => {
    const bible = journalBibleFixture();
    bible.lockPlan[0]!.status = "retired";
    const entry = projectDoorsJournal(bible).find((e) => e.hint === "opens the crypt gate");
    // The only door for bone-key retired → the key's own label carries it.
    expect(entry).toEqual({
      label: "the Bone Key",
      hint: "opens the crypt gate",
      state: "teased",
    });
  });

  it("projects an empty journal for a null (bible-less) bible — BC9", () => {
    expect(projectDoorsJournal(null)).toEqual([]);
  });

  it("SPOILER TEST: forbidden fields and unseen plan entries never appear", () => {
    const entries = projectDoorsJournal(journalBibleFixture());
    // Shape: exactly {label, hint, state} — no ids, bands, turns, statuses.
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(["hint", "label", "state"]);
    }
    const serialized = JSON.stringify(entries);
    const forbidden = [
      // Structural bookkeeping (BC10: never hidden numbers/unfired content).
      "surfaceBand",
      "gateBand",
      "keyId",
      "opensHint",
      "promisedAtTurn",
      "grantedAtTurn",
      "status",
      // Unseen registry key (planned, never gated on-screen).
      "iron-writ",
      "the Iron Writ",
      "commands the gate guard",
      // Retired key with a stale promise stamp.
      "a broken wax seal",
      // Unrendered lockPlan door + its planner note.
      "the gate guard's post",
      "the writ commands him",
      // Planner notes of rendered doors (never shown to the reader).
      "under the chapel",
      "the ferryman waits",
      // Hint of the never-promised (unseen) key behind an opened door.
      "lights the under-stair",
      // Cast secrets, twists, ending hints, motifs — server-only forever.
      "deserted the Iron Court",
      "the Drowned Bell",
      "reader trusts the ferryman",
      "the-salt-throne",
      "hold the Iron Writ",
      "bells underwater",
    ];
    for (const text of forbidden) {
      expect(serialized).not.toContain(text);
    }
  });
});

// ---------------------------------------------------------------------------
// getDoorsJournal query — hand-built ctx mock (mirrors storyBible.test.ts).
// ---------------------------------------------------------------------------

type MockCtxInput = {
  save?: Record<string, unknown> | null;
  account?: Record<string, unknown> | null;
  bibleRow?: Record<string, unknown> | null;
};

function makeQueryCtx(input: MockCtxInput = {}) {
  const save =
    input.save === undefined ? { _id: "save_1", accountId: "acct_1" } : input.save;
  const account =
    input.account === undefined
      ? { _id: "acct_1", kind: "guest", guestTokenHash: "tok" }
      : input.account;
  const bibleRow = input.bibleRow === undefined ? null : input.bibleRow;
  return {
    db: {
      async get(id: string) {
        if (id === "save_1") return save;
        if (id === "acct_1") return account;
        return null;
      },
      query(_table: string) {
        const chain = {
          withIndex: () => chain,
          async first() {
            return bibleRow;
          },
        };
        return chain;
      },
    },
    auth: {
      async getUserIdentity() {
        return null;
      },
    },
  } as any;
}

const QUERY_ARGS = { accountId: "acct_1", saveId: "save_1", guestTokenHash: "tok" };

describe("getDoorsJournal query", () => {
  it("returns the seen-only journal for an owned save with a ready bible", async () => {
    const ctx = makeQueryCtx({
      bibleRow: { _id: "bible_1", status: "ready", bible: journalBibleFixture() },
    });
    const entries: DoorsJournalEntry[] = await (getDoorsJournal as any)._handler(
      ctx,
      QUERY_ARGS,
    );
    expect(entries).toHaveLength(4);
    expect(entries[0]).toEqual({
      label: "the crypt gate",
      hint: "opens the crypt gate",
      state: "teased",
    });
  });

  it("returns [] when the bible row is absent or not ready (BC9 zero-state)", async () => {
    await expect(
      (getDoorsJournal as any)._handler(makeQueryCtx({ bibleRow: null }), QUERY_ARGS),
    ).resolves.toEqual([]);
    await expect(
      (getDoorsJournal as any)._handler(
        makeQueryCtx({ bibleRow: { _id: "bible_1", status: "generating" } }),
        QUERY_ARGS,
      ),
    ).resolves.toEqual([]);
  });

  it("returns [] when the ready row's bible JSON is unreadable", async () => {
    const ctx = makeQueryCtx({
      bibleRow: { _id: "bible_1", status: "ready", bible: { keyRegistry: "nope" } },
    });
    await expect((getDoorsJournal as any)._handler(ctx, QUERY_ARGS)).resolves.toEqual([]);
  });

  it("rejects a missing save, a foreign save, and a bad session", async () => {
    await expect(
      (getDoorsJournal as any)._handler(makeQueryCtx({ save: null }), QUERY_ARGS),
    ).rejects.toMatchObject({ code: "save_not_found" });
    await expect(
      (getDoorsJournal as any)._handler(
        makeQueryCtx({ save: { _id: "save_1", accountId: "acct_other" } }),
        QUERY_ARGS,
      ),
    ).rejects.toMatchObject({ code: "save_forbidden" });
    await expect(
      (getDoorsJournal as any)._handler(makeQueryCtx(), {
        ...QUERY_ARGS,
        guestTokenHash: "wrong-token",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
