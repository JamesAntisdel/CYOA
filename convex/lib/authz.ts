import { forbidden } from "./errors";

export type AccountLike = {
  _id?: string;
  isAdmin?: boolean;
  kind?: "guest" | "user";
  userId?: string;
  guestTokenHash?: string;
};

export type OwnedResource = {
  accountId?: string;
  ownerAccountId?: string;
  hostAccountId?: string;
};

export function assertAdmin(account: AccountLike | null | undefined): asserts account is AccountLike {
  if (!account?.isAdmin) throw forbidden("admin_required");
}

export function assertOwns(
  account: AccountLike | null | undefined,
  resource: OwnedResource,
): void {
  if (!account) throw forbidden("auth_required");
  const ownerId = resource.accountId ?? resource.ownerAccountId ?? resource.hostAccountId;
  if (!account._id || ownerId !== account._id) throw forbidden("resource_not_owned");
}

export async function assertAccountSessionAccess(
  ctx: { auth: { getUserIdentity: () => Promise<{ subject?: string } | null> } },
  account: AccountLike | null | undefined,
  guestTokenHash?: string | undefined,
): Promise<void> {
  if (!account) throw forbidden("auth_required");
  if (account.kind !== "user") {
    if (account.kind === "guest" && account.guestTokenHash && guestTokenHash === account.guestTokenHash) {
      return;
    }
    throw forbidden("resource_not_owned");
  }

  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject || identity.subject !== account.userId) {
    throw forbidden("resource_not_owned");
  }
}
