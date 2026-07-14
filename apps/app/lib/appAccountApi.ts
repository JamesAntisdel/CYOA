// BetterAuth -> Convex app-account bridge (client half).
//
// After a BetterAuth sign-in (magic link / Google / email+password) the reader
// has a Convex identity (the `/api/auth/convex/token` JWT), but the app's own
// `accounts` row is created lazily. This module calls the server bridge mutation
// `betterAuth/accountLink:ensureAppAccount` — authenticated with that JWT — to
// find-or-create the row and return its real `accounts._id`, then reads the
// account's profile the same authenticated way. The linked id is what saves,
// entitlements, and admin all key off (and what `devGrantAdmin({ email })` /
// `devSetTier` target).
//
// Unlike the guest path (which authorizes with a `guestTokenHash` and can use
// the plain `convexHttp` transport), an authenticated user proves ownership with
// the bearer JWT, so these calls attach `Authorization: Bearer <token>` — the
// plain transport sends neither. Uses `fetch` only (no native-only APIs) so the
// web build / live tunnel keeps working.

import { authClient } from "./authClient";
import { convexUrl } from "./authConfig";

/** Result of the ensure-account bridge call. */
export type LinkedAppAccount = {
  accountId: string;
  userId: string;
  created: boolean;
};

/** Fetch the current BetterAuth-minted Convex session JWT, or null. */
async function fetchConvexToken(): Promise<string | null> {
  const { data } = await authClient.convex.token();
  return typeof data?.token === "string" && data.token.length > 0 ? data.token : null;
}

/**
 * Call a Convex function over HTTP with the BetterAuth bearer token attached so
 * `ctx.auth.getUserIdentity()` resolves server-side. Returns the function's
 * value, or null on a missing token / transport / server error (callers treat
 * null as "not linked yet / offline" and fall back).
 */
async function convexHttpAuthed<T = unknown>(
  kind: "query" | "mutation" | "action",
  path: string,
  args: Record<string, unknown>,
  timeoutMs = 5000,
): Promise<T | null> {
  const baseUrl = convexUrl;
  if (!baseUrl) return null;
  const token = await fetchConvexToken();
  if (!token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/${kind}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ path, args: args ?? {}, format: "json" }),
      signal: controller.signal,
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) {
      console.warn(`[appAccountApi] ${kind} ${path} HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { status?: string; value?: T; errorMessage?: string };
    if (data.status === "success") return (data.value ?? null) as T | null;
    console.warn(`[appAccountApi] ${kind} ${path} server error:`, data.errorMessage ?? data);
    return null;
  } catch (err) {
    if ((err as { name?: string })?.name !== "AbortError") {
      console.error(`[appAccountApi] ${kind} ${path} threw:`, err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Find-or-create the app `accounts` row for the signed-in identity. Idempotent
 * server-side; safe to call on every authenticated load. Returns the linked
 * account, or null when unauthenticated / offline.
 */
export async function ensureRemoteAppAccount(
  input: { ageBand?: "13-17" | "18+" } = {},
): Promise<LinkedAppAccount | null> {
  return convexHttpAuthed<LinkedAppAccount>(
    "mutation",
    "betterAuth/accountLink:ensureAppAccount",
    input.ageBand ? { ageBand: input.ageBand } : {},
  );
}

/**
 * Read the linked account's profile (tier / status / mature gate / media prefs /
 * rank / keepsakes) authenticated by the bearer JWT — no guest token. Returns
 * null when unauthenticated / offline; the caller falls back to defaults.
 */
export async function getRemoteAuthedProfile(accountId: string): Promise<AuthedRemoteProfile | null> {
  return convexHttpAuthed<AuthedRemoteProfile>("query", "accountFunctions:getProfile", { accountId });
}

/** Shape of `accountFunctions:getProfile` used by the authenticated profile. */
export type AuthedRemoteProfile = {
  accountId?: string;
  kind: "guest" | "user";
  ageBand: "13-17" | "18+";
  matureContentEnabled: boolean;
  dailyAllowance: number | "unlimited";
  entitlementTier: "free" | "unlimited" | "pro";
  entitlementStatus: "active" | "grace" | "expired" | "revoked";
  isAdmin?: boolean;
  mediaPrefs?: { imagesEnabled: boolean; audioEnabled: boolean; videoEnabled: boolean };
};
