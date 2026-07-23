import { PropsWithChildren, ReactNode } from "react";
import { StyleProp, View, ViewProps, ViewStyle } from "react-native";

import { useAppTheme } from "../../theme";
import { Text } from "./Text";

/**
 * THE PILL GRAMMAR (manuscript design-language pass, brainstorm §5).
 *
 * The app grew ≥4 ad-hoc pill styles. The canonical grammar is exactly TWO
 * semantic roles, plus the legacy visual variants they map onto:
 *
 *   • `control` — an ACTIONABLE pill (a tap target: a filter, a toggle, a
 *     "begin" affordance). Draws the eye with the accent treatment.
 *   • `status`  — a READ-ONLY state pill (a count, a tier, a label the reader
 *     can't press). Stays quiet: muted surface, muted ink.
 *
 * Author new pills with `control` / `status` — the semantic role, not the
 * paint. The three visual variants below are retained (byte-identical) so
 * existing call sites keep working; a follow-up sweeps them onto the grammar.
 *
 *   default → surface bg / border / text     (retained)
 *   muted   → muted surface / border / text   (retained)
 *   accent  → accent tint / accent / accent   (retained; === `control`)
 *   control → accent tint / accent / accent   (actionable)
 *   status  → muted surface / border / muted  (read-only)
 *
 * See `chipGrammar.test.mjs` for the exhaustive drift contract.
 */
export type ChipVariant = "default" | "muted" | "accent" | "control" | "status";

export const CHIP_VARIANTS: readonly ChipVariant[] = [
  "default",
  "muted",
  "accent",
  "control",
  "status",
] as const;

/** The subset of theme colors the pill grammar paints from. */
type ChipColors = {
  surface: string;
  surfaceMuted: string;
  accent: string;
  accentMuted: string;
  border: string;
  text: string;
  textMuted: string;
};

export type ChipTones = {
  backgroundColor: string;
  borderColor: string;
  labelColor: string;
};

/**
 * Pure resolver for the pill grammar — no React, no theme hook — so the
 * contract test can assert every variant's exact token treatment. `accent`
 * and `control` are deliberately identical (actionable = eye-drawing);
 * `default`/`muted`/`accent` are byte-identical to the pre-grammar Chip.
 */
export function resolveChipTones(variant: ChipVariant, colors: ChipColors): ChipTones {
  const isControl = variant === "accent" || variant === "control";
  const isQuiet = variant === "muted" || variant === "status";
  return {
    backgroundColor: isControl
      ? colors.accentMuted
      : isQuiet
        ? colors.surfaceMuted
        : colors.surface,
    borderColor: isControl ? colors.accent : colors.border,
    labelColor: isControl
      ? colors.accent
      : variant === "status"
        ? colors.textMuted
        : colors.text,
  };
}

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

  const { backgroundColor, borderColor, labelColor } = resolveChipTones(
    variant,
    tokens.colors,
  );

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
