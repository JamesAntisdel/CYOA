// Account lifecycle maintenance (Requirement 1.8 / 1.9).
//
// Guest sessions carry a `ttlExpiresAt` set to 7 days from last activity
// (see `createGuestAccountRecord` in ./account). When a guest is claimed into
// a real account, `claimGuest` clears `ttlExpiresAt` (writes `undefined`), so
// claimed `kind:"user"` rows are never eligible for purge.
//
// This module owns:
//   1. `selectPurgeableGuests` — a PURE selection helper (unit-tested in
//      convex/tests/lifecycle.test.ts) that narrows a batch of candidate rows
//      to only the guest sessions whose TTL has actually passed.
//   2. `purgeExpiredGuests` — an internal mutation the daily cron
//      (convex/crons.ts) invokes. It scans the by_ttlExpiresAt index, applies
//      the pure selector, and cascade-deletes each expired guest's session,
//      saves, scenes, turn_history, assets, and unlocked endings.

import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";

import { shouldPurgeGuest, type AccountRecord } from "./account";
import { cascadeAccountData, deleteByIndex } from "./lib/accountCascade";
import { accountFromDoc } from "./lib/docs";

export type PurgeableAccount = AccountRecord & { _id: string };

export type GuestPurgeSummary = {
  scanned: number;
  accountsPurged: number;
  savesDeleted: number;
  scenesDeleted: number;
  turnHistoryDeleted: number;
  assetsDeleted: number;
  endingsDeleted: number;
  // Metering / social rows — must be swept too, or a purged guest leaves
  // orphaned counters and dangling published-tale/coop references behind.
  otherRowsDeleted: number;
};

// How many expired guests to purge per cron run, so one invocation can't fan
// out an unbounded cascade on a busy deployment. The next daily run picks up
// the remainder.
export const GUEST_PURGE_DEFAULT_LIMIT = 200;

/**
 * Pure selection helper: given candidate account rows (already narrowed to the
 * likely-expired range by the by_ttlExpiresAt index) and the current clock,
 * return ONLY the guest rows whose TTL has genuinely passed.
 *
 * The re-check matters. The index range `lte("ttlExpiresAt", now)` also matches
 * rows whose `ttlExpiresAt` is ABSENT — a claimed `kind:"user"` account clears
 * the field on claim, and an absent field sorts below every real value in a
 * Convex index. `shouldPurgeGuest` re-asserts `kind === "guest"` AND a defined,
 * already-passed TTL, so a claimed account is never swept up by the cron even
 * though the raw index range surfaced it.
 */
export function selectPurgeableGuests(
  accounts: PurgeableAccount[],
  now: number,
): PurgeableAccount[] {
  return accounts.filter((account) => shouldPurgeGuest(account, now));
}

export const purgeExpiredGuests = internalMutationGeneric({
  args: {
    // Overridable for deterministic tests / manual runs; the cron omits both.
    now: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<GuestPurgeSummary> => {
    const now = args.now ?? Date.now();
    const limit = args.limit ?? GUEST_PURGE_DEFAULT_LIMIT;

    // Bound the range on BOTH sides. Absent `ttlExpiresAt` (every claimed
    // kind:"user" account clears it on claim) sorts below all real values, so
    // a range with only `lte(now)` fills the batch with claimed rows once they
    // outnumber the take() cap — expired guests then never get scanned. The
    // `gt(0)` lower bound excludes those absent-field rows entirely, so every
    // fetched row is a genuine guest with a real, already-passed TTL.
    const candidateDocs = await ctx.db
      .query("accounts")
      .withIndex("by_ttlExpiresAt", (q: any) => q.gt("ttlExpiresAt", 0).lte("ttlExpiresAt", now))
      .take(limit);

    const purgeable = selectPurgeableGuests(
      candidateDocs.map((doc: any) => accountFromDoc(doc) as PurgeableAccount),
      now,
    ).slice(0, limit);

    const summary: GuestPurgeSummary = {
      scanned: candidateDocs.length,
      accountsPurged: 0,
      savesDeleted: 0,
      scenesDeleted: 0,
      turnHistoryDeleted: 0,
      assetsDeleted: 0,
      endingsDeleted: 0,
      otherRowsDeleted: 0,
    };

    for (const account of purgeable) {
      const accountId = account._id as any;

      // Shared hard-delete cascade (kept in lockstep with deleteAccount): saves
      // + scenes/turn_history/story_bibles, endings, metering, analytics,
      // assets, tale reads/forks, leaderboard, daily_results.
      const cascade = await cascadeAccountData(ctx, accountId);
      summary.savesDeleted += cascade.savesDeleted;
      summary.scenesDeleted += cascade.scenesDeleted;
      summary.turnHistoryDeleted += cascade.turnHistoryDeleted;
      summary.assetsDeleted += cascade.assetsDeleted;
      summary.endingsDeleted += cascade.endingsDeleted;
      summary.otherRowsDeleted +=
        cascade.storyBiblesDeleted +
        cascade.entitlementsDeleted +
        cascade.usageMetersDeleted +
        cascade.dailyCountersDeleted +
        cascade.analyticsDeleted +
        cascade.taleReadsDeleted +
        cascade.taleForksDeleted +
        cascade.leaderboardEntriesDeleted +
        cascade.dailyResultsDeleted;

      // Divergent from deleteAccount (which archives/revokes to preserve reader
      // + audit history): a purged guest's published tales are unreadable once
      // the source save is gone, so hard-delete them; forks are independent
      // saves and survive. Same for hosted coop rooms.
      summary.otherRowsDeleted += await deleteByIndex(ctx, "published_tales", "by_ownerAccountId", "ownerAccountId", accountId);
      summary.otherRowsDeleted += await deleteByIndex(ctx, "coop_rooms", "by_hostAccountId", "hostAccountId", accountId);

      await ctx.db.delete(accountId);
      summary.accountsPurged += 1;
    }

    if (summary.accountsPurged > 0) {
      console.log(
        `[lifecycle] purgeExpiredGuests purged ${summary.accountsPurged} guest session(s)`,
        summary,
      );
    }

    return summary;
  },
});

/**
 * Sweep expired idempotency_records (Req 14.4 leaves a 60s-TTL row per turn).
 * They're ignored past their TTL on read, but nothing deleted them, so the
 * table grew unbounded at the turn rate. The daily cron calls this.
 */
export const purgeExpiredIdempotencyRecords = internalMutationGeneric({
  args: { now: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ deleted: number }> => {
    const now = args.now ?? Date.now();
    const limit = args.limit ?? 2000;
    const stale = await ctx.db
      .query("idempotency_records")
      .withIndex("by_expiresAt", (q: any) => q.lte("expiresAt", now))
      .take(limit);
    for (const row of stale) await ctx.db.delete(row._id);
    return { deleted: stale.length };
  },
});
