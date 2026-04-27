import { View } from "react-native";

import { useAppTheme } from "../../theme";
import { Text } from "../primitives";

type AdminMetricBarProps = {
  label: string;
  value: string;
  progress: number;
  danger?: boolean;
};

export function AdminMetricBar({ danger = false, label, progress, value }: AdminMetricBarProps) {
  const { tokens } = useAppTheme();
  const clampedProgress = Math.max(0, Math.min(1, progress));

  return (
    <View style={{ gap: tokens.spacing.xs }}>
      <View style={{ alignItems: "center", flexDirection: "row", justifyContent: "space-between", gap: tokens.spacing.md }}>
        <Text variant="bodySmall">{label}</Text>
        <Text muted variant="bodySmall">{value}</Text>
      </View>
      <View
        accessibilityLabel={`${label}: ${value}`}
        style={{
          backgroundColor: tokens.colors.overlay,
          borderRadius: tokens.radii.xs,
          height: 8,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            backgroundColor: danger ? tokens.colors.danger : tokens.colors.accent,
            height: "100%",
            width: `${clampedProgress * 100}%`,
          }}
        />
      </View>
    </View>
  );
}
