import { View } from "react-native";

import { candleSegments } from "../../lib/storyEngagement";
import { useAppTheme } from "../../theme";
import { Button, Surface, Text } from "../primitives";

/**
 * Panel-2 Wave 2 — the in-fiction daily-turn candle surfaces (panel-review-2:
 * "the daily-cap moment renders as a dead-end error string with no paywall
 * route" + Principle 8 "daily turn caps are a narrative event, not an error
 * message"). Two pieces share this file because they are one story beat at two
 * intensities:
 *
 *  - {@link CandleBurnMeter}: the subtle, tome-voiced meter that appears in the
 *    reader chrome once the day's candle is half-spent (burn >= 50%). It warns
 *    without alarming, so the cap is never a surprise (Principle 7).
 *  - {@link CandleGutterInterstitial}: the full narrative moment when the candle
 *    finally gutters — a re-light countdown plus TWO doors (return when relit /
 *    keep the candle burning → paywall). It never replaces already-generated
 *    prose; the reader can still read the scene beneath it (Principle 7: the
 *    free tier stays beatable — we gate the NEXT turn, never the current page).
 *
 * All colour/spacing/type resolves through `useAppTheme().tokens` so both paint
 * correctly in day / night / sepia. The wax-segment math reuses the pure
 * `candleSegments` helper so the meter reads identically to the pursuit clock.
 */

export type CandleBurnMeterProps = {
  /** Turns spent today. */
  turnsUsed: number;
  /** Included daily allowance (the cap). */
  turnsAllowed: number;
};

/**
 * The subtle burn meter — a short tome-voice line plus a segmented wax row.
 * The CALLER gates visibility (renders only from >= 50% burn); this component
 * assumes it should be shown when mounted. Purely informational: no CTA, no
 * gate, just "the candle is burning down".
 */
export function CandleBurnMeter({ turnsUsed, turnsAllowed }: CandleBurnMeterProps) {
  const { tokens } = useAppTheme();
  const model = candleSegments(turnsUsed, turnsAllowed);
  const remaining = Math.max(0, turnsAllowed - turnsUsed);
  const hot = model.flame;
  const tint = hot ? tokens.colors.danger : tokens.colors.textMuted;

  return (
    <View
      accessibilityLabel={`The day's candle: ${turnsUsed} of ${turnsAllowed} turns spent, ${remaining} left.`}
      style={{
        alignItems: "center",
        alignSelf: "stretch",
        flexDirection: "row",
        gap: tokens.spacing.sm,
      }}
    >
      <Text aria-hidden variant="caption">
        {hot ? "🔥" : "🕯"}
      </Text>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ flexDirection: "row", gap: 3 }}
      >
        {Array.from({ length: model.total }).map((_, index) => {
          const burned = index < model.filled;
          return (
            <View
              key={index}
              style={{
                backgroundColor: burned ? tint : tokens.colors.surfaceMuted,
                borderColor: tokens.colors.borderMuted,
                borderRadius: 2,
                borderWidth: tokens.borderWidths.regular,
                height: 12,
                width: 7,
              }}
            />
          );
        })}
      </View>
      <Text
        muted
        style={{ flexShrink: 1, fontStyle: "italic" }}
        variant="caption"
      >
        {remaining <= 1
          ? "The candle is nearly out — one turn of light remains."
          : `The candle burns low — ${remaining} turns of light remain.`}
      </Text>
    </View>
  );
}

export type CandleGutterInterstitialProps = {
  /** Turns the reader spent today (for the "you read N pages" line). */
  turnsUsed: number;
  /** Human countdown to the next re-light, e.g. `7h 22m`. Empty hides the line. */
  resetsInLabel: string;
  /** Primary door: leave the book until the candle re-lights (home / library). */
  onReturn: () => void;
  /** Secondary door: keep the candle burning → the daily-limit paywall. */
  onSubscribe: () => void;
};

/**
 * The candle-gutter interstitial: the daily cap rendered as a narrative event.
 * Two doors — RETURN-when-relit primary (the free tier stays beatable, just
 * across days) and "keep the candle burning" secondary → /paywall. Rendered
 * ABOVE the still-readable scene, so it frames the moment without gating any
 * prose that was already generated.
 */
export function CandleGutterInterstitial({
  turnsUsed,
  resetsInLabel,
  onReturn,
  onSubscribe,
}: CandleGutterInterstitialProps) {
  const { tokens } = useAppTheme();

  return (
    <Surface
      padded
      accessibilityLabel="The candle has guttered — today's turns are spent."
      style={{
        alignSelf: "stretch",
        borderColor: tokens.colors.border,
        borderWidth: tokens.borderWidths.hairline,
        gap: tokens.spacing.sm,
      }}
    >
      <Text aria-hidden style={{ fontSize: 28, textAlign: "center" }} variant="title">
        🕯
      </Text>
      <Text
        style={{
          fontFamily: tokens.typography.families.serif,
          fontWeight: "800",
          textAlign: "center",
        }}
        variant="subtitle"
      >
        The candle gutters.
      </Text>
      <Text muted style={{ fontStyle: "italic", textAlign: "center" }} variant="body">
        {turnsUsed > 0
          ? `You read ${turnsUsed} ${turnsUsed === 1 ? "page" : "pages"} by today's light. The book does not end — it rests until the wick catches again.`
          : "Today's light is spent. The book does not end — it rests until the wick catches again."}
      </Text>
      {resetsInLabel ? (
        <Text
          style={{
            fontFamily: tokens.typography.families.mono,
            textAlign: "center",
          }}
          tone="accent"
          variant="caption"
        >
          {`The candle re-lights in ${resetsInLabel}.`}
        </Text>
      ) : null}
      <View style={{ gap: tokens.spacing.sm, marginTop: tokens.spacing.xs }}>
        <Button
          accessibilityLabel="Return when the candle re-lights"
          onPress={onReturn}
          variant="primary"
        >
          Return when the candle re-lights
        </Button>
        <Button
          accessibilityLabel="Keep the candle burning — see patronage"
          onPress={onSubscribe}
          variant="secondary"
        >
          Keep the candle burning
        </Button>
      </View>
    </Surface>
  );
}
