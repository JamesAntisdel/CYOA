import { PropsWithChildren } from "react";
import { View, ViewProps } from "react-native";

import { useAppTheme } from "../../theme";
import { Text } from "./Text";

export function Stamp({ children, style, ...props }: PropsWithChildren<ViewProps>) {
  const { tokens } = useAppTheme();

  return (
    <View
      style={[
        {
          alignSelf: "flex-start",
          borderColor: tokens.colors.accent,
          borderRadius: tokens.radii.xs,
          borderWidth: tokens.borderWidths.regular,
          paddingHorizontal: tokens.spacing.sm,
          paddingVertical: tokens.spacing.xs,
        },
        style,
      ]}
      {...props}
    >
      <Text
        style={{
          color: tokens.colors.accent,
          fontFamily: tokens.typography.families.mono,
          fontWeight: "700",
          textTransform: "uppercase",
        }}
        variant="caption"
      >
        {children}
      </Text>
    </View>
  );
}
