// Test for the consumeTurn-vs-userText-validation ordering bug in
// `convex/game.ts:beginStreamingChoice` (Fix 2).
//
// Previously `consumeTurn` ran BEFORE the free-form text was validated, so
// an empty / too-long / policy-blocked typed action still decremented the
// reader's daily turn budget. The fix flips the order: validate first,
// consume only after every gate passes.
//
// This test exercises the handler with a hand-built ctx mock and the
// "open-canvas" llm-driven starter story (so we hit the free-form code
// path), asserts the empty-text submission throws `freeform_text_empty`,
// and confirms no `daily_turn_counter` row was inserted/patched.

import { describe, expect, it } from "vitest";

import { beginStreamingChoice } from "../game";

type Insert = { table: string; doc: any; id: string };
type Patch = { id: string; patch: any };

function makeOpenCanvasSaveDoc(): Record<string, unknown> {
  // Minimal save-doc shape just sufficient for the handler's read path.
  return {
    _id: "save_1",
    accountId: "acct_1",
    storyId: "open-canvas",
    mode: "story",
    status: "active",
    engineVersion: 2,
    storyVersion: 1,
    state: {
      storyId: "open-canvas",
      mode: "story",
      vitality: 5,
      currency: 0,
      attributes: {},
      inventory: [],
      flags: {},
      currentNodeId: "start",
      turnNumber: 0,
      path: ["start"],
      delayed: [],
      endingsUnlocked: {},
      npcs: {},
      schemaVersion: 2,
    },
    currentNodeId: "start",
    turnNumber: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeAccountDoc(): Record<string, unknown> {
  return {
    _id: "acct_1",
    kind: "guest",
    ageBand: "18+",
    matureContentEnabled: false,
    guestTokenHash: "guest_hash",
    lastActiveAt: 1,
    createdAt: 1,
  };
}

function makeCtx(input: {
  save: Record<string, unknown>;
  account: Record<string, unknown>;
  existingDailyCounter?: Record<string, unknown> | null;
  entitlement?: Record<string, unknown> | null;
}) {
  const docs = new Map<string, Record<string, unknown>>();
  docs.set(String(input.save._id), input.save);
  docs.set(String(input.account._id), input.account);
  const inserted: Insert[] = [];
  const patches: Patch[] = [];
  let nextId = 1;

  const ctx = {
    db: {
      async get(id: any) {
        return docs.get(String(id)) ?? null;
      },
      query(table: string) {
        const rows: Record<string, unknown>[] =
          table === "daily_turn_counter"
            ? (input.existingDailyCounter ? [input.existingDailyCounter] : [])
            : table === "entitlements"
              ? (input.entitlement ? [input.entitlement] : [])
              : [];
        const chain = {
          withIndex(_name: string, _build: (q: any) => any) {
            return chain;
          },
          filter(_build: (q: any) => any) {
            return chain;
          },
          async first() {
            return rows[0] ?? null;
          },
          async collect() {
            return rows;
          },
        };
        return chain;
      },
      async insert(table: string, doc: any) {
        const id = `${table}_${nextId++}`;
        inserted.push({ table, doc, id });
        return id;
      },
      async patch(id: any, patch: any) {
        patches.push({ id: String(id), patch });
        const existing = docs.get(String(id));
        if (existing) docs.set(String(id), { ...existing, ...patch });
      },
    },
  };
  return { ctx, inserted, patches };
}

describe("beginStreamingChoice — free-form validation order", () => {
  it("does NOT consume a turn when userText is empty", async () => {
    const { ctx, inserted, patches } = makeCtx({
      save: makeOpenCanvasSaveDoc(),
      account: makeAccountDoc(),
      existingDailyCounter: null,
      entitlement: null,
    });

    await expect(
      (beginStreamingChoice as any)._handler(ctx, {
        accountId: "acct_1",
        guestTokenHash: "guest_hash",
        saveId: "save_1",
        choiceId: "freeform",
        requestId: "req_1",
        userText: "   ",
      }),
    ).rejects.toThrow(/freeform_text_empty/);

    // No daily_turn_counter row should exist after a rejected typed action.
    const dailyInserts = inserted.filter((row) => row.table === "daily_turn_counter");
    expect(dailyInserts).toHaveLength(0);
    const dailyPatches = patches.filter((row) => row.id.startsWith("daily_turn_counter"));
    expect(dailyPatches).toHaveLength(0);
  });

  it("does NOT consume a turn when userText is too long", async () => {
    const { ctx, inserted, patches } = makeCtx({
      save: makeOpenCanvasSaveDoc(),
      account: makeAccountDoc(),
      existingDailyCounter: null,
      entitlement: null,
    });

    await expect(
      (beginStreamingChoice as any)._handler(ctx, {
        accountId: "acct_1",
        guestTokenHash: "guest_hash",
        saveId: "save_1",
        choiceId: "freeform",
        requestId: "req_2",
        userText: "x".repeat(201),
      }),
    ).rejects.toThrow(/freeform_text_too_long/);

    expect(inserted.filter((row) => row.table === "daily_turn_counter")).toHaveLength(0);
    expect(patches.filter((row) => row.id.startsWith("daily_turn_counter"))).toHaveLength(0);
  });
});
