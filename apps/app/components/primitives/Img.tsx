import { View, ViewProps } from "react-native";

import { useAppTheme } from "../../theme";
import { Text } from "./Text";

type ImgProps = ViewProps & {
  label?: string;
};

export function Img({ label = "image", style, ...props }: ImgProps) {
  const { tokens } = useAppTheme();

  return (
    <View
      accessibilityLabel={label}
      style={[
        {
          alignItems: "center",
          aspectRatio: 16 / 9,
          backgroundColor: tokens.colors.surfaceMuted,
          borderColor: tokens.colors.border,
          borderRadius: tokens.radii.sm,
          borderWidth: tokens.borderWidths.regular,
          justifyContent: "center",
          overflow: "hidden",
          width: "100%",
        },
        style,
      ]}
      {...props}
    >
      <Text muted style={{ fontFamily: tokens.typography.families.mono }} variant="caption">
        {label.toUpperCase()}
      </Text>
    </View>
  );
}
