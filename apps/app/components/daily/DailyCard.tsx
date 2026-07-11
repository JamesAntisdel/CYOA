import { useEffect, useState } from "react";
import { View } from "react-native";

import {
  DAILY_ALREADY_PLAYED,
  formatCountdown,
  msUntilNextUtcMidnight,
  type RemoteDailyToday,
} from "../../lib/dailyApi";
import { useAppTheme } from "../../theme";
import { Button, Stamp, Surface, Text } from "../primitives";

type StartResult =
  | { ok: true; saveId: string }
  | { ok: false; errorCode: string; errorMessage: string }
  | null;

type DailyCardProps = {
  /**
   * Today's Daily Tale, or null when there is no row for today (design §10 —
   * the card hides entirely). Also null while the first fetch is in flight.
   */
  daily: RemoteDailyToday | null;
  /**
   * Start today's run (calls `dailyFunctions:startDaily`). Returns the
   * discriminated union so the card can route a `daily_already_played` reader
   * straight to results instead of showing a failure.
   */
  onStart: () => Promise<StartResult>;
  /** Route into the reader on a fresh start. */
  onOpenReader: (saveId: string) => void;
  /** Route to the DailyResults screen (played state / already-played). */
  onOpenResults: (dailyId: string) => void;
  /** Injectable clock for deterministic tests; defaults to Date.now. */
  now?: () => number;
};

/**
 * DailyCard (design §4.3, R13.4) — the home-screen card for today's shared
 * Daily Tale: title, the spoiler-safe dramatic-question teaser, a LIVE
 * countdown to the next tale (ticks each second), and a played/unplayed CTA.
 * Hidden entirely when `daily === null` (no row today / still loading).
 *
 * Unplayed → "Play today's tale" starts the run and routes into the reader.
 * If the server says `daily_already_played` (a race, or a second device), the
 * card routes to results instead of erroring. Played → "See how readers ended".
 */
export function DailyCard({
  daily,
  onStart,
  onOpenReader,
  onOpenResults,
  now = Date.now,
}: DailyCardProps) {
  const { tokens } = useAppTheme();
  const [remainingMs, setRemainingMs] = useState(() => msUntilNextUtcMidnight(now()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live countdown — re-derive from the wall clock each second so it stays
  // accurate across sleep/resume rather than decrementing a local counter.
  useEffect(() => {
    const tick = () => setRemainingMs(msUntilNextUtcMidnight(now()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [now]);

  if (!daily) return null;

  const handlePlay = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onStart();
      if (result && result.ok) {
        onOpenReader(result.saveId);
        return;
      }
      if (result && !result.ok && result.errorCode === DAILY_ALREADY_PLAYED) {
        onOpenResults(daily.dailyId);
        return;
      }
      setError("Today's tale couldn't be opened. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Surface
      accessibilityLabel={`Daily tale: ${daily.title}`}
      padded
      style={{ gap: tokens.spacing.md }}
    >
      <View style={{ alignItems: "center", flexDirection: "row", gap: tokens.spacing.sm }}>
        <Stamp>daily tale</Stamp>
        <Text
          muted
          style={{ fontFamily: tokens.typography.families.mono, letterSpacing: 0.5 }}
          variant="caption"
        >
          {`Next in ${formatCountdown(remainingMs)}`}
        </Text>
      </View>

      <View style={{ gap: tokens.spacing.xs }}>
        <Text style={{ fontFamily: tokens.typography.families.serif }} variant="title">
          {daily.title}
        </Text>
        {daily.questionTeaser ? (
          <Text
            muted
            style={{ fontFamily: tokens.typography.families.serif, fontStyle: "italic" }}
            variant="bodySmall"
          >
            {`❝${daily.questionTeaser}❞`}
          </Text>
        ) : null}
      </View>

      {daily.played ? (
        <View style={{ gap: tokens.spacing.sm }}>
          <Text muted variant="bodySmall">
            You've walked today's tale. See how other readers ended it.
          </Text>
          <Button
            accessibilityLabel="See today's daily results"
            onPress={() => onOpenResults(daily.dailyId)}
          >
            See how readers ended
          </Button>
        </View>
      ) : (
        <Button
          accessibilityLabel="Play today's tale"
          disabled={busy}
          onPress={() => {
            void handlePlay();
          }}
          variant="primary"
        >
          {busy ? "Opening…" : "Play today's tale"}
        </Button>
      )}

      {error ? (
        <Text tone="danger" variant="bodySmall">
          {error}
        </Text>
      ) : null}
    </Surface>
  );
}
