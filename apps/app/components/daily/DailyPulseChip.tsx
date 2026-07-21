import { useEffect, useRef, useState } from "react";

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
  /**
   * Reader-chrome-declutter 3.4 (RB-COUNTS) — optional upward callback that
   * surfaces the newest committed pulse as the COMPACT line StoryRibbon's
   * collapsed row shows (`"62%"`, matching the §3 mock "· 62%"; the full
   * one-liner lives in the visible chip). Fired from the EXISTING fetch (no new
   * query, RC2) on EVERY change — including `undefined` when no committed entry
   * exists (zero-state, transport-degraded `[]`), so the ribbon's pulse segment
   * CLEARS instead of holding a stale percentage (mirrors DoorsJournal's
   * report-0-on-empty contract). Additive — mounts that omit it (legacy calls)
   * are byte-identical.
   */
  onPulseLine?: ((line: string | undefined) => void) | undefined;
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
export function DailyPulseChip({ dailyId, completedTurn, auth, onPulseLine }: DailyPulseChipProps) {
  const [pulses, setPulses] = useState<readonly RemotePulseEntry[]>([]);
  const accountId = auth?.accountId;
  const guestTokenHash = auth?.guestTokenHash;
  // Held in a ref so the callback stays out of the fetch effect's deps — the
  // once-per-committed-turn fetch cadence stays byte-identical.
  const onPulseLineRef = useRef(onPulseLine);
  onPulseLineRef.current = onPulseLine;

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

  const entry = accountId ? newestCommittedPulse(pulses, completedTurn) : null;

  // Surface the COMPACT collapsed-ribbon line ("62%") upward — the full chip
  // one-liner stays in the visible detail (RB-COUNTS). Effect, not render, so
  // the parent's setState never runs during this component's render.
  const compactLine = entry ? `${entry.sharePct}%` : undefined;
  useEffect(() => {
    // Fire on EVERY change, including undefined — a pulse that degrades to
    // empty must CLEAR the collapsed ribbon segment, not leave it stale.
    onPulseLineRef.current?.(compactLine);
  }, [compactLine]);

  if (!entry) return null;

  const label = pulseChipLabel(entry);
  return (
    <Chip accessibilityLabel={label} variant="muted">
      {label}
    </Chip>
  );
}
