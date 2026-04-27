import { forbidden } from "./errors";

export type AccountLike = {
  _id: string;
  isAdmin?: boolean;
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
  if (ownerId !== account._id) throw forbidden("resource_not_owned");
}
