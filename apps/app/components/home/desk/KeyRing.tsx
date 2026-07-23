import { StyleProp, ViewStyle } from "react-native";

import { useAppTheme } from "../../../theme";
import { Icon } from "../../primitives";
import { DeskObject } from "./DeskObject";

/**
 * KeyRing (the-desk Wave 2, task 2.1 — R2.1) — the TROPHY-CRYPT object, the
 * ring of keys on the desk. Art-light: the existing `Icon` "key" glyph, no new
 * assets (R3.1). Navigates to /endings; the a11y label is the plain-words
 * destination "Trophies" (R2.2).
 */

const KEY_GLYPH_SIZE = 28;

export type KeyRingProps = {
  /** Navigate to /endings (DK-HOME supplies the router push). */
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function KeyRing({ onPress, style, testID }: KeyRingProps) {
  const { tokens } = useAppTheme();

  return (
    <DeskObject
      art={<Icon color={tokens.colors.accent} name="key" size={KEY_GLYPH_SIZE} />}
      caption="Key ring"
      destination="Trophies ->"
      label="Trophies"
      onPress={onPress}
      style={style}
      {...(testID ? { testID } : {})}
    />
  );
}
