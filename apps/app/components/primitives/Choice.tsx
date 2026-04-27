import { PropsWithChildren } from "react";
import { Pressable, PressableProps, StyleProp, View, ViewStyle } from "react-native";

import { useAppTheme } from "../../theme";
import { Text } from "./Text";

type ChoiceProps = PropsWithChildren<PressableProps> & {
  hint?: string | undefined;
  locked?: boolean | undefined;
};

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
          minHeight: 48,
          opacity: locked ? 0.55 : pressed ? 0.76 : 1,
          paddingHorizontal: tokens.spacing.md,
          paddingVertical: tokens.spacing.sm,
        } satisfies ViewStyle,
        style as StyleProp<ViewStyle>,
      ]}
      {...props}
    >
      <Text aria-hidden style={{ color: tokens.colors.accent, fontWeight: "700" }}>
        {"->"}
      </Text>
      <View style={{ flex: 1 }}>
        <Text>{children}</Text>
      </View>
      {hint ? (
        <Text muted variant="caption">
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}
