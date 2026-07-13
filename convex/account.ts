import { mutationGeneric } from "convex/server";
import { v } from "convex/values";

import type { AgeBand, Entitlement } from "@cyoa/shared";

import { AppError, forbidden } from "./lib/errors";
import { assertAdmin, loadAndAuthorizeAccount } from "./lib/authz";
import { accountFromDoc } from "./lib/docs";

export type AgeSelection = AgeBand | "under_13";

export type CinematicMode = "off" | "stills_only" | "endpoint_cinematic" | "per_scene_legacy";

export type MediaPrefs = {
  imagesEnabled: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  // omni-cinematics media-strategy switch. Absent = legacy per-scene behavior;
  // the server `resolveMediaStrategy` composes it with the per-modality
  // booleans + Pro gate.
  cinematicMode?: CinematicMode;
};

// Default when a row has no mediaPrefs object: all media on. Existing accounts
// pre-date the field and must keep generating media until the reader explicitly
// toggles a modality off.
export const DEFAULT_MEDIA_PREFS: MediaPrefs = {
  imagesEnabled: true,
  audioEnabled: true,
  videoEnabled: true,
};

export type AccountRecord = {
  _id?: string;
  kind: "guest" | "user";
  userId?: string;
  guestTokenHash?: string;
  ageBand: AgeBand;
  matureContentEnabled: boolean;
  matureContentEnabledAt?: number;
  createdAt: number;
  lastActiveAt: number;
  ttlExpiresAt?: number;
  isAdmin?: boolean;
  mediaPrefs?: MediaPrefs;
};

export type GuestAccountInput = {
  ageSelection: AgeSelection;
  guestTokenHash: string;
  now: number;
  ttlMs?: number;
};

export type AccountProjection = {
  accountId?: string;
  kind: "guest" | "user";
  ageBand: AgeBand;
  matureContentEnabled: boolean;
  isAdmin?: boolean;
  /**
   * Always populated — even when the underlying row has no `mediaPrefs`
   * field — so clients hydrate from a known shape. Absent rows surface as
   * `DEFAULT_MEDIA_PREFS` (all true) to match the "absence means enabled"
   * behavior the server uses when gating media generation.
   */
  mediaPrefs: MediaPrefs;
};

export type ClaimGuestPlan = {
  guestAccountId: string;
  userId: string;
  updates: {
    kind: "user";
    userId: string;
    ttlExpiresAt: undefined;
    lastActiveAt: number;
  };
};

const DEFAULT_GUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function requireEligibleAge(selection: AgeSelection): AgeBand {
  if (selection === "under_13") {
    throw new AppError("age_ineligible", "The story is only available for ages 13 and older.");
  }
  return selection;
}

export function createGuestAccountRecord(input: GuestAccountInput): AccountRecord {
  const ageBand = requireEligibleAge(input.ageSelection);
  if (input.guestTokenHash.trim().length === 0) {
    throw new AppError("guest_token_hash_required");
  }

  return {
    kind: "guest",
    guestTokenHash: input.guestTokenHash,
    ageBand,
    matureContentEnabled: false,
    createdAt: input.now,
    lastActiveAt: input.now,
    ttlExpiresAt: input.now + (input.ttlMs ?? DEFAULT_GUEST_TTL_MS),
  };
}

export function projectAccount(account: AccountRecord): AccountProjection {
  return {
    ...(account._id === undefined ? {} : { accountId: account._id }),
    kind: account.kind,
    ageBand: account.ageBand,
    matureContentEnabled: account.matureContentEnabled,
    ...(account.isAdmin === undefined ? {} : { isAdmin: account.isAdmin }),
    mediaPrefs: account.mediaPrefs ?? DEFAULT_MEDIA_PREFS,
  };
}

/**
 * Coerce the optional `mediaPrefs` field into a fully-populated MediaPrefs
 * object. Centralised so the queue mutations don't each have to repeat the
 * "absent means enabled" defaulting rule. Validates each field is strictly
 * boolean — a malformed partial row reverts to all-enabled rather than
 * silently treating undefined as "disabled" (which would block media for
 * every legacy reader).
 */
export function resolveMediaPrefs(account: Pick<AccountRecord, "mediaPrefs">): MediaPrefs {
  const prefs = account.mediaPrefs;
  if (!prefs) return DEFAULT_MEDIA_PREFS;
  return {
    imagesEnabled: typeof prefs.imagesEnabled === "boolean" ? prefs.imagesEnabled : true,
    audioEnabled: typeof prefs.audioEnabled === "boolean" ? prefs.audioEnabled : true,
    videoEnabled: typeof prefs.videoEnabled === "boolean" ? prefs.videoEnabled : true,
    ...(prefs.cinematicMode ? { cinematicMode: prefs.cinematicMode } : {}),
  };
}

/**
 * Build the patch the `setMediaPrefs` mutation writes to the account row.
 * Pure for testability — the mutation just unwraps the Convex auth + db
 * fetch and hands off to this. All three modality booleans are required so
 * the row always carries a fully-formed pref object (the optional schema
 * field is for backwards compatibility, not partial writes).
 */
export function buildMediaPrefsUpdate(prefs: MediaPrefs): { mediaPrefs: MediaPrefs } {
  return {
    mediaPrefs: {
      imagesEnabled: prefs.imagesEnabled === true,
      audioEnabled: prefs.audioEnabled === true,
      videoEnabled: prefs.videoEnabled === true,
      ...(prefs.cinematicMode ? { cinematicMode: prefs.cinematicMode } : {}),
    },
  };
}

export function buildClaimGuestPlan(
  guestAccount: AccountRecord & { _id: string },
  userId: string,
  now: number,
): ClaimGuestPlan {
  if (guestAccount.kind !== "guest") {
    throw new AppError("account_not_guest");
  }
  if (userId.trim().length === 0) {
    throw new AppError("user_id_required");
  }

  return {
    guestAccountId: guestAccount._id,
    userId,
    updates: {
      kind: "user",
      userId,
      // Intentionally PRESERVE guestTokenHash. SSO / magic-link sign-in isn't
      // wired yet, so the client has no bearer identity to present after the
      // claim — the guest token is still the reader's only credential. Deleting
      // it here (the pre-fix behaviour) permanently locked claimed accounts out
      // of their saves. assertAccountSessionAccess accepts the matching guest
      // token as a fallback for a claimed-but-unauthenticated user account.
      //
      // SECURITY FOLLOW-UP (required before SSO ships): the guest token remains
      // a full-access credential on the claiming device until real auth exists.
      // When the BetterAuth sign-in/linking flow lands it MUST, in one mutation:
      //   (1) set `userId` to the real identity subject (NOT the email stored
      //       here — an OAuth subject never equals the email), and
      //   (2) clear `guestTokenHash` (set to undefined and let the patch remove
      //       it — note cleanDoc strips undefined, so pass an explicit clear).
      // After that, assertAccountSessionAccess's identity branch becomes the
      // sole gate and the old device token stops working. A token-revocation
      // hook cannot be added earlier: with userId == email, no real identity can
      // match, so any opportunistic clear would be dead code.
      ttlExpiresAt: undefined,
      lastActiveAt: now,
    },
  };
}

export function canEnableMatureContent(
  account: AccountRecord,
  entitlement: Pick<Entitlement, "tier" | "status"> | null | undefined,
): boolean {
  return (
    account.kind === "user" &&
    account.ageBand === "18+" &&
    entitlement !== null &&
    entitlement !== undefined &&
    entitlement.status === "active" &&
    (entitlement.tier === "unlimited" || entitlement.tier === "pro")
  );
}

export function buildMatureContentUpdate(
  account: AccountRecord,
  entitlement: Pick<Entitlement, "tier" | "status"> | null | undefined,
  enabled: boolean,
  now: number,
): Partial<{
  matureContentEnabled: AccountRecord["matureContentEnabled"];
  matureContentEnabledAt: AccountRecord["matureContentEnabledAt"] | undefined;
}> {
  if (enabled && !canEnableMatureContent(account, entitlement)) {
    throw new AppError("mature_content_not_allowed");
  }

  return enabled
    ? { matureContentEnabled: true, matureContentEnabledAt: now }
    : { matureContentEnabled: false, matureContentEnabledAt: undefined };
}

export function shouldPurgeGuest(account: AccountRecord, now: number): boolean {
  return account.kind === "guest" && account.ttlExpiresAt !== undefined && account.ttlExpiresAt <= now;
}

export function buildAccountExport(account: AccountRecord): Record<string, unknown> {
  return {
    kind: account.kind,
    ageBand: account.ageBand,
    matureContentEnabled: account.matureContentEnabled,
    createdAt: account.createdAt,
    lastActiveAt: account.lastActiveAt,
    isAdmin: account.isAdmin === true,
  };
}

export type AccountDeletionSummary = {
  accountId: string;
  savesDeleted: number;
  scenesDeleted: number;
  turnHistoryDeleted: number;
  endingsDeleted: number;
  entitlementsDeleted: number;
  usageMetersDeleted: number;
  dailyCountersDeleted: number;
  analyticsDeleted: number;
  assetsDeleted: number;
  taleReadsDeleted: number;
  taleForksDeleted: number;
  authoredSeedsArchived: number;
  publishedTalesRevoked: number;
};

export function createAccountDeletionSummary(accountId: string): AccountDeletionSummary {
  return {
    accountId,
    savesDeleted: 0,
    scenesDeleted: 0,
    turnHistoryDeleted: 0,
    endingsDeleted: 0,
    entitlementsDeleted: 0,
    usageMetersDeleted: 0,
    dailyCountersDeleted: 0,
    analyticsDeleted: 0,
    assetsDeleted: 0,
    taleReadsDeleted: 0,
    taleForksDeleted: 0,
    authoredSeedsArchived: 0,
    publishedTalesRevoked: 0,
  };
}

// ---------------------------------------------------------------------------
// Admin grant / promote (ADMIN-VIEW). Pure helpers first (unit-tested in
// convex/tests/adminGrant.test.ts), then the two registered mutations.
// ---------------------------------------------------------------------------

/**
 * Env name that lets `devGrantAdmin` bootstrap the FIRST admin locally without
 * an existing admin caller. Set (e.g. `CYOA_DEV_ALLOW_ADMIN_GRANT=1`) in the
 * local/dockerized dev env only — never in production. Once one admin exists,
 * further grants can go through an authenticated admin caller instead.
 */
export const CYOA_DEV_ALLOW_ADMIN_GRANT = "CYOA_DEV_ALLOW_ADMIN_GRANT";

/**
 * Interpret an env-flag string as a boolean. Absent / "" / "0" / "false" /
 * "off" (any case) → disabled; any other non-empty value → enabled. Pure so
 * the grant authorization decision is unit-testable without a live env.
 */
export function isAdminGrantEnvEnabled(value: string | undefined | null): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === "" || normalized === "0" || normalized === "false" || normalized === "off") {
    return false;
  }
  return true;
}

/**
 * Normalize the target email for the grant lookup. `userId` on a claimed
 * account holds the email verbatim (see the claimGuest note above), so we trim
 * only — no lowercasing, to match however the account was claimed. Throws when
 * empty so a blank arg can't match an arbitrary row.
 */
export function normalizeGrantEmail(email: string): string {
  const trimmed = typeof email === "string" ? email.trim() : "";
  if (trimmed.length === 0) throw new AppError("admin_grant_email_required");
  return trimmed;
}

/**
 * Gate for `devGrantAdmin`: allow when the local bootstrap env is set OR the
 * (already session-verified) caller is an existing admin. Throws
 * `admin_grant_not_allowed` otherwise. Pure — the mutation resolves `envAllow`
 * and `callerIsAdmin` and hands them here.
 */
export function assertCanGrantAdmin(input: { envAllow: boolean; callerIsAdmin: boolean }): void {
  if (input.envAllow || input.callerIsAdmin) return;
  throw forbidden("admin_grant_not_allowed");
}

/** The patch that flips (or clears) an account's admin claim. */
export function buildAdminClaimUpdate(isAdmin: boolean): { isAdmin: boolean } {
  return { isAdmin: isAdmin === true };
}

/**
 * Dev-gated bootstrap: grant admin to the USER account matching `email`.
 * Authorized when `CYOA_DEV_ALLOW_ADMIN_GRANT` is set (first-admin bootstrap)
 * OR an existing admin caller proves their session. Idempotent — re-granting
 * an already-admin account is a no-op patch.
 *
 * Path (BC1): `account:devGrantAdmin`.
 */
export const devGrantAdmin = mutationGeneric({
  args: {
    email: v.string(),
    // Optional caller proof: required when the bootstrap env is NOT set (so an
    // existing admin can still grant even without the env). Ignored for the
    // env-bootstrap path.
    callerAccountId: v.optional(v.id("accounts")),
    guestTokenHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = normalizeGrantEmail(args.email);
    const envAllow = isAdminGrantEnvEnabled(process.env[CYOA_DEV_ALLOW_ADMIN_GRANT]);

    let callerIsAdmin = false;
    if (args.callerAccountId) {
      // Prove the caller owns this session BEFORE trusting its admin claim.
      const caller = await loadAndAuthorizeAccount(ctx, args.callerAccountId, args.guestTokenHash);
      callerIsAdmin = accountFromDoc(caller).isAdmin === true;
    }
    assertCanGrantAdmin({ envAllow, callerIsAdmin });

    const target = await ctx.db
      .query("accounts")
      .withIndex("by_userId", (q: any) => q.eq("userId", email))
      .first();
    if (!target || target.kind !== "user") throw new AppError("admin_grant_target_not_found");

    await ctx.db.patch(target._id, buildAdminClaimUpdate(true));
    return { accountId: String(target._id), email, isAdmin: true };
  },
});

/**
 * Admin-only toggle of another account's admin claim, driven from the Users
 * view. The caller must prove their session AND hold an admin claim.
 *
 * Path (BC1): `account:promoteUser`.
 */
export const promoteUser = mutationGeneric({
  args: {
    accountId: v.id("accounts"),
    guestTokenHash: v.optional(v.string()),
    targetAccountId: v.id("accounts"),
    isAdmin: v.boolean(),
  },
  handler: async (ctx, args) => {
    const caller = await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);
    assertAdmin(accountFromDoc(caller));

    const target = await ctx.db.get(args.targetAccountId);
    if (!target) throw new AppError("admin_grant_target_not_found");

    await ctx.db.patch(args.targetAccountId, buildAdminClaimUpdate(args.isAdmin));
    return { accountId: String(args.targetAccountId), isAdmin: args.isAdmin === true };
  },
});
