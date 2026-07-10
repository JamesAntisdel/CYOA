import { View, ViewProps } from "react-native";

import { useAppTheme } from "../../theme";

type BarProps = ViewProps & {
  candle?: boolean;
  pct?: number;
};

export function Bar({ candle = false, pct = 60, style, ...props }: BarProps) {
  const { tokens } = useAppTheme();
  const clampedPct = Math.max(0, Math.min(100, pct));

  // Bar height tracks `spacing.sm` so the progress affordance scales with
  // the rest of the spacing rhythm (was a hard-coded 10).
  const height = tokens.spacing.sm + 2;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: clampedPct }}
      style={[
        {
          backgroundColor: tokens.colors.surface,
          borderColor: tokens.colors.border,
          borderRadius: tokens.radii.pill,
          borderWidth: tokens.borderWidths.regular,
          height,
          overflow: "hidden",
          width: "100%",
        },
        style,
      ]}
      {...props}
    >
      <View
        style={{
          backgroundColor: candle ? tokens.colors.accent : tokens.colors.text,
          bottom: 0,
          left: 0,
          position: "absolute",
          top: 0,
          width: `${clampedPct}%`,
        }}
      />
    </View>
  );
}
