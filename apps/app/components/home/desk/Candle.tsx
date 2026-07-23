import { StyleProp, View, ViewStyle } from "react-native";

import { candleBurnModel, type RemoteDailyTurnState } from "../../../lib/dailyTurnApi";
import { useAppTheme } from "../../../theme";
import { Bar, Icon } from "../../primitives";
import { DeskObject } from "./DeskObject";

/**
 * Candle (the-desk Wave 2, task 2.1 — R2.1/R3.1/DK3) — the daily TURN-BUDGET
 * object. Art-light per R3.1: the existing candle glyph (`Icon` "candle") over
 * the existing `Bar` (candle mode) is the whole visual — no new assets. Tapping
 * opens the same paywall/limit surface the in-reader candle links to today
 * (DK-HOME wires `onPress` to /paywall).
 *
 * DK4: turn-state is an OPTIONAL prop. When DK-HOME hands us the reader's live
 * state (from the EXISTING `getRemoteDailyTurnState` — a reused call, not a new
 * query) we show the burn (a candle that has partly burned down + a count);
 * when it is absent we render a full, static candle as a quiet budget cue. Both
 * are still (no ambient flicker) — DK8.
 */

export type CandleProps = {
  /**
   * The reader's live daily turn-state (from the existing getRemoteDailyTurnState),
   * or null/undefined to render a static full-candle budget cue (DK4).
   */
  turnState?: RemoteDailyTurnState | null;
  /** Open the paywall/limit surface (DK-HOME's `() => router.push("/paywall")`). */
  onPress: () => void;
  /** Injectable clock for deterministic tests; defaults to Date.now. */
  now?: () => number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

// Icon size for the candle glyph in the art slot.
const CANDLE_GLYPH_SIZE = 28;

export function Candle({ turnState, onPress, now = Date.now, style, testID }: CandleProps) {
  const { tokens } = useAppTheme();
  const model = candleBurnModel(turnState ?? null, now());

  // A candle burns DOWN: full when unused, low as turns are spent. Fill the Bar
  // with what remains (1 - burn fraction). With no live count we show a full,
  // static candle as a budget cue.
  let fillPct = 100;
  let destination = "Turns ->";
  if (turnState && !turnState.unlimited && turnState.turnsAllowed > 0) {
    fillPct = Math.round((1 - model.fraction) * 100);
    destination = `${model.remaining} of ${turnState.turnsAllowed} turns left`;
  }

  const art = (
    <View style={{ alignItems: "center", gap: tokens.spacing.xs, width: "100%" }}>
      <Icon color={tokens.colors.accent} name="candle" size={CANDLE_GLYPH_SIZE} />
      <Bar candle pct={fillPct} />
    </View>
  );

  return (
    <DeskObject
      art={art}
      caption="Candle"
      destination={destination}
      label="Today's turns"
      onPress={onPress}
      style={style}
      {...(testID ? { testID } : {})}
    />
  );
}
