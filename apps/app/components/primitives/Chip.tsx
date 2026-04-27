import { PropsWithChildren, ReactNode } from "react";
import { StyleProp, View, ViewProps, ViewStyle } from "react-native";

import { useAppTheme } from "../../theme";
import { Text } from "./Text";

type ChipProps = PropsWithChildren<ViewProps> & {
  icon?: ReactNode;
};

export function Chip({ children, icon, style, ...props }: ChipProps) {
  const { tokens } = useAppTheme();

  return (
    <View
      accessibilityRole="text"
      style={[
        {
          alignItems: "center",
          alignSelf: "flex-start",
          backgroundColor: tokens.colors.surface,
          borderColor: tokens.colors.border,
          borderRadius: tokens.radii.pill,
          borderWidth: tokens.borderWidths.regular,
          flexDirection: "row",
          gap: tokens.spacing.xs,
          minHeight: 28,
          paddingHorizontal: tokens.spacing.sm,
        } satisfies ViewStyle,
        style as StyleProp<ViewStyle>,
      ]}
      {...props}
    >
      {icon}
      <Text variant="caption">{children}</Text>
    </View>
  );
}
