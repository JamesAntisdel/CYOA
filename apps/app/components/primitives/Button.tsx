import { PropsWithChildren } from "react";
import {
  Pressable,
  PressableProps,
  StyleProp,
  TextStyle,
  ViewStyle,
} from "react-native";

import { useAppTheme } from "../../theme";
import { Text } from "./Text";

/**
 * Canonical Button variants. Every consumer in the app must pick one of
 * these — the variant determines background, border, and label colors via
 * the theme tokens. To add a variant: extend this union, then map it in
 * the resolver below AND in
 * `apps/app/components/primitives/__tests__/primitives.contract.test.mjs`
 * (BUTTON_VARIANTS) so the contract test stays green.
 */
export type ButtonVariant =
  | "default"
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "locked";

export const BUTTON_VARIANTS: readonly ButtonVariant[] = [
  "default",
  "primary",
  "secondary",
  "ghost",
  "danger",
  "locked",
] as const;

type ButtonProps = PropsWithChildren<PressableProps> & {
  variant?: ButtonVariant;
};

// Minimum tappable height per WCAG 2.5.5 (44 logical px). Kept here as a
// named constant so the magic number doesn't leak into every render.
const MIN_TAPPABLE_HEIGHT = 44;
// Disabled opacity tuned to keep label contrast >= 3:1 against the variant's
// background in every theme. Lower than this and the label fails AA on
// the `night` palette.
const DISABLED_OPACITY = 0.6;
// Pressed-state opacity — the only feedback we apply. Avoids reflow because
// we don't touch border/padding on press.
const PRESSED_OPACITY = 0.78;

export function Button({
  accessibilityRole = "button",
  children,
  disabled,
  style,
  variant = "default",
  ...props
}: ButtonProps) {
  const { tokens } = useAppTheme();
  const isDisabled = disabled || variant === "locked";

  const isFilled = variant === "primary" || variant === "danger";
  const backgroundColor =
    variant === "primary"
      ? tokens.colors.text
      : variant === "danger"
        ? tokens.colors.danger
        : variant === "ghost"
          ? "transparent"
          : tokens.colors.surface;
  const borderColor =
    variant === "danger" ? tokens.colors.danger : tokens.colors.border;
  const borderStyle: ViewStyle["borderStyle"] =
    variant === "ghost" || variant === "locked" ? "dashed" : "solid";
  const labelColor = isFilled ? tokens.colors.background : tokens.colors.text;

  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      style={({ pressed }) => [
        {
          alignItems: "center",
          backgroundColor,
          borderColor,
          borderRadius: tokens.radii.sm,
          borderStyle,
          borderWidth: tokens.borderWidths.regular,
          justifyContent: "center",
          minHeight: MIN_TAPPABLE_HEIGHT,
          opacity: isDisabled ? DISABLED_OPACITY : pressed ? PRESSED_OPACITY : 1,
          paddingHorizontal: tokens.spacing.lg,
          paddingVertical: tokens.spacing.sm,
        } satisfies ViewStyle,
        style as StyleProp<ViewStyle>,
      ]}
      {...props}
    >
      <Text
        style={{
          color: labelColor,
          fontWeight: "600",
          textAlign: "center",
        } satisfies TextStyle}
      >
        {children}
      </Text>
    </Pressable>
  );
}
