// SERVER-half push tests (candle re-lights). Drives the registered handlers
// against an in-memory ctx mock + a stubbed Expo fetch. Covers: token store /
// re-point / junk rejection, the send action (POST shape, no-token no-op,
// tolerant-on-throw, DeviceNotRegistered pruning), guttered-candle selection,
// and the cron fan-out.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCandleRelightMessages,
  chunk,
  getAccountPushTokens,
  isExpoPushToken,
  notifyGutteredCandles,
  registerPushToken,
  removePushToken,
  selectGutteredCandleAccounts,
  sendCandleRelightPush,
  sendExpoPush,
  EXPO_PUSH_ENDPOINT,
  CANDLE_RELIGHT_TITLE,
  CANDLE_RELIGHT_BODY,
} from "../pushNotifications";

type AnyDoc = Record<string, any>;
const TOKEN = "ExponentPushToken[abc123]";
const TOKEN_2 = "ExpoPushToken[def456]";

// --- in-memory ctx --------------------------------------------------------
// Supports get / insert / patch / delete and query().withIndex(eq…).first()/
// collect()/take(). Index name is ignored; the eq() constraints scope rows.
function makeCtx(seed: Record<string, AnyDoc[]> = {}) {
  const tables = new Map<string, AnyDoc[]>();
  const idToTable = new Map<string, string>();
  let counter = 0;
  for (const [table, rows] of Object.entries(seed)) {
    const copy = rows.map((r) => ({ ...r }));
    tables.set(table, copy);
    for (const r of copy) idToTable.set(String(r._id), table);
  }
  const db = {
    async get(id: any) {
      const table = idToTable.get(String(id));
      if (!table) return null;
      return tables.get(table)!.find((r) => String(r._id) === String(id)) ?? null;
    },
    async insert(table: string, doc: AnyDoc) {
      const _id = `${table}_${++counter}`;
      const row = { _id, ...doc };
      if (!tables.has(table)) tables.set(table, []);
      tables.get(table)!.push(row);
      idToTable.set(_id, table);
      return _id;
    },
    async patch(id: any, patch: AnyDoc) {
      const table = idToTable.get(String(id));
      if (!table) return;
      const row = tables.get(table)!.find((r) => String(r._id) === String(id));
      if (row) Object.assign(row, patch);
    },
    async delete(id: any) {
      const table = idToTable.get(String(id));
      if (!table) return;
      const rows = tables.get(table)!;
      const idx = rows.findIndex((r) => String(r._id) === String(id));
      if (idx >= 0) rows.splice(idx, 1);
      idToTable.delete(String(id));
    },
    query(table: string) {
      const eqs: Array<[string, unknown]> = [];
      const q = {
        eq(field: string, value: unknown) {
          eqs.push([field, value]);
          return q;
        },
      };
      const filtered = () =>
        (tables.get(table) ?? []).filter((r) =>
          eqs.every(([f, v]) => String(r[f]) === String(v)),
        );
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
        async take(n: number) {
          return filtered().slice(0, n);
        },
      };
      return chain;
    },
  };
  // Guest-session authz passes on a matching guestTokenHash (no real identity).
  const auth = { getUserIdentity: async () => null };
  return { db, auth, tables } as any;
}

function guestAccount(id: string, over: AnyDoc = {}): AnyDoc {
  return {
    _id: id,
    kind: "guest",
    guestTokenHash: `hash_${id}`,
    ageBand: "18+",
    matureContentEnabled: false,
    createdAt: 0,
    lastActiveAt: 0,
    ...over,
  };
}

function stubFetch(
  impl: (url: string, init: any) => Promise<{ ok: boolean; json: () => Promise<any> }>,
) {
  const mock = vi.fn(impl);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function okResponse(statuses: string[]) {
  return {
    ok: true,
    json: async () => ({ data: statuses.map((status) => ({ status })) }),
  };
}

afterEach(() => vi.unstubAllGlobals());

// --- pure helpers ---------------------------------------------------------
describe("isExpoPushToken", () => {
  it("accepts ExponentPushToken and ExpoPushToken forms", () => {
    expect(isExpoPushToken(TOKEN)).toBe(true);
    expect(isExpoPushToken(TOKEN_2)).toBe(true);
    expect(isExpoPushToken(`  ${TOKEN}  `)).toBe(true);
  });
  it("rejects junk / empty / non-strings", () => {
    expect(isExpoPushToken("")).toBe(false);
    expect(isExpoPushToken("nope")).toBe(false);
    expect(isExpoPushToken("ExponentPushToken[]")).toBe(false);
    expect(isExpoPushToken(42)).toBe(false);
    expect(isExpoPushToken(undefined)).toBe(false);
  });
});

describe("chunk", () => {
  it("splits into fixed-size batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe("buildCandleRelightMessages", () => {
  it("defaults to the re-entry copy and drops junk tokens", () => {
    const msgs = buildCandleRelightMessages([TOKEN, "junk", TOKEN_2]);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({
      to: TOKEN,
      title: CANDLE_RELIGHT_TITLE,
      body: CANDLE_RELIGHT_BODY,
      channelId: "candle-relights",
      priority: "high",
      sound: "default",
    });
    expect(msgs[0]!.data).toMatchObject({ kind: "candle-relight" });
  });
  it("honours custom copy + extra data", () => {
    const msgs = buildCandleRelightMessages([TOKEN], {
      title: "T",
      body: "B",
      data: { accountId: "a1" },
    });
    expect(msgs[0]).toMatchObject({ title: "T", body: "B" });
    expect(msgs[0]!.data).toMatchObject({ kind: "candle-relight", accountId: "a1" });
  });
});

// --- sendExpoPush ---------------------------------------------------------
describe("sendExpoPush", () => {
  it("no-ops on empty messages (no fetch)", async () => {
    const mock = stubFetch(async () => okResponse([]));
    const res = await sendExpoPush([]);
    expect(res).toEqual({ sent: 0, invalidTokens: [], ok: true });
    expect(mock).not.toHaveBeenCalled();
  });

  it("POSTs to the Expo endpoint and counts ok tickets", async () => {
    const mock = stubFetch(async () => okResponse(["ok", "ok"]));
    const messages = buildCandleRelightMessages([TOKEN, TOKEN_2]);
    const res = await sendExpoPush(messages);
    expect(res.sent).toBe(2);
    expect(res.ok).toBe(true);
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe(EXPO_PUSH_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toHaveLength(2);
  });

  it("batches at 100 messages", async () => {
    const mock = stubFetch(async () => okResponse(new Array(100).fill("ok")));
    const tokens = Array.from({ length: 150 }, (_, i) => `ExpoPushToken[t${i}]`);
    await sendExpoPush(buildCandleRelightMessages(tokens), {
      fetchImpl: mock as unknown as typeof fetch,
    });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("flags DeviceNotRegistered tokens for pruning", async () => {
    const mock = stubFetch(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { status: "ok" },
          { status: "error", details: { error: "DeviceNotRegistered" } },
        ],
      }),
    }));
    const res = await sendExpoPush(buildCandleRelightMessages([TOKEN, TOKEN_2]));
    expect(res.sent).toBe(1);
    expect(res.invalidTokens).toEqual([TOKEN_2]);
    expect(mock).toHaveBeenCalled();
  });

  it("is tolerant of a non-2xx response", async () => {
    stubFetch(async () => ({ ok: false, json: async () => ({}) }));
    const res = await sendExpoPush(buildCandleRelightMessages([TOKEN]));
    expect(res).toEqual({ sent: 0, invalidTokens: [], ok: false });
  });

  it("is tolerant of a thrown fetch", async () => {
    stubFetch(async () => {
      throw new Error("network down");
    });
    const res = await sendExpoPush(buildCandleRelightMessages([TOKEN]));
    expect(res).toEqual({ sent: 0, invalidTokens: [], ok: false });
  });

  it("tolerates a non-array data payload", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ data: null }) }));
    const res = await sendExpoPush(buildCandleRelightMessages([TOKEN]));
    expect(res.sent).toBe(0);
    expect(res.ok).toBe(true);
  });
});

// --- registerPushToken ----------------------------------------------------
describe("registerPushToken", () => {
  it("stores a new token for the authorized account", async () => {
    const ctx = makeCtx({ accounts: [guestAccount("a1")] });
    const res = await (registerPushToken as any)._handler(ctx, {
      accountId: "a1",
      guestTokenHash: "hash_a1",
      token: TOKEN,
      platform: "ios",
    });
    expect(res).toEqual({ stored: true, reason: "created" });
    const rows = await ctx.db.query("push_tokens").collect();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountId: "a1", token: TOKEN, platform: "ios" });
  });

  it("re-points an existing token to the new account", async () => {
    const ctx = makeCtx({
      accounts: [guestAccount("a1"), guestAccount("a2")],
      push_tokens: [
        { _id: "pt1", accountId: "a1", token: TOKEN, createdAt: 1, updatedAt: 1 },
      ],
    });
    const res = await (registerPushToken as any)._handler(ctx, {
      accountId: "a2",
      guestTokenHash: "hash_a2",
      token: TOKEN,
    });
    expect(res).toEqual({ stored: true, reason: "updated" });
    const rows = await ctx.db.query("push_tokens").collect();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.accountId).toBe("a2");
  });

  it("rejects a malformed token without throwing", async () => {
    const ctx = makeCtx({ accounts: [guestAccount("a1")] });
    const res = await (registerPushToken as any)._handler(ctx, {
      accountId: "a1",
      guestTokenHash: "hash_a1",
      token: "not-a-token",
    });
    expect(res).toEqual({ stored: false, reason: "invalid_token" });
    expect(await ctx.db.query("push_tokens").collect()).toHaveLength(0);
  });

  it("throws when the caller does not own the session", async () => {
    const ctx = makeCtx({ accounts: [guestAccount("a1")] });
    await expect(
      (registerPushToken as any)._handler(ctx, {
        accountId: "a1",
        guestTokenHash: "wrong",
        token: TOKEN,
      }),
    ).rejects.toThrow();
  });
});

// --- getAccountPushTokens / removePushToken -------------------------------
describe("getAccountPushTokens", () => {
  it("returns an account's well-formed tokens and filters junk", async () => {
    const ctx = makeCtx({
      push_tokens: [
        { _id: "pt1", accountId: "a1", token: TOKEN },
        { _id: "pt2", accountId: "a1", token: "corrupt" },
        { _id: "pt3", accountId: "a2", token: TOKEN_2 },
      ],
    });
    const res = await (getAccountPushTokens as any)._handler(ctx, { accountId: "a1" });
    expect(res.tokens).toEqual([TOKEN]);
  });
});

describe("removePushToken", () => {
  it("deletes a stored token", async () => {
    const ctx = makeCtx({
      push_tokens: [{ _id: "pt1", accountId: "a1", token: TOKEN }],
    });
    expect(await (removePushToken as any)._handler(ctx, { token: TOKEN })).toEqual({
      removed: true,
    });
    expect(await ctx.db.query("push_tokens").collect()).toHaveLength(0);
  });
  it("is a no-op for an unknown token", async () => {
    const ctx = makeCtx();
    expect(await (removePushToken as any)._handler(ctx, { token: TOKEN })).toEqual({
      removed: false,
    });
  });
});

// --- sendCandleRelightPush (action) ---------------------------------------
// Wire runQuery/runMutation to the local handlers so the action drives the
// real query + prune paths against the same in-memory db.
// Convex function references stash their path on a Symbol(functionName), not
// on String(ref) — resolve it so the mock can dispatch to the right handler.
function refName(ref: any): string {
  const sym = Object.getOwnPropertySymbols(ref).find(
    (s) => s.description === "functionName",
  );
  return sym ? String(ref[sym]) : String(ref);
}

function actionCtx(ctx: any) {
  const dispatch: Record<string, any> = {
    "pushNotifications:getAccountPushTokens": getAccountPushTokens,
    "pushNotifications:removePushToken": removePushToken,
    "pushNotifications:selectGutteredCandleAccounts": selectGutteredCandleAccounts,
    "pushNotifications:sendCandleRelightPush": sendCandleRelightPush,
  };
  const run = (ref: any, args: any) => (dispatch[refName(ref)] as any)._handler(full, args);
  const full: any = { ...ctx };
  full.runQuery = run;
  full.runMutation = run;
  full.runAction = run;
  return full;
}

describe("sendCandleRelightPush", () => {
  it("no-ops (no fetch) when the account has no token", async () => {
    const base = makeCtx();
    const mock = stubFetch(async () => okResponse(["ok"]));
    const ctx = actionCtx(base);
    const res = await (sendCandleRelightPush as any)._handler(ctx, { accountId: "a1" });
    expect(res).toEqual({ sent: 0, tokens: 0 });
    expect(mock).not.toHaveBeenCalled();
  });

  it("pushes to the account's tokens and reports the count", async () => {
    const base = makeCtx({
      push_tokens: [
        { _id: "pt1", accountId: "a1", token: TOKEN },
        { _id: "pt2", accountId: "a1", token: TOKEN_2 },
      ],
    });
    const mock = stubFetch(async () => okResponse(["ok", "ok"]));
    const ctx = actionCtx(base);
    const res = await (sendCandleRelightPush as any)._handler(ctx, { accountId: "a1" });
    expect(res).toEqual({ sent: 2, tokens: 2 });
    expect(mock).toHaveBeenCalledOnce();
  });

  it("prunes a DeviceNotRegistered token after sending", async () => {
    const base = makeCtx({
      push_tokens: [
        { _id: "pt1", accountId: "a1", token: TOKEN },
        { _id: "pt2", accountId: "a1", token: TOKEN_2 },
      ],
    });
    stubFetch(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { status: "ok" },
          { status: "error", details: { error: "DeviceNotRegistered" } },
        ],
      }),
    }));
    const ctx = actionCtx(base);
    const res = await (sendCandleRelightPush as any)._handler(ctx, { accountId: "a1" });
    expect(res.sent).toBe(1);
    const remaining = await base.db.query("push_tokens").collect();
    expect(remaining.map((r: AnyDoc) => r.token)).toEqual([TOKEN]);
  });

  it("is tolerant when the query path throws", async () => {
    const throwingCtx = {
      runQuery: async () => {
        throw new Error("db down");
      },
    };
    const res = await (sendCandleRelightPush as any)._handler(throwingCtx, {
      accountId: "a1",
    });
    expect(res).toEqual({ sent: 0, tokens: 0 });
  });
});

// --- selectGutteredCandleAccounts -----------------------------------------
describe("selectGutteredCandleAccounts", () => {
  const now = 10_000_000;
  const idleMs = 1000;

  function seed() {
    return makeCtx({
      accounts: [
        guestAccount("idle", { lastActiveAt: now - 5000 }), // guttered
        guestAccount("active", { lastActiveAt: now - 100 }), // still lit
        guestAccount("idleNoTok", { lastActiveAt: now - 5000 }), // no token
      ],
      saves: [
        { _id: "s1", accountId: "idle", status: "active" },
        { _id: "s2", accountId: "active", status: "active" },
        { _id: "s3", accountId: "idleNoTok", status: "active" },
        { _id: "s4", accountId: "ghost", status: "active" }, // account missing
      ],
      push_tokens: [
        { _id: "pt1", accountId: "idle", token: TOKEN },
        { _id: "pt2", accountId: "active", token: TOKEN_2 },
      ],
    });
  }

  it("selects idle accounts with a token, skipping active / token-less / ghost", async () => {
    const ctx = seed();
    const res = await (selectGutteredCandleAccounts as any)._handler(ctx, { now, idleMs });
    expect(res.accountIds).toEqual(["idle"]);
  });

  it("respects the limit", async () => {
    const ctx = makeCtx({
      accounts: [
        guestAccount("i1", { lastActiveAt: 0 }),
        guestAccount("i2", { lastActiveAt: 0 }),
      ],
      saves: [
        { _id: "s1", accountId: "i1", status: "active" },
        { _id: "s2", accountId: "i2", status: "active" },
      ],
      push_tokens: [
        { _id: "pt1", accountId: "i1", token: TOKEN },
        { _id: "pt2", accountId: "i2", token: TOKEN_2 },
      ],
    });
    const res = await (selectGutteredCandleAccounts as any)._handler(ctx, {
      now,
      idleMs,
      limit: 1,
    });
    expect(res.accountIds).toHaveLength(1);
  });

  it("dedups multiple active saves for one account", async () => {
    const ctx = makeCtx({
      accounts: [guestAccount("i1", { lastActiveAt: 0 })],
      saves: [
        { _id: "s1", accountId: "i1", status: "active" },
        { _id: "s2", accountId: "i1", status: "active" },
      ],
      push_tokens: [{ _id: "pt1", accountId: "i1", token: TOKEN }],
    });
    const res = await (selectGutteredCandleAccounts as any)._handler(ctx, { now, idleMs });
    expect(res.accountIds).toEqual(["i1"]);
  });
});

// --- notifyGutteredCandles (cron hook) ------------------------------------
describe("notifyGutteredCandles", () => {
  const now = 10_000_000;

  it("selects guttered accounts and fans out the push", async () => {
    const base = makeCtx({
      accounts: [guestAccount("idle", { lastActiveAt: 0 })],
      saves: [{ _id: "s1", accountId: "idle", status: "active" }],
      push_tokens: [{ _id: "pt1", accountId: "idle", token: TOKEN }],
    });
    stubFetch(async () => okResponse(["ok"]));
    const ctx = actionCtx(base);
    const res = await (notifyGutteredCandles as any)._handler(ctx, { now, idleMs: 1000 });
    expect(res).toEqual({ notified: 1, failed: 0 });
  });

  it("counts a zero-send as failed", async () => {
    const base = makeCtx({
      accounts: [guestAccount("idle", { lastActiveAt: 0 })],
      saves: [{ _id: "s1", accountId: "idle", status: "active" }],
      push_tokens: [{ _id: "pt1", accountId: "idle", token: TOKEN }],
    });
    stubFetch(async () => ({ ok: false, json: async () => ({}) }));
    const ctx = actionCtx(base);
    const res = await (notifyGutteredCandles as any)._handler(ctx, { now, idleMs: 1000 });
    expect(res).toEqual({ notified: 0, failed: 1 });
  });

  it("is tolerant when selection throws", async () => {
    const ctx = {
      runQuery: async () => {
        throw new Error("boom");
      },
    };
    const res = await (notifyGutteredCandles as any)._handler(ctx, { now });
    expect(res).toEqual({ notified: 0, failed: 0 });
  });

  it("counts a per-account send failure without aborting the run", async () => {
    const base = makeCtx({
      accounts: [guestAccount("idle", { lastActiveAt: 0 })],
      saves: [{ _id: "s1", accountId: "idle", status: "active" }],
      push_tokens: [{ _id: "pt1", accountId: "idle", token: TOKEN }],
    });
    const ctx = {
      ...base,
      runQuery: async () => ({ accountIds: ["idle"] }),
      runAction: async () => {
        throw new Error("send blew up");
      },
    };
    const res = await (notifyGutteredCandles as any)._handler(ctx, { now });
    expect(res).toEqual({ notified: 0, failed: 1 });
  });
});
