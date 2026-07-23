import { useState } from "react";
import { StyleProp, ViewStyle } from "react-native";

import { DAILY_ALREADY_PLAYED, type RemoteDailyToday } from "../../../lib/dailyApi";
import { DeskObject } from "./DeskObject";

/**
 * Letter (the-desk Wave 2, task 2.1 — R2.1/R2.3/DK6) — the DAILY funnel object,
 * the letter waiting on the desk. It mirrors `components/daily/DailyCard.tsx`
 * routing exactly (DK4 — same data, same destinations, no new queries): an
 * unplayed reader starts today's run and routes into the reader (or to results
 * on the `daily_already_played` race); a played reader routes straight to
 * results. SELF-HIDES (renders null) when there is no Daily today (R2.3) — no
 * broken object, just no letter.
 */

// Mirrors DailyCard's start result shape so the routing branches line up.
type StartResult =
  | { ok: true; saveId: string }
  | { ok: false; errorCode: string; errorMessage: string }
  | null;

export type LetterProps = {
  /** Today's Daily, or null when there is no row today / still loading (R2.3). */
  daily: RemoteDailyToday | null;
  /** Start today's run (the same `startRemoteDaily` DailyCard calls). */
  onStart: () => Promise<StartResult>;
  /** Route into the reader on a fresh start. */
  onOpenReader: (saveId: string) => void;
  /** Route to the DailyResults screen (played / already-played). */
  onOpenResults: (dailyId: string) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Letter({
  daily,
  onStart,
  onOpenReader,
  onOpenResults,
  style,
  testID,
}: LetterProps) {
  const [busy, setBusy] = useState(false);

  // Self-hide when there is no Daily today (R2.3) — the letter simply isn't
  // on the desk.
  if (!daily) return null;

  const handlePress = async () => {
    // Played readers go straight to results (mirrors DailyCard's played CTA).
    if (daily.played) {
      onOpenResults(daily.dailyId);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const result = await onStart();
      if (result && result.ok) {
        onOpenReader(result.saveId);
        return;
      }
      // A race (second device / double-tap) routes to results, not an error —
      // the exact DailyCard fallback.
      if (result && !result.ok && result.errorCode === DAILY_ALREADY_PLAYED) {
        onOpenResults(daily.dailyId);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <DeskObject
      caption="The letter"
      destination={daily.played ? "Results ->" : "Today's tale ->"}
      label="Today's tale"
      onPress={() => {
        void handlePress();
      }}
      style={style}
      {...(testID ? { testID } : {})}
    />
  );
}
