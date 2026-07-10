import { PropsWithChildren } from "react";
import { StyleProp, Text as NativeText, TextProps as NativeTextProps, TextStyle } from "react-native";

import { useAppTheme } from "../../theme";

export type TextVariant =
  | "display"
  | "title"
  | "subtitle"
  | "body"
  | "bodySmall"
  | "caption";

export const TEXT_VARIANTS: readonly TextVariant[] = [
  "display",
  "title",
  "subtitle",
  "body",
  "bodySmall",
  "caption",
] as const;

// Minimum legible font size (logical px) — no variant or font-scale combo
// may render below this floor. Caption at fontScale=compact would otherwise
// resolve to 10px which fails most legibility heuristics.
const MIN_LEGIBLE_FONT_SIZE = 12;

type TextProps = PropsWithChildren<NativeTextProps> & {
  /**
   * When `true` (default semantics) the text uses `tokens.colors.textMuted`.
   * For the lower-contrast `textFaint` token, set `tone="faint"` instead.
   */
  muted?: boolean;
  tone?: "default" | "muted" | "faint" | "accent" | "danger";
  variant?: TextVariant;
};

export function Text({
  children,
  muted = false,
  style,
  tone,
  variant = "body",
  ...props
}: TextProps) {
  const { tokens } = useAppTheme();

  // Floor the font size so compact font-scale never drops below 12px.
  const rawFontSize = tokens.typography[variant];
  const fontSize = Math.max(MIN_LEGIBLE_FONT_SIZE, rawFontSize);

  // Heading variants get a tighter line-height; caption gets a slightly
  // looser one so wrapped lines stay legible. Body & subtitle use the
  // normal cadence from tokens.
  const lineHeightRatio =
    variant === "display" || variant === "title"
      ? tokens.typography.lineHeight.tight
      : variant === "caption"
        ? tokens.typography.lineHeight.loose
        : tokens.typography.lineHeight.normal;
  const lineHeight = Math.round(fontSize * lineHeightRatio);

  const fontFamily =
    variant === "display" || variant === "title"
      ? tokens.typography.families.serif
      : tokens.typography.families.body;

  // `tone` takes precedence over the legacy boolean `muted` flag so consumers
  // can opt into faint / accent / danger without breaking existing call sites.
  const resolvedTone = tone ?? (muted ? "muted" : "default");
  const color =
    resolvedTone === "muted"
      ? tokens.colors.textMuted
      : resolvedTone === "faint"
        ? tokens.colors.textFaint
        : resolvedTone === "accent"
          ? tokens.colors.accent
          : resolvedTone === "danger"
            ? tokens.colors.danger
            : tokens.colors.text;

  const textStyle: StyleProp<TextStyle> = [
    {
      color,
      fontFamily,
      fontSize,
      lineHeight,
    },
    style,
  ];

  return (
    <NativeText
      allowFontScaling
      maxFontSizeMultiplier={1.4}
      style={textStyle}
      {...props}
    >
      {children}
    </NativeText>
  );
}
