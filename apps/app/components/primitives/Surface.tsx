import { PropsWithChildren } from "react";
import { StyleProp, View, ViewProps, ViewStyle } from "react-native";

import { useAppTheme } from "../../theme";

export type SurfaceVariant = "base" | "muted";

export const SURFACE_VARIANTS: readonly SurfaceVariant[] = ["base", "muted"] as const;

type SurfaceProps = PropsWithChildren<ViewProps> & {
  padded?: boolean;
  variant?: SurfaceVariant;
};

export function Surface({
  children,
  padded = false,
  style,
  variant = "base",
  ...props
}: SurfaceProps) {
  const { tokens } = useAppTheme();

  // Border always uses the load-bearing `border` token; `borderMuted` is
  // reserved for Dividers. Surfaces must remain visibly bounded against
  // the page background in every theme.
  const surfaceStyle: StyleProp<ViewStyle> = [
    {
      backgroundColor:
        variant === "muted" ? tokens.colors.surfaceMuted : tokens.colors.surface,
      borderColor: tokens.colors.border,
      borderRadius: tokens.radii.sm,
      borderWidth: tokens.borderWidths.regular,
      padding: padded ? tokens.spacing.lg : 0,
    },
    style,
  ];

  return (
    <View style={surfaceStyle} {...props}>
      {children}
    </View>
  );
}
