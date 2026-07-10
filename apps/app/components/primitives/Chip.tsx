import { PropsWithChildren, ReactNode } from "react";
import { StyleProp, View, ViewProps, ViewStyle } from "react-native";

import { useAppTheme } from "../../theme";
import { Text } from "./Text";

/**
 * Canonical Chip variants. `muted` chips sit on top of a muted surface
 * (still legible in every theme); `accent` chips draw the eye for status
 * pills. See contract test for the exhaustive list.
 */
export type ChipVariant = "default" | "muted" | "accent";

export const CHIP_VARIANTS: readonly ChipVariant[] = [
  "default",
  "muted",
  "accent",
] as const;

type ChipProps = PropsWithChildren<ViewProps> & {
  icon?: ReactNode;
  variant?: ChipVariant;
};

export function Chip({
  children,
  icon,
  style,
  variant = "default",
  ...props
}: ChipProps) {
  const { tokens } = useAppTheme();

  const backgroundColor =
    variant === "accent"
      ? tokens.colors.accentMuted
      : variant === "muted"
        ? tokens.colors.surfaceMuted
        : tokens.colors.surface;
  const borderColor =
    variant === "accent" ? tokens.colors.accent : tokens.colors.border;
  const labelColor =
    variant === "accent" ? tokens.colors.accent : tokens.colors.text;

  return (
    <View
      accessibilityRole="text"
      style={[
        {
          alignItems: "center",
          alignSelf: "flex-start",
          backgroundColor,
          borderColor,
          borderRadius: tokens.radii.pill,
          borderWidth: tokens.borderWidths.regular,
          flexDirection: "row",
          gap: tokens.spacing.xs,
          // Chip height is body line-height + vertical padding * 2 — derived
          // from tokens so font-scaling stays consistent across the app.
          minHeight: Math.round(tokens.typography.body * 1.4) + tokens.spacing.xs * 2,
          paddingHorizontal: tokens.spacing.sm,
          paddingVertical: tokens.spacing.xs,
        } satisfies ViewStyle,
        style as StyleProp<ViewStyle>,
      ]}
      {...props}
    >
      {icon}
      {/*
       * Single-line labels with ellipsis prevents jagged wrap inside pill
       * shapes. Consumers should keep chip text short; if a longer label
       * is needed, use Stamp or Surface instead.
       */}
      <Text
        ellipsizeMode="tail"
        numberOfLines={1}
        style={{ color: labelColor }}
        variant="caption"
      >
        {children}
      </Text>
    </View>
  );
}
