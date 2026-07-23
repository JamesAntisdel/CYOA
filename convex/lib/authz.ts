import { accountFromDoc } from "./docs";
import { AppError, forbidden } from "./errors";

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
  ctx: { auth: { getUserIdentity: () => Promise<{ subject?: string; email?: string | null } | null> } },
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
  if (identity?.subject && identity.subject === account.userId) {
    return;
  }
  // BetterAuth-bridge identity match. `ensureAppAccount` keys a user account by
  // `userId = <normalized email>` (the natural cross-provider/cross-device key
  // that `devGrantAdmin({ email })` also uses), NOT the OAuth subject — a
  // provider subject never equals the email. So the authenticated caller proves
  // ownership when the JWT's `email` claim matches the account's userId. Both
  // sides are trimmed + lower-cased so casing differences across devices still
  // resolve to one account (mirrors normalizeIdentityEmail in accountLink.ts).
  const identityEmail = typeof identity?.email === "string" ? identity.email.trim().toLowerCase() : "";
  const accountUserId = typeof account.userId === "string" ? account.userId.trim().toLowerCase() : "";
  if (identityEmail.length > 0 && accountUserId.length > 0 && identityEmail === accountUserId) {
    return;
  }
  // Claimed-but-not-yet-authenticated fallback. `claimGuest` upgrades a guest
  // to `kind: "user"` (recording the email as userId) but does NOT delete the
  // guest token, because SSO / magic-link sign-in isn't wired yet — there is
  // no real auth identity for the client to present. Without this fallback the
  // claim would permanently lock the reader out of their own saves (client
  // calls carry the guest token, never a bearer identity). Accept the matching
  // guest token here; once real sign-in lands it clears guestTokenHash and the
  // identity check above becomes the sole gate.
  if (account.guestTokenHash && guestTokenHash === account.guestTokenHash) {
    return;
  }
  throw forbidden("resource_not_owned");
}

/**
 * Load an account by id and assert the caller owns the session, in one step.
 * Replaces the get → `account_not_found` → `assertAccountSessionAccess` preamble
 * that was copy-pasted across ~20 mutation/query handlers. Returns the raw
 * account doc (callers that need the AccountRecord shape still `accountFromDoc`
 * it for other helpers).
 */
export async function loadAndAuthorizeAccount(
  ctx: {
    db: { get: (id: any) => Promise<any> };
    auth: { getUserIdentity: () => Promise<{ subject?: string } | null> };
  },
  accountId: unknown,
  guestTokenHash?: string,
): Promise<Record<string, unknown>> {
  const account = await ctx.db.get(accountId);
  if (!account) throw new AppError("account_not_found");
  await assertAccountSessionAccess(ctx, accountFromDoc(account), guestTokenHash);
  return account;
}
