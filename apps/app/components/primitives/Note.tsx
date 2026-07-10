import { PropsWithChildren } from "react";
import { TextProps } from "react-native";

import { Text } from "./Text";

export function Note({ children, style, ...props }: PropsWithChildren<TextProps>) {
  return (
    <Text
      style={[{ fontStyle: "italic" }, style]}
      tone="accent"
      variant="bodySmall"
      {...props}
    >
      {children}
    </Text>
  );
}
