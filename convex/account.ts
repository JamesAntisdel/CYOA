import type { AgeBand, Entitlement } from "@cyoa/shared";

import { AppError } from "./lib/errors";

export type AgeSelection = AgeBand | "under_13";

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
};

export type ClaimGuestPlan = {
  guestAccountId: string;
  userId: string;
  updates: {
    kind: "user";
    userId: string;
    guestTokenHash: undefined;
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
      guestTokenHash: undefined,
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
