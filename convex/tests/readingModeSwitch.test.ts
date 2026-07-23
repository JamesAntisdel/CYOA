// reading-modes A1 (SERVER) coverage for the live mode-switch mutation
// `readingModeFunctions:setReadingMode` (posture B).
//
// The mutation is a thin, self-contained gate over shared helpers, so a fake
// ctx (mirroring convex/tests/novelReadingMode.test.ts) is enough — no convex
// runtime. We drive `setReadingMode._handler` directly and assert BOTH the
// return union AND the persisted `save.readingMode` (via captured patches).
//
// Cases: branching→novel as Pro persists "novel"; →novel as non-Pro returns
// {ok:false,reason:"needs_pro"} and does NOT patch; novel→branching always
// persists the explicit "branching"; missing save → not_found; wrong owner /
// bad session → unauthorized (and neither patches).

import { describe, expect, it } from "vitest";

import { setReadingMode } from "../readingModeFunctions";

type Patch = { id: string; patch: Record<string, unknown> };

const GUEST_HASH = "guest_hash";

function makeAccountDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: "acct_1",
    kind: "guest",
    ageBand: "18+",
    matureContentEnabled: false,
    guestTokenHash: GUEST_HASH,
    lastActiveAt: 1,
    createdAt: 1,
    ...overrides,
  };
}

function makeSaveDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: "save_1",
    accountId: "acct_1",
    storyId: "open-canvas",
    mode: "story",
    status: "active",
    updatedAt: 1,
    ...overrides,
  };
}

const PRO_ENTITLEMENT = {
  _id: "ent_1",
  accountId: "acct_1",
  tier: "pro",
  status: "active",
};

/**
 * Fake ctx: a doc map for `db.get`, an entitlements-only `db.query` chain, and
 * a patch recorder. `auth.getUserIdentity` returns null so ownership rides the
 * guest-token path (matching a guest account), exactly like the app's guest
 * sessions.
 */
function makeCtx(input: {
  account?: Record<string, unknown> | null;
  save?: Record<string, unknown> | null;
  entitlement?: Record<string, unknown> | null;
}) {
  const docs = new Map<string, Record<string, unknown>>();
  if (input.account) docs.set(String(input.account._id), input.account);
  if (input.save) docs.set(String(input.save._id), input.save);
  const patches: Patch[] = [];

  const ctx = {
    db: {
      async get(id: any) {
        return docs.get(String(id)) ?? null;
      },
      query(table: string) {
        const rows: Record<string, unknown>[] =
          table === "entitlements" ? (input.entitlement ? [input.entitlement] : []) : [];
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
      async patch(id: any, patch: Record<string, unknown>) {
        patches.push({ id: String(id), patch });
        const existing = docs.get(String(id));
        if (existing) docs.set(String(id), { ...existing, ...patch });
      },
    },
    auth: {
      async getUserIdentity() {
        return null;
      },
    },
  };
  return { ctx, patches };
}

function callArgs(overrides: Record<string, unknown> = {}) {
  return {
    saveId: "save_1",
    mode: "novel" as const,
    auth: { accountId: "acct_1", guestTokenHash: GUEST_HASH },
    ...overrides,
  };
}

const run = (ctx: unknown, args: unknown) => (setReadingMode as any)._handler(ctx, args);

describe("setReadingMode — live mode switch (posture B)", () => {
  it("branching→novel as Pro succeeds and persists 'novel'", async () => {
    const { ctx, patches } = makeCtx({
      account: makeAccountDoc(),
      save: makeSaveDoc(),
      entitlement: PRO_ENTITLEMENT,
    });

    const result = await run(ctx, callArgs({ mode: "novel" }));

    expect(result).toEqual({ ok: true, mode: "novel" });
    const savePatch = patches.find((p) => p.id === "save_1");
    expect(savePatch).toBeTruthy();
    expect(savePatch!.patch.readingMode).toBe("novel");
  });

  it("→novel as non-Pro returns needs_pro and does NOT patch", async () => {
    const { ctx, patches } = makeCtx({
      account: makeAccountDoc(),
      save: makeSaveDoc(),
      entitlement: null,
    });

    const result = await run(ctx, callArgs({ mode: "novel" }));

    expect(result).toEqual({ ok: false, reason: "needs_pro" });
    expect(patches).toHaveLength(0);
  });

  it("→novel with a grace (non-active) paid entitlement returns needs_pro", async () => {
    const { ctx, patches } = makeCtx({
      account: makeAccountDoc(),
      save: makeSaveDoc(),
      entitlement: { ...PRO_ENTITLEMENT, status: "grace" },
    });

    const result = await run(ctx, callArgs({ mode: "novel" }));

    expect(result).toEqual({ ok: false, reason: "needs_pro" });
    expect(patches).toHaveLength(0);
  });

  it("novel→branching always succeeds and persists the explicit 'branching'", async () => {
    // No entitlement (non-Pro): stepping DOWN is always allowed.
    const { ctx, patches } = makeCtx({
      account: makeAccountDoc(),
      save: makeSaveDoc({ readingMode: "novel" }),
      entitlement: null,
    });

    const result = await run(ctx, callArgs({ mode: "branching" }));

    expect(result).toEqual({ ok: true, mode: "branching" });
    const savePatch = patches.find((p) => p.id === "save_1");
    expect(savePatch).toBeTruthy();
    // Stored EXPLICITLY (not omitted) so the save reads back as branching.
    expect(savePatch!.patch.readingMode).toBe("branching");
  });

  it("returns not_found when the save does not exist (no patch)", async () => {
    const { ctx, patches } = makeCtx({
      account: makeAccountDoc(),
      save: null,
      entitlement: PRO_ENTITLEMENT,
    });

    const result = await run(ctx, callArgs({ mode: "novel" }));

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(patches).toHaveLength(0);
  });

  it("returns unauthorized when auth is omitted (no patch)", async () => {
    const { ctx, patches } = makeCtx({
      account: makeAccountDoc(),
      save: makeSaveDoc(),
      entitlement: PRO_ENTITLEMENT,
    });

    const result = await run(ctx, { saveId: "save_1", mode: "novel" });

    expect(result).toEqual({ ok: false, reason: "unauthorized" });
    expect(patches).toHaveLength(0);
  });

  it("returns unauthorized when the guest session token does not match (no patch)", async () => {
    const { ctx, patches } = makeCtx({
      account: makeAccountDoc(),
      save: makeSaveDoc(),
      entitlement: PRO_ENTITLEMENT,
    });

    const result = await run(
      ctx,
      callArgs({ mode: "novel", auth: { accountId: "acct_1", guestTokenHash: "wrong_hash" } }),
    );

    expect(result).toEqual({ ok: false, reason: "unauthorized" });
    expect(patches).toHaveLength(0);
  });

  it("returns unauthorized when the caller does not own the save (no patch)", async () => {
    // Caller authenticates as their own account but targets a save owned by
    // someone else — loadAndAuthorizeAccount passes, the accountId compare fails.
    const { ctx, patches } = makeCtx({
      account: makeAccountDoc(),
      save: makeSaveDoc({ accountId: "acct_other" }),
      entitlement: PRO_ENTITLEMENT,
    });

    const result = await run(ctx, callArgs({ mode: "novel" }));

    expect(result).toEqual({ ok: false, reason: "unauthorized" });
    expect(patches).toHaveLength(0);
  });

  it("returns unauthorized when the account does not exist (no patch)", async () => {
    // Save present but its owning account row is missing — loadAndAuthorizeAccount
    // throws account_not_found, which we soft-return as unauthorized.
    const { ctx, patches } = makeCtx({
      account: null,
      save: makeSaveDoc(),
      entitlement: PRO_ENTITLEMENT,
    });

    const result = await run(ctx, callArgs({ mode: "novel" }));

    expect(result).toEqual({ ok: false, reason: "unauthorized" });
    expect(patches).toHaveLength(0);
  });
});
