import { PropsWithChildren } from "react";
import { TextProps } from "react-native";

import { useAppTheme } from "../../theme";
import { Text } from "./Text";

export function Note({ children, style, ...props }: PropsWithChildren<TextProps>) {
  const { tokens } = useAppTheme();

  return (
    <Text
      style={[
        {
          color: tokens.colors.accent,
          fontStyle: "italic",
        },
        style,
      ]}
      variant="bodySmall"
      {...props}
    >
      {children}
    </Text>
  );
}
