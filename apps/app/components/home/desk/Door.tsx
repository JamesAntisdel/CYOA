import { StyleProp, ViewStyle } from "react-native";

import { useAppTheme } from "../../../theme";
import { Icon } from "../../primitives";
import { DeskObject } from "./DeskObject";

/**
 * Door (the-desk Wave 2, task 2.1 — R2.1) — the DISCOVERY object, the door off
 * the desk. Art-light: the existing `Icon` "eye" glyph, no new assets (R3.1).
 * Navigates to /discover; the a11y label is the plain-words destination
 * "Discover" (R2.2).
 */

const DOOR_GLYPH_SIZE = 28;

export type DoorProps = {
  /** Navigate to /discover (DK-HOME supplies the router push). */
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Door({ onPress, style, testID }: DoorProps) {
  const { tokens } = useAppTheme();

  return (
    <DeskObject
      art={<Icon color={tokens.colors.accent} name="eye" size={DOOR_GLYPH_SIZE} />}
      caption="The door"
      destination="Discover ->"
      label="Discover"
      onPress={onPress}
      style={style}
      {...(testID ? { testID } : {})}
    />
  );
}
