// BetterAuth -> Convex login bridge (product-readiness launch-blocker).
//
// A BetterAuth sign-in (magic link / social / email+password) authenticates the
// reader and — once the `/api/auth/convex/token` JWT is minted and presented by
// the ConvexReactClient — surfaces as a Convex identity via
// `ctx.auth.getUserIdentity()`. But BetterAuth's user/session rows live in the
// component's OWN tables; nothing previously connected that identity to the
// app's `accounts` table. So a real signed-in user had NO `accounts` row:
// `devGrantAdmin({ email })` (which looks up `accounts.by_userId`) found nothing,
// and cross-device saves (keyed by accountId) had no server-side identity to
// resolve to.
//
// This module is that bridge. `ensureAppAccount` resolves the authenticated
// identity to an app `accounts` row keyed by `userId = <email>`, creating it
// (kind:"user", plus a default free entitlement) on first sign-in and reusing it
// forever after — including a row a guest previously claimed with the same
// email, so a guest-claim on one device and a BetterAuth sign-in on another
// converge on a single account. `getAppAccount` is the read-only resolver used
// on load.
//
// The pure helpers (`normalizeIdentityEmail`, `buildUserAccountRecord`) carry the
// policy decisions and are unit-tested in
// convex/tests/betterAuthAccountLink.test.ts without a live BetterAuth instance.

import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

import { cleanDoc } from "../lib/docs";
import { AppError } from "../lib/errors";
import { buildDefaultEntitlement } from "../liveCore";

/**
 * Minimal shape of the Convex identity we depend on. `ctx.auth.getUserIdentity()`
 * returns the validated JWT claims; the BetterAuth convex plugin puts the user's
 * email in the standard `email` claim (Convex surfaces it as `identity.email`)
 * and the user id in `sub` (`identity.subject`).
 */
export type ConvexIdentityLike = {
  email?: string | null;
  subject?: string | null;
} & Record<string, unknown>;

/**
 * The reader's declared age band. Defaults to the most restrictive value on a
 * BetterAuth-first sign-in that carries no age (mature content stays gated until
 * the reader sets 18+ through the normal profile flow).
 */
export type AgeBand = "13-17" | "18+";

/**
 * Resolve the app account key (`userId`) from the authenticated identity.
 *
 * `userId = email` is deliberate (and matches the guest-claim path in
 * `convex/account.ts:buildClaimGuestPlan`): it is the natural cross-provider,
 * cross-device key, and it is exactly what `devGrantAdmin({ email })` looks up.
 * Normalized to trimmed lower-case so the same address entered with different
 * casing on different devices resolves to ONE account — the same normalization
 * `apps/app/hooks/useAccountProfile.ts:claimWithEmail` applies.
 *
 * Returns null when the identity carries no usable email (the caller turns that
 * into an explicit error rather than minting an un-addressable account).
 */
export function normalizeIdentityEmail(identity: ConvexIdentityLike | null | undefined): string | null {
  if (!identity) return null;
  const raw = typeof identity.email === "string" ? identity.email : "";
  const normalized = raw.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Build the `accounts` row for a first-time BetterAuth user. No `ttlExpiresAt`
 * is set, so — like a claimed guest — the account is permanent and never swept
 * by the guest-purge cron.
 */
export function buildUserAccountRecord(input: {
  email: string;
  ageBand: AgeBand;
  now: number;
}): {
  kind: "user";
  userId: string;
  ageBand: AgeBand;
  matureContentEnabled: false;
  createdAt: number;
  lastActiveAt: number;
} {
  return {
    kind: "user",
    userId: input.email,
    ageBand: input.ageBand,
    matureContentEnabled: false,
    createdAt: input.now,
    lastActiveAt: input.now,
  };
}

const ageBandArg = v.optional(v.union(v.literal("13-17"), v.literal("18+")));

/**
 * Read-only resolver: return the app account bound to the current BetterAuth
 * identity, or null when the caller is unauthenticated or has not been linked
 * yet. Never mutates — the client calls this on load and falls back to
 * `ensureAppAccount` (a mutation) to create the row on first sign-in.
 */
export const getAppAccount = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const identity = (await ctx.auth.getUserIdentity()) as ConvexIdentityLike | null;
    const email = normalizeIdentityEmail(identity);
    if (!email) return null;
    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_userId", (q: any) => q.eq("userId", email))
      .first();
    if (!existing) return null;
    return {
      accountId: String(existing._id),
      userId: email,
      kind: existing.kind,
      ageBand: existing.ageBand,
      isAdmin: existing.isAdmin === true,
    };
  },
});

/**
 * Find-or-create the app `accounts` row for the authenticated BetterAuth
 * identity. Idempotent: a returning user resolves to their existing row (and its
 * `lastActiveAt` is refreshed). On first sign-in it inserts the account plus a
 * default free entitlement — the same pair `game:createGuestAccount` writes — so
 * the account is immediately usable by the entitlement-gated read paths.
 *
 * A guest-claimed row for the same email (kind:"user", userId=email) is reused,
 * so a guest claim on one device and a BetterAuth sign-in on another converge on
 * ONE account with all its saves.
 *
 * Path (BC): `betterAuth/accountLink:ensureAppAccount`.
 */
export const ensureAppAccount = mutationGeneric({
  args: {
    // Optional declared age band carried from the sign-up flow. Absent → the
    // most restrictive default (13-17); the reader can raise it to 18+ later.
    ageBand: ageBandArg,
  },
  handler: async (ctx, args) => {
    const identity = (await ctx.auth.getUserIdentity()) as ConvexIdentityLike | null;
    if (!identity) throw new AppError("not_authenticated");
    const email = normalizeIdentityEmail(identity);
    if (!email) throw new AppError("identity_email_missing");

    const now = Date.now();
    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_userId", (q: any) => q.eq("userId", email))
      .first();

    if (existing) {
      // Returning identity — refresh activity and (defensively) upgrade a still-
      // guest row that shares this userId to kind:"user". Never downgrades.
      const patch: Record<string, unknown> = { lastActiveAt: now };
      if (existing.kind !== "user") patch.kind = "user";
      await ctx.db.patch(existing._id, cleanDoc(patch));
      return { accountId: String(existing._id), userId: email, created: false };
    }

    const account = buildUserAccountRecord({
      email,
      ageBand: args.ageBand ?? "13-17",
      now,
    });
    const accountIdValue = await ctx.db.insert("accounts", cleanDoc(account));
    await ctx.db.insert("entitlements", cleanDoc(buildDefaultEntitlement(String(accountIdValue), now)));
    return { accountId: String(accountIdValue), userId: email, created: true };
  },
});
