import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";

import { candleSegments } from "../../lib/storyEngagement";
import { useAppTheme } from "../../theme";
import { Text } from "../primitives";

/**
 * CandleClock (design §4.2, R9.4) — the segmented doom-clock candle shown in
 * the pursuit drawer. Each unit of `max` is one wax segment; burned segments
 * (value) darken while standing segments stay lit. At ≥75% burned a flame
 * lights and the clock reads as urgent.
 *
 * Motion: when the clock ADVANCES (value increases across renders) and motion
 * is allowed, the candle gives a single opacity pulse to draw the eye; under
 * reduced motion it just re-paints. The pure segment math lives in
 * `storyEngagement.candleSegments` so it is unit-tested without the RN runtime.
 */
export type CandleClockProps = {
  label: string;
  value: number;
  max: number;
  reducedMotion?: boolean;
  /** Compact inline variant: just the flame + count, no segment row or label. */
  inline?: boolean;
};

export function CandleClock({ label, value, max, reducedMotion = false, inline = false }: CandleClockProps) {
  const { tokens } = useAppTheme();
  const model = candleSegments(value, max);
  const pulse = useRef(new Animated.Value(1)).current;
  const prevValue = useRef(value);

  useEffect(() => {
    const advanced = value > prevValue.current;
    prevValue.current = value;
    if (!advanced || reducedMotion) return;
    pulse.setValue(0.35);
    const animation = Animated.timing(pulse, {
      toValue: 1,
      duration: 420,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [pulse, reducedMotion, value]);

  const urgentColor = model.flame ? tokens.colors.danger : tokens.colors.textMuted;

  if (inline) {
    // The always-visible strip variant — a tiny flame + fraction, shown only
    // when the candle is burning hot (the caller gates on model.flame).
    return (
      <View accessibilityLabel={`${label}: ${model.filled} of ${model.total}, urgent`} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
        <Text aria-hidden variant="caption">🔥</Text>
        <Text style={{ color: urgentColor, fontFamily: tokens.typography.families.mono }} variant="caption">
          {`${model.filled}/${model.total}`}
        </Text>
      </View>
    );
  }

  const a11y = `${label}: ${model.filled} of ${model.total} burned${model.flame ? ", urgent" : ""}.`;

  return (
    <Animated.View
      accessibilityLabel={a11y}
      style={{ gap: tokens.spacing.xs, opacity: pulse }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.spacing.xs }}>
        <Text
          muted
          style={{
            fontFamily: tokens.typography.families.mono,
            letterSpacing: 3,
            textTransform: "uppercase",
          }}
          variant="caption"
        >
          {label}
        </Text>
        {model.flame ? <Text aria-hidden variant="caption">🔥</Text> : null}
      </View>
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
                backgroundColor: burned
                  ? model.flame
                    ? tokens.colors.danger
                    : tokens.colors.textMuted
                  : tokens.colors.surfaceMuted,
                borderColor: tokens.colors.borderMuted,
                borderRadius: 2,
                borderWidth: tokens.borderWidths.regular,
                height: 16,
                width: 10,
              }}
            />
          );
        })}
      </View>
      <Text style={{ color: urgentColor, fontFamily: tokens.typography.families.mono }} variant="caption">
        {`${model.filled} / ${model.total}`}
      </Text>
    </Animated.View>
  );
}
