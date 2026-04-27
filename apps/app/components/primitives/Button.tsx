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

type ButtonVariant = "default" | "primary" | "ghost" | "locked";

type ButtonProps = PropsWithChildren<PressableProps> & {
  variant?: ButtonVariant;
};

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

  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      style={({ pressed }) => [
        {
          alignItems: "center",
          backgroundColor: variant === "primary" ? tokens.colors.text : tokens.colors.surface,
          borderColor: tokens.colors.border,
          borderRadius: tokens.radii.sm,
          borderStyle: variant === "ghost" || variant === "locked" ? "dashed" : "solid",
          borderWidth: tokens.borderWidths.regular,
          justifyContent: "center",
          minHeight: 44,
          opacity: isDisabled ? 0.55 : pressed ? 0.78 : 1,
          paddingHorizontal: tokens.spacing.lg,
          paddingVertical: tokens.spacing.sm,
        } satisfies ViewStyle,
        style as StyleProp<ViewStyle>,
      ]}
      {...props}
    >
      <Text
        style={{
          color: variant === "primary" ? tokens.colors.background : tokens.colors.text,
          fontWeight: "600",
          textAlign: "center",
        } satisfies TextStyle}
      >
        {children}
      </Text>
    </Pressable>
  );
}
