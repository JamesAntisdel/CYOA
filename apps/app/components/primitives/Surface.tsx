import { PropsWithChildren } from "react";
import { StyleProp, View, ViewProps, ViewStyle } from "react-native";

import { useAppTheme } from "../../theme";

export type SurfaceVariant = "base" | "muted";

export const SURFACE_VARIANTS: readonly SurfaceVariant[] = ["base", "muted"] as const;

type SurfaceProps = PropsWithChildren<ViewProps> & {
  padded?: boolean;
  variant?: SurfaceVariant;
  /**
   * Manuscript "paper" treatment (opt-in). When true, the Surface reads as a
   * lit page: a faint elevation drop plus the per-theme `paperEdge` candle
   * glow (neutral in Day, candlelight in Night/Sepia). It is a pure
   * conditional-spread — when `paper` is absent/false NOTHING is added, so
   * every existing Surface stays byte-identical to today's render. Reserve it
   * for reading surfaces (chapter interstitials, the page column).
   */
  paper?: boolean;
};

export function Surface({
  children,
  padded = false,
  paper = false,
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
      // Paper (opt-in): a soft candlelight edge + elevation. Conditional-spread
      // so the absent path adds zero keys and stays byte-identical (per
      // exactOptionalPropertyTypes — never pass undefined).
      ...(paper
        ? {
            shadowColor: tokens.colors.paperEdge,
            shadowOffset: { width: 0, height: tokens.borderWidths.hairline },
            shadowOpacity: 1,
            shadowRadius: tokens.spacing.md,
            elevation: 2,
          }
        : {}),
    },
    style,
  ];

  return (
    <View style={surfaceStyle} {...props}>
      {children}
    </View>
  );
}
