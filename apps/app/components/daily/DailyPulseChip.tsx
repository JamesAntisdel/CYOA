import { useEffect, useState } from "react";

import {
  getRemoteChoicePulse,
  newestCommittedPulse,
  pulseChipLabel,
  type RemotePulseEntry,
} from "../../lib/dailyApi";
import { Chip } from "../primitives";

type DailyPulseChipProps = {
  /**
   * The Daily this save belongs to (`projection.dailyId`). The chip is only
   * mounted when this is present; passing it keeps the fetch keyed to the run.
   */
  dailyId: string;
  /**
   * The reader's latest COMPLETED turn number (`projection.turnNumber`). Drives
   * the once-per-turn refetch and gates which pulse entry may show — an entry
   * whose turn is not yet committed never renders (design daily-killcam §4).
   */
  completedTurn: number;
  /**
   * Remote auth (account + optional guest token). Absent on local / tutorial
   * saves — the chip stays dark because the pulse is a server fact.
   */
  auth?: { accountId: string; guestTokenHash?: string } | undefined;
};

/**
 * DailyPulseChip (daily-killcam design §4 / R3.1) — one quiet chip in the
 * reading strip that surfaces the reader's OWN early-turn pulse: "62% of
 * today's readers · the well-worn path". It attaches only to the reader's
 * committed choice (never an offered/uncommitted one) and renders NOTHING
 * (zero layout shift, same posture as ThreadsPill's null return) when:
 *   - there is no remote auth (local save),
 *   - the pulse is empty (sub-threshold turns, deploy skew, or any failure —
 *     the transport degrades to [] so a killcam failure is never a turn
 *     failure, BC5), or
 *   - the newest recorded entry is for a turn the reader hasn't committed yet.
 *
 * Poll cadence: fetch ONCE per completed-turn change — no interval timer. All
 * percentage math is server-side; `sharePct` is rendered verbatim (DK5).
 */
export function DailyPulseChip({ dailyId, completedTurn, auth }: DailyPulseChipProps) {
  const [pulses, setPulses] = useState<readonly RemotePulseEntry[]>([]);
  const accountId = auth?.accountId;
  const guestTokenHash = auth?.guestTokenHash;

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void getRemoteChoicePulse({
      dailyId,
      accountId,
      ...(guestTokenHash ? { guestTokenHash } : {}),
    })
      .then((next) => {
        if (!cancelled) setPulses(next);
      })
      // getRemoteChoicePulse never rejects, but stay defensive — a killcam
      // failure degrades to "no chip", never an error surface (BC5).
      .catch(() => {
        if (!cancelled) setPulses([]);
      });
    return () => {
      cancelled = true;
    };
    // Fetch once per completed-turn change (and on identity change), no interval.
  }, [dailyId, completedTurn, accountId, guestTokenHash]);

  if (!accountId) return null;
  const entry = newestCommittedPulse(pulses, completedTurn);
  if (!entry) return null;

  const label = pulseChipLabel(entry);
  return (
    <Chip accessibilityLabel={label} variant="muted">
      {label}
    </Chip>
  );
}
