import { Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

import { Chip, Stamp, Text } from "../primitives";
import { useAppTheme } from "../../theme";

export type CoverCardProps = Omit<PressableProps, "children" | "style"> & {
  title: string;
  summary: string;
  tone: string;
  difficulty: string;
  estimatedLength: string;
  ctaLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Cover-forward card for the mobile shelf and starter list.
 * Implements the canvas mobile board pattern: dark cover panel, tone label,
 * difficulty stamp, and a clear single-line CTA — single column on phones.
 */
export function CoverCard({
  ctaLabel = "Launch",
  difficulty,
  estimatedLength,
  summary,
  title,
  tone,
  style,
  ...pressableProps
}: CoverCardProps) {
  const { tokens } = useAppTheme();

  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          backgroundColor: tokens.colors.surface,
          borderColor: tokens.colors.border,
          borderRadius: tokens.radii.sm,
          borderWidth: tokens.borderWidths.regular,
          minHeight: 168,
          opacity: pressed ? 0.85 : 1,
          overflow: "hidden",
        } satisfies ViewStyle,
        style,
      ]}
      {...pressableProps}
    >
      <View
        style={{
          backgroundColor: tokens.colors.text,
          gap: tokens.spacing.xs,
          justifyContent: "flex-end",
          minHeight: 96,
          padding: tokens.spacing.lg,
        }}
      >
        <Text
          style={{
            color: tokens.colors.background,
            fontFamily: tokens.typography.families.serif,
            fontSize: tokens.typography.subtitle,
            fontWeight: "700",
          }}
        >
          {title}
        </Text>
        <Text
          variant="caption"
          style={{ color: tokens.colors.background, opacity: 0.75 }}
        >
          {tone}
        </Text>
      </View>
      <View style={{ gap: tokens.spacing.sm, padding: tokens.spacing.lg }}>
        <Text muted variant="bodySmall">
          {summary}
        </Text>
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            flexWrap: "wrap",
            gap: tokens.spacing.sm,
            justifyContent: "space-between",
          }}
        >
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.xs }}>
            <Stamp>{difficulty}</Stamp>
            <Chip>{estimatedLength}</Chip>
          </View>
          <Text style={{ color: tokens.colors.accent, fontWeight: "700" }}>{ctaLabel}</Text>
        </View>
      </View>
    </Pressable>
  );
}
