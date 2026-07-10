import { PropsWithChildren } from "react";
import { Pressable, PressableProps, StyleProp, View, ViewStyle } from "react-native";

import { useAppTheme } from "../../theme";
import { Text } from "./Text";

type ChoiceProps = PropsWithChildren<PressableProps> & {
  hint?: string | undefined;
  locked?: boolean | undefined;
};

// Minimum tappable height (logical px) — same WCAG 2.5.5 floor used by Button.
const MIN_TAPPABLE_HEIGHT = 48;
const DISABLED_OPACITY = 0.6;
const PRESSED_OPACITY = 0.76;

export function Choice({
  children,
  hint,
  locked = false,
  style,
  ...props
}: ChoiceProps) {
  const { tokens } = useAppTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: locked }}
      disabled={locked}
      style={({ pressed }) => [
        {
          alignItems: "center",
          backgroundColor: tokens.colors.surface,
          borderColor: tokens.colors.border,
          borderRadius: tokens.radii.sm,
          borderStyle: locked ? "dashed" : "solid",
          borderWidth: tokens.borderWidths.regular,
          flexDirection: "row",
          gap: tokens.spacing.sm,
          minHeight: MIN_TAPPABLE_HEIGHT,
          opacity: locked ? DISABLED_OPACITY : pressed ? PRESSED_OPACITY : 1,
          paddingHorizontal: tokens.spacing.md,
          paddingVertical: tokens.spacing.sm,
        } satisfies ViewStyle,
        style as StyleProp<ViewStyle>,
      ]}
      {...props}
    >
      <Text aria-hidden style={{ fontWeight: "700" }} tone="accent">
        {"->"}
      </Text>
      <View style={{ flex: 1 }}>
        <Text>{children}</Text>
      </View>
      {hint ? (
        <Text tone="muted" variant="caption">
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}
