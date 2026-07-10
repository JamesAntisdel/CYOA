import type { AgeBand, Entitlement } from "@cyoa/shared";

import { AppError } from "./lib/errors";

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
