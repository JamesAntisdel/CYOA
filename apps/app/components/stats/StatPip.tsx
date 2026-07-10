import { useEffect, useRef } from "react";
import { Animated, View, type ViewStyle } from "react-native";

import { Text } from "../primitives";
import { useAppTheme } from "../../theme";
import {
  PIP_DEFAULT_HOLD_MS,
  formatStatPipAccessibilityLabel,
  resolveStatPipTimeline,
} from "./pipMotion";

export type StatPipDirection = "up" | "down";

type StatPipProps = {
  /**
   * Label of the stat that changed (e.g. "Vitality"). Never receive a hidden
   * stat label here — the caller filters before constructing a pip.
   */
  label: string;
  /** Signed delta. Sign drives glyph and accessibility text. */
  delta: number;
  /** Optional new value to display next to the delta. */
  value?: number;
  /** Reduced-motion fallback skips animation; pip appears instantly. */
  reducedMotion?: boolean;
  /** Called when the pip has fully faded out, so caller can unmount it. */
  onDismiss?: () => void;
  style?: ViewStyle;
  /**
   * Duration the pip stays visible at full opacity before fading. Matches
   * the canvas spec ("pip fades after 3s").
   */
  holdMs?: number;
};

export function StatPip({
  delta,
  holdMs = PIP_DEFAULT_HOLD_MS,
  label,
  onDismiss,
  reducedMotion,
  style,
  value,
}: StatPipProps) {
  const { tokens, reduceMotion: themeReducedMotion } = useAppTheme();
  const resolvedReducedMotion = reducedMotion ?? themeReducedMotion;
  const timeline = resolveStatPipTimeline({ holdMs, reducedMotion: resolvedReducedMotion });
  const opacity = useRef(new Animated.Value(resolvedReducedMotion ? 1 : 0)).current;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (resolvedReducedMotion) {
      // Instant change: appear immediately, schedule timeout dismissal so
      // the receipt does not stick on screen forever.
      opacity.setValue(1);
      const timer = setTimeout(() => {
        opacity.setValue(0);
        dismissRef.current?.();
      }, timeline.holdMs);
      return () => clearTimeout(timer);
    }

    const fadeIn = Animated.timing(opacity, {
      toValue: 1,
      duration: timeline.fadeInMs,
      useNativeDriver: true,
    });
    const hold = Animated.delay(timeline.holdMs);
    const fadeOut = Animated.timing(opacity, {
      toValue: 0,
      duration: timeline.fadeOutMs,
      useNativeDriver: true,
    });

    const sequence = Animated.sequence([fadeIn, hold, fadeOut]);
    sequence.start(({ finished }) => {
      if (finished) dismissRef.current?.();
    });

    return () => {
      sequence.stop();
    };
  }, [opacity, resolvedReducedMotion, timeline.fadeInMs, timeline.fadeOutMs, timeline.holdMs]);

  const sign = delta > 0 ? "+" : "−";
  const magnitude = Math.abs(delta);
  const valueSuffix = typeof value === "number" ? ` (now ${value})` : "";
  const a11yInput = typeof value === "number"
    ? { label, delta, value }
    : { label, delta };
  const a11y = formatStatPipAccessibilityLabel(a11yInput);

  return (
    <Animated.View
      accessibilityLabel={a11y}
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      style={[
        {
          alignSelf: "flex-start",
          borderColor: tokens.colors.accent,
          borderRadius: tokens.radii.xs,
          borderWidth: tokens.borderWidths.regular,
          opacity,
          paddingHorizontal: tokens.spacing.sm,
          paddingVertical: tokens.spacing.xs,
        },
        style as ViewStyle | undefined,
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.spacing.xs }}>
        <Text
          style={{
            color: tokens.colors.accent,
            fontFamily: tokens.typography.families.mono,
            fontWeight: "700",
          }}
          variant="caption"
        >
          {`${sign}${magnitude} ${label}${valueSuffix}`}
        </Text>
      </View>
    </Animated.View>
  );
}
