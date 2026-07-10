// Convex scheduled functions. Convex auto-detects a default-exported
// `cronJobs()` object from this file — it does NOT need a re-export in
// convex/index.ts.
//
// Currently registers:
//   - purge-expired-guests (Req 1.8 / 1.9): once daily, sweep guest sessions
//     whose 7-day-from-last-activity TTL has passed and cascade-delete the
//     session, its saves/scenes/turn_history/assets, and unlocked endings.
//     Claimed kind:"user" accounts clear their TTL on claim and are never
//     purged (the selection helper re-checks the predicate).

import { cronJobs, makeFunctionReference } from "convex/server";

const crons = cronJobs();

crons.daily(
  "purge-expired-guests",
  // 08:15 UTC — off the top of the hour so it doesn't contend with other
  // hourly maintenance; guest TTL is coarse (7 days) so the exact minute
  // is not load-bearing.
  { hourUTC: 8, minuteUTC: 15 },
  makeFunctionReference<"mutation">("lifecycle:purgeExpiredGuests"),
  {},
);

// Sweep expired idempotency_records (60s TTL each) so the table doesn't grow
// unbounded at the turn rate. They're already ignored past their TTL on read.
crons.daily(
  "purge-expired-idempotency-records",
  { hourUTC: 8, minuteUTC: 30 },
  makeFunctionReference<"mutation">("lifecycle:purgeExpiredIdempotencyRecords"),
  {},
);

// Reclaim orphaned media blobs: asset deletion paths (guest-purge, rewind,
// tale revoke) delete rows but not stored FILES, so blobs leak. This sweep
// deletes any `_storage` file no live asset / tale cinematic references.
// Bounded per run (maxDeletes) so a backlog drains over days.
crons.daily(
  "sweep-orphan-storage",
  { hourUTC: 8, minuteUTC: 45 },
  makeFunctionReference<"mutation">("media/mediaCleanup:sweepOrphanStorage"),
  { maxDeletes: 500 },
);

export default crons;
