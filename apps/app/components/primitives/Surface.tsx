import { PropsWithChildren } from "react";
import { StyleProp, View, ViewProps, ViewStyle } from "react-native";

import { useAppTheme } from "../../theme";

type SurfaceProps = PropsWithChildren<ViewProps> & {
  padded?: boolean;
  variant?: "base" | "muted";
};

export function Surface({
  children,
  padded = false,
  style,
  variant = "base",
  ...props
}: SurfaceProps) {
  const { tokens } = useAppTheme();
  const surfaceStyle: StyleProp<ViewStyle> = [
    {
      backgroundColor: variant === "muted" ? tokens.colors.surfaceMuted : tokens.colors.surface,
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
