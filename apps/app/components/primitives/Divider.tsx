import { View, ViewProps } from "react-native";

import { useAppTheme } from "../../theme";

export function Divider({ style, ...props }: ViewProps) {
  const { tokens } = useAppTheme();

  return (
    <View
      accessibilityRole="none"
      style={[
        {
          backgroundColor: tokens.colors.borderMuted,
          height: tokens.borderWidths.regular,
          width: "100%",
        },
        style,
      ]}
      {...props}
    />
  );
}
