import { Text as NativeText, TextProps } from "react-native";

import { useAppTheme } from "../../theme";

export type IconName =
  | "book"
  | "candle"
  | "coin"
  | "eye"
  | "heart"
  | "hourglass"
  | "key"
  | "people"
  | "sack"
  | "skull";

const iconGlyphs: Record<IconName, string> = {
  book: "B",
  candle: "I",
  coin: "G",
  eye: "O",
  heart: "H",
  hourglass: "X",
  key: "K",
  people: "P",
  sack: "S",
  skull: "!",
};

type IconProps = TextProps & {
  color?: string;
  name?: IconName;
  size?: number;
};

export function Icon({ color, name = "candle", size = 16, style, ...props }: IconProps) {
  const { tokens } = useAppTheme();

  return (
    <NativeText
      accessibilityLabel={name}
      style={[
        {
          color: color ?? tokens.colors.text,
          fontFamily: tokens.typography.families.mono,
          fontSize: size,
          fontWeight: "700",
          lineHeight: Math.round(size * 1.2),
          textAlign: "center",
          width: size,
        },
        style,
      ]}
      {...props}
    >
      {iconGlyphs[name]}
    </NativeText>
  );
}
