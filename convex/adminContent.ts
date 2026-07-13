// Admin-gated content + user browser (product.md operator-dashboard intent,
// Requirement 27). A thin registered-query layer over bounded, cursor-paged
// db scans, plus pure projection/aggregation helpers that carry the whole
// testable surface (unit-tested in convex/tests/adminContent.test.ts).
//
// Security shape — identical to operatorDashboardFunctions.ts:
//   1. `loadAndAuthorizeAccount` proves the CALLER owns the account row they
//      claim (guest-token proof or auth identity) BEFORE any admin logic runs,
//      so passing a known admin's id without the credential is rejected.
//   2. `assertAdmin` throws `admin_required` before any content is read or
//      returned. No rows leak to a non-admin.
// Everything is read-only. Scans are bounded (paginate page size + hard caps)
// so an admin query can't fan out unbounded on a busy deployment.
//
// Wire shapes (BC2 — the client `convexHttp` casts, it does NOT validate; the
// lib adapter at apps/app/lib/adminApi.ts reconciles these into client types):
//   listStories  -> { stories: AdminStoryRow[] }          (never null; [] = empty)
//   listSaves    -> { page: AdminSaveRow[]; cursor: string|null; isDone: boolean }
//   listUsers    -> { page: AdminUserRow[]; cursor: string|null; isDone: boolean }
//   getSaveDetail-> AdminSaveDetail | null (null = not found / purged)
//   getUserDetail-> AdminUserDetail | null (null = not found)
// All numeric/string fields are concrete (never undefined) so the adapter maps
// straight through; optional fields (email, bible) use null-for-absent.

import { queryGeneric } from "convex/server";
import { v } from "convex/values";

import { assertAdmin } from "./lib/authz";
import { loadAndAuthorizeAccount } from "./lib/authz";
import { accountFromDoc } from "./lib/docs";

const accountId = v.id("accounts");
const guestTokenHash = v.optional(v.string());

// --- Bounds --------------------------------------------------------------

// Default + max page size for the cursor-paged list queries. The admin browser
// pulls a page at a time; the cap stops a hostile/oversized `limit` from
// scanning the whole table in one read.
export const ADMIN_PAGE_DEFAULT = 25;
export const ADMIN_PAGE_MAX = 100;

// How many recent saves the stories aggregation scans in one read. Stories are
// derived by folding saves by storyId; without a createdAt index we scan the
// newest N saves (creation-time desc) and aggregate. Bounded so this stays a
// single cheap read.
export const ADMIN_STORIES_SCAN_CAP = 500;

// Cap the per-detail child scans (scenes for a save, saves for a user) so a
// pathological row can't blow the read up.
export const ADMIN_DETAIL_CHILD_CAP = 200;

export function clampPageSize(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return ADMIN_PAGE_DEFAULT;
  }
  return Math.min(Math.floor(limit), ADMIN_PAGE_MAX);
}

// --- Pure projections (unit-tested) --------------------------------------

export type AdminOwnerKind = "guest" | "user" | "unknown";

export type AdminSaveRow = {
  saveId: string;
  storyId: string;
  ownerAccountId: string;
  ownerKind: AdminOwnerKind;
  turnNumber: number;
  status: string;
  createdAt: number;
};

/**
 * Project a raw `saves` doc into the admin list row. `ownerKind` is resolved
 * by the caller (one account lookup per row, bounded by the page size) and
 * passed in so this stays pure. Tolerant: missing fields degrade to safe
 * defaults rather than throwing (a legacy/partial row still lists).
 */
export function projectSaveRow(
  save: Record<string, unknown>,
  ownerKind: AdminOwnerKind,
): AdminSaveRow {
  return {
    saveId: String(save._id),
    storyId: typeof save.storyId === "string" ? save.storyId : "",
    ownerAccountId: save.accountId === undefined || save.accountId === null ? "" : String(save.accountId),
    ownerKind,
    turnNumber: asCount(save.turnNumber),
    status: typeof save.status === "string" ? save.status : "unknown",
    createdAt: asCount(save.createdAt),
  };
}

export type AdminStoryRow = {
  storyId: string;
  saves: number;
  active: number;
  ended: number;
  dead: number;
  lastActivityAt: number;
};

/**
 * Fold a bounded window of raw save docs into one row per distinct storyId,
 * counting statuses and tracking the most-recent activity timestamp. Sorted
 * newest-activity first. Pure + tolerant — a save with no storyId folds under
 * the empty-string bucket rather than crashing the aggregation.
 */
export function aggregateStories(saves: Array<Record<string, unknown>>): AdminStoryRow[] {
  const byStory = new Map<string, AdminStoryRow>();
  for (const save of saves) {
    const storyId = typeof save.storyId === "string" ? save.storyId : "";
    const status = typeof save.status === "string" ? save.status : "unknown";
    const activity = Math.max(asCount(save.updatedAt), asCount(save.createdAt));
    const row = byStory.get(storyId) ?? {
      storyId,
      saves: 0,
      active: 0,
      ended: 0,
      dead: 0,
      lastActivityAt: 0,
    };
    row.saves += 1;
    if (status === "active") row.active += 1;
    else if (status === "ended" || status === "ended_safely") row.ended += 1;
    else if (status === "dead") row.dead += 1;
    if (activity > row.lastActivityAt) row.lastActivityAt = activity;
    byStory.set(storyId, row);
  }
  return [...byStory.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

export type AdminUserRow = {
  accountId: string;
  kind: AdminOwnerKind;
  // null-for-absent (BC2): only user accounts carry an email; the adapter maps
  // null → optional key absent. `userId` currently holds the email (see the
  // claimGuest note in convex/account.ts) so we surface it for user rows only.
  email: string | null;
  createdAt: number;
  tier: string;
  isAdmin: boolean;
  saveCount: number;
};

/**
 * Project a raw `accounts` doc into the admin user row. `tier` + `saveCount`
 * are resolved by the caller (entitlement lookup + bounded save scan) and
 * passed in so this stays pure. Email is only surfaced for `kind: "user"`.
 */
export function projectUserRow(
  account: Record<string, unknown>,
  resolved: { tier: string; saveCount: number },
): AdminUserRow {
  const kind = normalizeKind(account.kind);
  return {
    accountId: String(account._id),
    kind,
    email: kind === "user" && typeof account.userId === "string" && account.userId.length > 0
      ? account.userId
      : null,
    createdAt: asCount(account.createdAt),
    tier: resolved.tier,
    isAdmin: account.isAdmin === true,
    saveCount: Math.max(0, Math.floor(resolved.saveCount)),
  };
}

export type AdminSceneRow = {
  sceneId: string;
  turnNumber: number;
  nodeId: string;
  streamStatus: string;
  isTerminal: boolean;
  createdAt: number;
};

export function projectSceneRow(scene: Record<string, unknown>): AdminSceneRow {
  return {
    sceneId: String(scene._id),
    turnNumber: asCount(scene.turnNumber),
    nodeId: typeof scene.nodeId === "string" ? scene.nodeId : "",
    streamStatus: typeof scene.streamStatus === "string" ? scene.streamStatus : "unknown",
    isTerminal: !!scene.terminal,
    createdAt: asCount(scene.createdAt),
  };
}

export type AdminBibleSummary = {
  status: string;
  attachedAtTurn: number | null;
  lastRefreshAct: number | null;
  retryCount: number;
} | null;

/**
 * Non-spoiler story-bible summary (BC10: the `bible` planning payload is
 * server-only and MUST NOT leak — we return only bookkeeping fields). Returns
 * null when the save has no bible row.
 */
export function projectBibleSummary(bible: Record<string, unknown> | null | undefined): AdminBibleSummary {
  if (!bible) return null;
  return {
    status: typeof bible.status === "string" ? bible.status : "unknown",
    attachedAtTurn: typeof bible.attachedAtTurn === "number" ? bible.attachedAtTurn : null,
    lastRefreshAct: typeof bible.lastRefreshAct === "number" ? bible.lastRefreshAct : null,
    retryCount: asCount(bible.retryCount),
  };
}

export type AdminEndingRow = {
  endingId: string;
  label: string | null;
  firstSeen: number;
  safetyEnding: boolean;
};

export function projectEndingRow(ending: Record<string, unknown>): AdminEndingRow {
  return {
    endingId: typeof ending.endingId === "string" ? ending.endingId : "",
    label: typeof ending.label === "string" && ending.label.length > 0 ? ending.label : null,
    firstSeen: asCount(ending.firstSeen),
    safetyEnding: ending.safetyEnding === true,
  };
}

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
  scenes: AdminSceneRow[];
  bible: AdminBibleSummary;
  endings: AdminEndingRow[];
};

export type AdminUserDetail = {
  accountId: string;
  kind: AdminOwnerKind;
  email: string | null;
  ageBand: string;
  isAdmin: boolean;
  tier: string;
  entitlementStatus: string | null;
  createdAt: number;
  lastActiveAt: number;
  saveCount: number;
  saves: AdminSaveRow[];
};

// --- helpers -------------------------------------------------------------

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeKind(kind: unknown): AdminOwnerKind {
  return kind === "guest" || kind === "user" ? kind : "unknown";
}

function normalizeTier(entitlement: Record<string, unknown> | null | undefined): string {
  const tier = entitlement?.tier;
  return typeof tier === "string" ? tier : "free";
}

/**
 * Load caller, prove session ownership, THEN assert admin. Shared preamble for
 * every query below — never leak content (or an id's admin status) to a
 * caller who hasn't proven both.
 */
async function authorizeAdmin(
  ctx: any,
  callerAccountId: unknown,
  callerGuestTokenHash: string | undefined,
): Promise<void> {
  const caller = await loadAndAuthorizeAccount(ctx, callerAccountId, callerGuestTokenHash);
  assertAdmin(accountFromDoc(caller));
}

// --- Registered queries --------------------------------------------------

export const listStories = queryGeneric({
  args: { accountId, guestTokenHash },
  handler: async (ctx, args): Promise<{ stories: AdminStoryRow[] }> => {
    await authorizeAdmin(ctx, args.accountId, args.guestTokenHash);
    // Newest saves first (creation-time desc), capped. Aggregate to stories.
    const saves = await ctx.db.query("saves").order("desc").take(ADMIN_STORIES_SCAN_CAP);
    return { stories: aggregateStories(saves) };
  },
});

export const listSaves = queryGeneric({
  args: {
    accountId,
    guestTokenHash,
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ page: AdminSaveRow[]; cursor: string | null; isDone: boolean }> => {
    await authorizeAdmin(ctx, args.accountId, args.guestTokenHash);
    const numItems = clampPageSize(args.limit);
    // Newest first, cursor-paged (bounded).
    const result = await ctx.db
      .query("saves")
      .order("desc")
      .paginate({ numItems, cursor: args.cursor ?? null });

    const rows: AdminSaveRow[] = [];
    for (const save of result.page) {
      const owner = await ctx.db.get(save.accountId);
      rows.push(projectSaveRow(save, normalizeKind(owner?.kind)));
    }
    return { page: rows, cursor: result.isDone ? null : result.continueCursor, isDone: result.isDone };
  },
});

export const listUsers = queryGeneric({
  args: {
    accountId,
    guestTokenHash,
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ page: AdminUserRow[]; cursor: string | null; isDone: boolean }> => {
    await authorizeAdmin(ctx, args.accountId, args.guestTokenHash);
    const numItems = clampPageSize(args.limit);
    const result = await ctx.db
      .query("accounts")
      .order("desc")
      .paginate({ numItems, cursor: args.cursor ?? null });

    const rows: AdminUserRow[] = [];
    for (const account of result.page) {
      const [entitlement, saves] = await Promise.all([
        ctx.db
          .query("entitlements")
          .withIndex("by_accountId", (q: any) => q.eq("accountId", account._id))
          .first(),
        ctx.db
          .query("saves")
          .withIndex("by_accountId", (q: any) => q.eq("accountId", account._id))
          .take(ADMIN_DETAIL_CHILD_CAP),
      ]);
      rows.push(
        projectUserRow(account, { tier: normalizeTier(entitlement), saveCount: saves.length }),
      );
    }
    return { page: rows, cursor: result.isDone ? null : result.continueCursor, isDone: result.isDone };
  },
});

export const getSaveDetail = queryGeneric({
  args: { accountId, guestTokenHash, saveId: v.id("saves") },
  handler: async (ctx, args): Promise<AdminSaveDetail | null> => {
    await authorizeAdmin(ctx, args.accountId, args.guestTokenHash);
    const save = await ctx.db.get(args.saveId);
    if (!save) return null;

    const [owner, scenes, bible] = await Promise.all([
      ctx.db.get(save.accountId),
      ctx.db
        .query("scenes")
        .withIndex("by_save_turn", (q: any) => q.eq("saveId", args.saveId))
        .take(ADMIN_DETAIL_CHILD_CAP),
      ctx.db
        .query("story_bibles")
        .withIndex("by_saveId", (q: any) => q.eq("saveId", args.saveId))
        .first(),
    ]);

    // Endings are (account, story)-scoped; surface the ones reached for this
    // save's story by its owner. Bounded by the account+story index.
    const endings = await ctx.db
      .query("endings_unlocked")
      .withIndex("by_account_story", (q: any) =>
        q.eq("accountId", save.accountId).eq("storyId", save.storyId),
      )
      .take(ADMIN_DETAIL_CHILD_CAP);

    return {
      saveId: String(save._id),
      storyId: typeof save.storyId === "string" ? save.storyId : "",
      ownerAccountId: String(save.accountId),
      ownerKind: normalizeKind(owner?.kind),
      status: typeof save.status === "string" ? save.status : "unknown",
      turnNumber: asCount(save.turnNumber),
      createdAt: asCount(save.createdAt),
      updatedAt: asCount(save.updatedAt),
      sceneCount: scenes.length,
      scenes: scenes.map(projectSceneRow).sort((a, b) => a.turnNumber - b.turnNumber),
      bible: projectBibleSummary(bible),
      endings: endings.map(projectEndingRow),
    };
  },
});

export const getUserDetail = queryGeneric({
  args: { accountId, guestTokenHash, targetAccountId: v.id("accounts") },
  handler: async (ctx, args): Promise<AdminUserDetail | null> => {
    await authorizeAdmin(ctx, args.accountId, args.guestTokenHash);
    const account = await ctx.db.get(args.targetAccountId);
    if (!account) return null;

    const [entitlement, saves] = await Promise.all([
      ctx.db
        .query("entitlements")
        .withIndex("by_accountId", (q: any) => q.eq("accountId", args.targetAccountId))
        .first(),
      ctx.db
        .query("saves")
        .withIndex("by_accountId", (q: any) => q.eq("accountId", args.targetAccountId))
        .take(ADMIN_DETAIL_CHILD_CAP),
    ]);

    const kind = normalizeKind(account.kind);
    return {
      accountId: String(account._id),
      kind,
      email: kind === "user" && typeof account.userId === "string" && account.userId.length > 0
        ? account.userId
        : null,
      ageBand: typeof account.ageBand === "string" ? account.ageBand : "",
      isAdmin: account.isAdmin === true,
      tier: normalizeTier(entitlement),
      entitlementStatus:
        entitlement && typeof entitlement.status === "string" ? entitlement.status : null,
      createdAt: asCount(account.createdAt),
      lastActiveAt: asCount(account.lastActiveAt),
      saveCount: saves.length,
      saves: saves
        .map((save: Record<string, unknown>) => projectSaveRow(save, kind))
        .sort((a, b) => b.createdAt - a.createdAt),
    };
  },
});
