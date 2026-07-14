// BetterAuth -> Convex login bridge (convex/betterAuth/accountLink.ts).
//
// Exercises the pure policy helpers and drives the ensureAppAccount /
// getAppAccount handlers with a hand-built ctx (fake `auth.getUserIdentity`
// + `db`) so a signed-in BetterAuth identity resolves to (and is created as) an
// app `accounts` row keyed by userId=email — the row devGrantAdmin({email}) and
// cross-device saves depend on.

import { describe, expect, it } from "vitest";

import {
  buildUserAccountRecord,
  ensureAppAccount,
  getAppAccount,
  normalizeIdentityEmail,
} from "../betterAuth/accountLink";

type Insert = { table: string; id: string; doc: any };
type Patch = { id: string; patch: any };

function makeCtx(input: {
  identity: { email?: string | null; subject?: string | null } | null;
  accounts?: Array<Record<string, any>>;
}) {
  const rows = input.accounts ?? [];
  const inserted: Insert[] = [];
  const patches: Patch[] = [];
  let nextId = 1;

  const ctx = {
    auth: {
      async getUserIdentity() {
        return input.identity;
      },
    },
    db: {
      query(table: string) {
        let matchValue: unknown;
        const chain = {
          withIndex(_name: string, build: (q: any) => any) {
            const q = {
              eq(_field: string, value: unknown) {
                matchValue = value;
                return q;
              },
            };
            build(q);
            return chain;
          },
          async first() {
            if (table !== "accounts") return null;
            return rows.find((r) => r.userId === matchValue) ?? null;
          },
        };
        return chain;
      },
      async insert(table: string, doc: any) {
        const id = `${table}_${nextId++}`;
        inserted.push({ table, id, doc });
        return id;
      },
      async patch(id: any, patch: any) {
        patches.push({ id: String(id), patch });
      },
    },
  };
  return { ctx, inserted, patches };
}

describe("normalizeIdentityEmail", () => {
  it("returns null for a missing identity or email", () => {
    expect(normalizeIdentityEmail(null)).toBeNull();
    expect(normalizeIdentityEmail({})).toBeNull();
    expect(normalizeIdentityEmail({ email: "   " })).toBeNull();
  });

  it("trims and lower-cases so casing/whitespace resolve to one key", () => {
    expect(normalizeIdentityEmail({ email: "  Reader@Example.COM " })).toBe("reader@example.com");
  });
});

describe("buildUserAccountRecord", () => {
  it("mints a permanent kind:user row (no ttlExpiresAt) with mature gated off", () => {
    const record = buildUserAccountRecord({ email: "a@b.com", ageBand: "13-17", now: 42 });
    expect(record).toEqual({
      kind: "user",
      userId: "a@b.com",
      ageBand: "13-17",
      matureContentEnabled: false,
      createdAt: 42,
      lastActiveAt: 42,
    });
    expect("ttlExpiresAt" in record).toBe(false);
  });
});

describe("getAppAccount", () => {
  it("returns null when unauthenticated", async () => {
    const { ctx } = makeCtx({ identity: null });
    expect(await (getAppAccount as any)._handler(ctx, {})).toBeNull();
  });

  it("returns null when the identity has no linked account yet", async () => {
    const { ctx } = makeCtx({ identity: { email: "new@reader.com" }, accounts: [] });
    expect(await (getAppAccount as any)._handler(ctx, {})).toBeNull();
  });

  it("resolves the existing account for the identity email", async () => {
    const { ctx } = makeCtx({
      identity: { email: "Reader@Example.com" },
      accounts: [
        { _id: "acct_9", userId: "reader@example.com", kind: "user", ageBand: "18+", isAdmin: true },
      ],
    });
    expect(await (getAppAccount as any)._handler(ctx, {})).toEqual({
      accountId: "acct_9",
      userId: "reader@example.com",
      kind: "user",
      ageBand: "18+",
      isAdmin: true,
    });
  });
});

describe("ensureAppAccount", () => {
  it("throws when unauthenticated", async () => {
    const { ctx } = makeCtx({ identity: null });
    await expect((ensureAppAccount as any)._handler(ctx, {})).rejects.toThrow(/not_authenticated/);
  });

  it("throws when the identity carries no email", async () => {
    const { ctx } = makeCtx({ identity: { subject: "user_123" } });
    await expect((ensureAppAccount as any)._handler(ctx, {})).rejects.toThrow(/identity_email_missing/);
  });

  it("creates the account + a default entitlement on first sign-in", async () => {
    const { ctx, inserted, patches } = makeCtx({ identity: { email: "First@Reader.com" }, accounts: [] });
    const result = await (ensureAppAccount as any)._handler(ctx, {});

    expect(result.created).toBe(true);
    expect(result.userId).toBe("first@reader.com");
    const accountInsert = inserted.find((i) => i.table === "accounts");
    expect(accountInsert?.doc).toMatchObject({ kind: "user", userId: "first@reader.com", ageBand: "13-17" });
    expect(inserted.some((i) => i.table === "entitlements")).toBe(true);
    expect(result.accountId).toBe(accountInsert?.id);
    expect(patches).toHaveLength(0);
  });

  it("honours a declared 18+ age band at creation", async () => {
    const { ctx, inserted } = makeCtx({ identity: { email: "grown@reader.com" }, accounts: [] });
    await (ensureAppAccount as any)._handler(ctx, { ageBand: "18+" });
    expect(inserted.find((i) => i.table === "accounts")?.doc.ageBand).toBe("18+");
  });

  it("reuses the existing account and refreshes activity (idempotent)", async () => {
    const { ctx, inserted, patches } = makeCtx({
      identity: { email: "returning@reader.com" },
      accounts: [{ _id: "acct_1", userId: "returning@reader.com", kind: "user", ageBand: "18+" }],
    });
    const result = await (ensureAppAccount as any)._handler(ctx, {});

    expect(result).toEqual({ accountId: "acct_1", userId: "returning@reader.com", created: false });
    expect(inserted).toHaveLength(0);
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ id: "acct_1", patch: { lastActiveAt: expect.any(Number) } });
    expect(patches[0]!.patch.kind).toBeUndefined();
  });

  it("upgrades a guest-claimed row sharing the email to kind:user", async () => {
    const { ctx, inserted, patches } = makeCtx({
      identity: { email: "claimed@reader.com" },
      accounts: [{ _id: "acct_2", userId: "claimed@reader.com", kind: "guest", ageBand: "13-17" }],
    });
    const result = await (ensureAppAccount as any)._handler(ctx, {});

    expect(result.created).toBe(false);
    expect(inserted).toHaveLength(0);
    expect(patches[0]).toMatchObject({ id: "acct_2", patch: { kind: "user" } });
  });
});
