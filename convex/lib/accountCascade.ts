// Shared account-data cascade (review finding M2). `deleteAccount`
// (accountFunctions.ts, user-initiated erasure) and `purgeExpiredGuests`
// (lifecycle.ts, the daily guest-TTL cron) both have to sweep the same fan-out
// of account-scoped rows, and they had drifted — each was missing tables the
// other deleted. This module is the ONE place that owns the hard-delete set so
// the two stay in lockstep; the divergent soft-handling (deleteAccount ARCHIVES
// authored_seeds / REVOKES published_tales / CLOSES coop_rooms to preserve
// reader + audit history, whereas purge hard-deletes a guest's tales/rooms)
// stays at each call site.

import type { GenericMutationCtx } from "convex/server";

type MutationCtx = GenericMutationCtx<any>;

/** Row counts for every table the shared cascade deletes. */
export type AccountCascadeCounts = {
  savesDeleted: number;
  scenesDeleted: number;
  turnHistoryDeleted: number;
  storyBiblesDeleted: number;
  endingsDeleted: number;
  entitlementsDeleted: number;
  usageMetersDeleted: number;
  dailyCountersDeleted: number;
  analyticsDeleted: number;
  assetsDeleted: number;
  taleReadsDeleted: number;
  taleForksDeleted: number;
  leaderboardEntriesDeleted: number;
  dailyResultsDeleted: number;
};

function zeroCounts(): AccountCascadeCounts {
  return {
    savesDeleted: 0,
    scenesDeleted: 0,
    turnHistoryDeleted: 0,
    storyBiblesDeleted: 0,
    endingsDeleted: 0,
    entitlementsDeleted: 0,
    usageMetersDeleted: 0,
    dailyCountersDeleted: 0,
    analyticsDeleted: 0,
    assetsDeleted: 0,
    taleReadsDeleted: 0,
    taleForksDeleted: 0,
    leaderboardEntriesDeleted: 0,
    dailyResultsDeleted: 0,
  };
}

/**
 * Delete every row an index maps to `field == value`, returning the count.
 * Shared by the cascade and by each call site's divergent hard-deletes.
 */
export async function deleteByIndex(
  ctx: MutationCtx,
  table: string,
  index: string,
  field: string,
  value: unknown,
): Promise<number> {
  const docs = await ctx.db
    .query(table as any)
    .withIndex(index as any, (q: any) => q.eq(field, value))
    .collect();
  for (const doc of docs) {
    await ctx.db.delete(doc._id);
  }
  return docs.length;
}

/**
 * Hard-delete all account-scoped rows that BOTH the deleteAccount and
 * purgeExpiredGuests cascades remove identically: the account's saves (and the
 * scenes / turn_history / story_bibles hanging off each save) plus the
 * account-indexed metering, analytics, social, and W3 tables.
 *
 * Not handled here (divergent per call site): authored_seeds, published_tales,
 * coop_rooms — deleteAccount soft-retires them, purge hard-deletes them.
 *
 * `daily_results` has no by_accountId index (only by_daily and the compound
 * by_daily_account, whose leading field is dailyId), so it can't be scoped by
 * account through an index. We fall back to a full-table scan filtered in JS.
 * See the blocker note: a by_accountId index on daily_results (schema.ts,
 * integrator-owned) would let this drop the scan.
 */
export async function cascadeAccountData(
  ctx: MutationCtx,
  accountId: unknown,
): Promise<AccountCascadeCounts> {
  const counts = zeroCounts();

  const saves = await ctx.db
    .query("saves")
    .withIndex("by_accountId", (q: any) => q.eq("accountId", accountId))
    .collect();
  for (const save of saves) {
    counts.scenesDeleted += await deleteByIndex(ctx, "scenes", "by_save_turn", "saveId", save._id);
    counts.turnHistoryDeleted += await deleteByIndex(ctx, "turn_history", "by_save_turn", "saveId", save._id);
    // story_bibles is save-scoped (only by_saveId), so it's swept per save —
    // mirrors the scenes / turn_history iteration.
    counts.storyBiblesDeleted += await deleteByIndex(ctx, "story_bibles", "by_saveId", "saveId", save._id);
    await ctx.db.delete(save._id);
    counts.savesDeleted += 1;
  }

  counts.endingsDeleted += await deleteByIndex(ctx, "endings_unlocked", "by_account_story", "accountId", accountId);
  counts.entitlementsDeleted += await deleteByIndex(ctx, "entitlements", "by_accountId", "accountId", accountId);
  counts.usageMetersDeleted += await deleteByIndex(ctx, "usage_meters", "by_account_period", "accountId", accountId);
  counts.dailyCountersDeleted += await deleteByIndex(ctx, "daily_turn_counter", "by_account_day", "accountId", accountId);
  counts.analyticsDeleted += await deleteByIndex(ctx, "analytics_events", "by_accountId", "accountId", accountId);
  counts.assetsDeleted += await deleteByIndex(ctx, "assets", "by_accountId", "accountId", accountId);
  counts.taleReadsDeleted += await deleteByIndex(ctx, "tale_reads", "by_accountId", "accountId", accountId);
  counts.taleForksDeleted += await deleteByIndex(ctx, "tale_forks", "by_accountId", "accountId", accountId);
  counts.leaderboardEntriesDeleted += await deleteByIndex(ctx, "leaderboard_entries", "by_accountId", "accountId", accountId);

  counts.dailyResultsDeleted += await deleteDailyResultsByAccount(ctx, accountId);

  return counts;
}

/**
 * Delete this account's daily_results rows. No index scopes by accountId alone,
 * so this scans the table and filters. Bounded only by table size — acceptable
 * as a stopgap; a by_accountId index would make it an indexed delete.
 */
async function deleteDailyResultsByAccount(ctx: MutationCtx, accountId: unknown): Promise<number> {
  const rows = await ctx.db.query("daily_results" as any).collect();
  let deleted = 0;
  for (const row of rows) {
    if ((row as { accountId?: unknown }).accountId === accountId) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }
  }
  return deleted;
}
