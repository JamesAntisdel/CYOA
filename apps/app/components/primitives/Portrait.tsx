import { View, ViewProps } from "react-native";

import { useAppTheme } from "../../theme";
import { Text } from "./Text";

type PortraitProps = ViewProps & {
  label?: string;
  size?: number;
};

export function Portrait({ label = "portrait", size = 44, style, ...props }: PortraitProps) {
  const { tokens } = useAppTheme();

  return (
    <View
      accessibilityLabel={label}
      style={[
        {
          alignItems: "center",
          backgroundColor: tokens.colors.surfaceMuted,
          borderColor: tokens.colors.border,
          borderRadius: size / 2,
          borderWidth: tokens.borderWidths.regular,
          height: size,
          justifyContent: "center",
          width: size,
        },
        style,
      ]}
      {...props}
    >
      <Text muted numberOfLines={1} variant="caption">
        {label.slice(0, 2).toUpperCase()}
      </Text>
    </View>
  );
}
