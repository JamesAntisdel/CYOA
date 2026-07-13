// Client-side access to the admin-gated operator dashboard query
// (Requirement 27). Kept separate from gameApi.ts on purpose: this is the only
// caller of `operatorDashboardFunctions:getOperatorDashboard`, and the server
// rejects non-admins, so it doesn't belong with the reader/game surface.
//
// Uses the shared `convexHttp` transport (`/api/query`) rather than the WS
// ConvexReactClient — anonymous local backends don't handshake the WS path
// cleanly.

import type { AdminDashboardData } from "../components/admin";
import { convexClient } from "./convex";
import { convexHttp as callConvexHttp } from "./convexHttp";

/**
 * Fetch the real operator dashboard for an admin account. Returns `null` when:
 *   - no Convex backend is configured,
 *   - the caller's account is not an admin (server throws `admin_required`),
 *   - the session proof is missing/invalid, or
 *   - the request fails / times out.
 *
 * A non-null result implies the server confirmed the caller is an admin — the
 * hook uses that to flip the AdminGate open. Callers MUST treat `null` as
 * "not authorized / unavailable" and keep the gated fallback UI.
 */
export async function getRemoteOperatorDashboard(input: {
  accountId: string;
  guestTokenHash?: string;
  windowMs?: number;
}): Promise<AdminDashboardData | null> {
  if (!convexClient) return null;
  return callConvexHttp<AdminDashboardData>(
    "query",
    "operatorDashboardFunctions:getOperatorDashboard",
    input as unknown as Record<string, unknown>,
  );
}

// ===========================================================================
// Content + users admin browser (product.md operator-dashboard intent, Req 27)
// ---------------------------------------------------------------------------
// Adds the `convex/adminContent.ts` admin-gated queries + the two grant/promote
// mutations on `convex/account.ts`. Same transport + admin semantics as the
// dashboard: the server rejects non-admins, so a non-null result is itself
// proof of admin. BC1 full registered paths; BC2 the adapters below CAST +
// reconcile (they do not trust the wire) and tolerate null/garbage.
// ===========================================================================

/** Full registered convex paths — BC1. Exported so tests can pin them. */
export const ADMIN_CONTENT_PATHS = {
  listStories: "adminContent:listStories",
  listSaves: "adminContent:listSaves",
  listUsers: "adminContent:listUsers",
  getSaveDetail: "adminContent:getSaveDetail",
  getUserDetail: "adminContent:getUserDetail",
  devGrantAdmin: "account:devGrantAdmin",
  promoteUser: "account:promoteUser",
} as const;

// --- Client-facing types (adapted) ---------------------------------------

export type AdminOwnerKind = "guest" | "user" | "unknown";

export type AdminStory = {
  storyId: string;
  saves: number;
  active: number;
  ended: number;
  dead: number;
  lastActivityAt: number;
};

export type AdminSaveListItem = {
  saveId: string;
  storyId: string;
  ownerAccountId: string;
  ownerKind: AdminOwnerKind;
  turnNumber: number;
  status: string;
  createdAt: number;
};

export type AdminUserListItem = {
  accountId: string;
  kind: AdminOwnerKind;
  /** Absent for guests (null-for-absent on the wire, BC4). */
  email?: string;
  createdAt: number;
  tier: string;
  isAdmin: boolean;
  saveCount: number;
};

export type AdminScene = {
  sceneId: string;
  turnNumber: number;
  nodeId: string;
  streamStatus: string;
  isTerminal: boolean;
  createdAt: number;
};

export type AdminBibleSummary = {
  status: string;
  attachedAtTurn?: number;
  lastRefreshAct?: number;
  retryCount: number;
};

export type AdminEnding = {
  endingId: string;
  label?: string;
  firstSeen: number;
  safetyEnding: boolean;
};

export type AdminSaveDetail = {
  saveId: string;
  storyId: string;
  ownerAccountId: string;
  ownerKind: AdminOwnerKind;
  status: string;
  turnNumber: number;
  createdAt: number;
  updatedAt: number;
  sceneCount: number;
  scenes: AdminScene[];
  bible?: AdminBibleSummary;
  endings: AdminEnding[];
};

export type AdminUserDetail = {
  accountId: string;
  kind: AdminOwnerKind;
  email?: string;
  ageBand: string;
  isAdmin: boolean;
  tier: string;
  entitlementStatus?: string;
  createdAt: number;
  lastActiveAt: number;
  saveCount: number;
  saves: AdminSaveListItem[];
};

/** A cursor-paged page. `cursor === null` means the list is exhausted. */
export type AdminPage<T> = {
  page: T[];
  cursor: string | null;
  isDone: boolean;
};

// --- Coercers ------------------------------------------------------------

function asNum(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asStr(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asKind(value: unknown): AdminOwnerKind {
  return value === "guest" || value === "user" ? value : "unknown";
}

// --- Adapters (exported for direct unit testing — BC2) -------------------

export function adaptStories(raw: unknown): AdminStory[] {
  const stories = (raw as { stories?: unknown })?.stories;
  if (!Array.isArray(stories)) return [];
  return stories
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
    .map((s) => ({
      storyId: asStr(s.storyId),
      saves: asNum(s.saves),
      active: asNum(s.active),
      ended: asNum(s.ended),
      dead: asNum(s.dead),
      lastActivityAt: asNum(s.lastActivityAt),
    }));
}

function adaptSaveItem(s: Record<string, unknown>): AdminSaveListItem {
  return {
    saveId: asStr(s.saveId),
    storyId: asStr(s.storyId),
    ownerAccountId: asStr(s.ownerAccountId),
    ownerKind: asKind(s.ownerKind),
    turnNumber: asNum(s.turnNumber),
    status: asStr(s.status, "unknown"),
    createdAt: asNum(s.createdAt),
  };
}

function adaptPage<T>(raw: unknown, mapItem: (item: Record<string, unknown>) => T): AdminPage<T> {
  const source = raw as { page?: unknown; cursor?: unknown; isDone?: unknown } | null | undefined;
  const page = Array.isArray(source?.page)
    ? source!.page
        .filter((i): i is Record<string, unknown> => Boolean(i) && typeof i === "object")
        .map(mapItem)
    : [];
  const cursor = typeof source?.cursor === "string" ? source.cursor : null;
  return { page, cursor, isDone: source?.isDone === true || cursor === null };
}

export function adaptSavesPage(raw: unknown): AdminPage<AdminSaveListItem> {
  return adaptPage(raw, adaptSaveItem);
}

export function adaptUsersPage(raw: unknown): AdminPage<AdminUserListItem> {
  return adaptPage(raw, (u) => ({
    accountId: asStr(u.accountId),
    kind: asKind(u.kind),
    // null-for-absent → optional key absent entirely (BC4).
    ...(typeof u.email === "string" && u.email.length > 0 ? { email: u.email } : {}),
    createdAt: asNum(u.createdAt),
    tier: asStr(u.tier, "free"),
    isAdmin: u.isAdmin === true,
    saveCount: asNum(u.saveCount),
  }));
}

export function adaptSaveDetail(raw: unknown): AdminSaveDetail | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.saveId !== "string") return null;
  const bibleRaw = d.bible as Record<string, unknown> | null | undefined;
  return {
    saveId: d.saveId,
    storyId: asStr(d.storyId),
    ownerAccountId: asStr(d.ownerAccountId),
    ownerKind: asKind(d.ownerKind),
    status: asStr(d.status, "unknown"),
    turnNumber: asNum(d.turnNumber),
    createdAt: asNum(d.createdAt),
    updatedAt: asNum(d.updatedAt),
    sceneCount: asNum(d.sceneCount),
    scenes: Array.isArray(d.scenes)
      ? d.scenes
          .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
          .map((s) => ({
            sceneId: asStr(s.sceneId),
            turnNumber: asNum(s.turnNumber),
            nodeId: asStr(s.nodeId),
            streamStatus: asStr(s.streamStatus, "unknown"),
            isTerminal: s.isTerminal === true,
            createdAt: asNum(s.createdAt),
          }))
      : [],
    ...(bibleRaw && typeof bibleRaw === "object"
      ? {
          bible: {
            status: asStr(bibleRaw.status, "unknown"),
            ...(typeof bibleRaw.attachedAtTurn === "number"
              ? { attachedAtTurn: bibleRaw.attachedAtTurn }
              : {}),
            ...(typeof bibleRaw.lastRefreshAct === "number"
              ? { lastRefreshAct: bibleRaw.lastRefreshAct }
              : {}),
            retryCount: asNum(bibleRaw.retryCount),
          },
        }
      : {}),
    endings: Array.isArray(d.endings)
      ? d.endings
          .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object")
          .map((e) => ({
            endingId: asStr(e.endingId),
            ...(typeof e.label === "string" && e.label.length > 0 ? { label: e.label } : {}),
            firstSeen: asNum(e.firstSeen),
            safetyEnding: e.safetyEnding === true,
          }))
      : [],
  };
}

export function adaptUserDetail(raw: unknown): AdminUserDetail | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.accountId !== "string") return null;
  return {
    accountId: d.accountId,
    kind: asKind(d.kind),
    ...(typeof d.email === "string" && d.email.length > 0 ? { email: d.email } : {}),
    ageBand: asStr(d.ageBand),
    isAdmin: d.isAdmin === true,
    tier: asStr(d.tier, "free"),
    ...(typeof d.entitlementStatus === "string" ? { entitlementStatus: d.entitlementStatus } : {}),
    createdAt: asNum(d.createdAt),
    lastActiveAt: asNum(d.lastActiveAt),
    saveCount: asNum(d.saveCount),
    saves: Array.isArray(d.saves)
      ? d.saves
          .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
          .map(adaptSaveItem)
      : [],
  };
}

// --- Query callers -------------------------------------------------------
// Each returns null when unreachable / unauthorized (server refused a
// non-admin), so the hook keeps the gate closed. An authorized-but-empty result
// still returns a concrete (empty) shape.

export async function getRemoteAdminStories(input: {
  accountId: string;
  guestTokenHash?: string;
}): Promise<AdminStory[] | null> {
  if (!convexClient) return null;
  const raw = await callConvexHttp<unknown>(
    "query",
    ADMIN_CONTENT_PATHS.listStories,
    input as unknown as Record<string, unknown>,
  );
  return raw === null ? null : adaptStories(raw);
}

export async function getRemoteAdminSaves(input: {
  accountId: string;
  guestTokenHash?: string;
  cursor?: string | null;
  limit?: number;
}): Promise<AdminPage<AdminSaveListItem> | null> {
  if (!convexClient) return null;
  const raw = await callConvexHttp<unknown>(
    "query",
    ADMIN_CONTENT_PATHS.listSaves,
    input as unknown as Record<string, unknown>,
  );
  return raw === null ? null : adaptSavesPage(raw);
}

export async function getRemoteAdminUsers(input: {
  accountId: string;
  guestTokenHash?: string;
  cursor?: string | null;
  limit?: number;
}): Promise<AdminPage<AdminUserListItem> | null> {
  if (!convexClient) return null;
  const raw = await callConvexHttp<unknown>(
    "query",
    ADMIN_CONTENT_PATHS.listUsers,
    input as unknown as Record<string, unknown>,
  );
  return raw === null ? null : adaptUsersPage(raw);
}

export async function getRemoteAdminSaveDetail(input: {
  accountId: string;
  guestTokenHash?: string;
  saveId: string;
}): Promise<AdminSaveDetail | null> {
  if (!convexClient) return null;
  const raw = await callConvexHttp<unknown>(
    "query",
    ADMIN_CONTENT_PATHS.getSaveDetail,
    input as unknown as Record<string, unknown>,
  );
  return adaptSaveDetail(raw);
}

export async function getRemoteAdminUserDetail(input: {
  accountId: string;
  guestTokenHash?: string;
  targetAccountId: string;
}): Promise<AdminUserDetail | null> {
  if (!convexClient) return null;
  const raw = await callConvexHttp<unknown>(
    "query",
    ADMIN_CONTENT_PATHS.getUserDetail,
    input as unknown as Record<string, unknown>,
  );
  return adaptUserDetail(raw);
}

// --- Mutation callers ----------------------------------------------------

/**
 * Admin-only toggle of another account's admin claim (Users view). Returns the
 * new state, or null when unreachable / refused (non-admin caller).
 */
export async function promoteUserAdmin(input: {
  accountId: string;
  guestTokenHash?: string;
  targetAccountId: string;
  isAdmin: boolean;
}): Promise<{ accountId: string; isAdmin: boolean } | null> {
  if (!convexClient) return null;
  return callConvexHttp<{ accountId: string; isAdmin: boolean }>(
    "mutation",
    ADMIN_CONTENT_PATHS.promoteUser,
    input as unknown as Record<string, unknown>,
  );
}

/**
 * Dev/bootstrap grant-admin by email. Authorized server-side by the
 * `CYOA_DEV_ALLOW_ADMIN_GRANT` env (first-admin bootstrap) OR an existing admin
 * caller. Returns the granted account, or null when unreachable / refused.
 */
export async function grantAdminByEmail(input: {
  email: string;
  callerAccountId?: string;
  guestTokenHash?: string;
}): Promise<{ accountId: string; email: string; isAdmin: boolean } | null> {
  if (!convexClient) return null;
  return callConvexHttp<{ accountId: string; email: string; isAdmin: boolean }>(
    "mutation",
    ADMIN_CONTENT_PATHS.devGrantAdmin,
    input as unknown as Record<string, unknown>,
  );
}
