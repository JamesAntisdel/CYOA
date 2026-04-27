import { PropsWithChildren } from "react";
import { StyleProp, Text as NativeText, TextProps as NativeTextProps, TextStyle } from "react-native";

import { useAppTheme } from "../../theme";

type TextVariant = "display" | "title" | "subtitle" | "body" | "bodySmall" | "caption";

type TextProps = PropsWithChildren<NativeTextProps> & {
  muted?: boolean;
  variant?: TextVariant;
};

export function Text({
  children,
  muted = false,
  style,
  variant = "body",
  ...props
}: TextProps) {
  const { tokens } = useAppTheme();
  const fontSize = tokens.typography[variant];
  const lineHeight = Math.round(fontSize * tokens.typography.lineHeight.normal);
  const fontFamily = variant === "display" || variant === "title"
    ? tokens.typography.families.serif
    : tokens.typography.families.body;

  const textStyle: StyleProp<TextStyle> = [
    {
      color: muted ? tokens.colors.textMuted : tokens.colors.text,
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
