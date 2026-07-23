import { Image, StyleProp, View, ViewStyle } from "react-native";

import { getStoryCoverSource } from "../../../lib/designAssets";
import { useAppTheme } from "../../../theme";
import { DeskObject } from "./DeskObject";

/**
 * Shelf (the-desk Wave 2, task 2.1 — R2.1/R3.1/DK3/DK6) — the LIBRARY funnel
 * object. A short row of book spines built from the bundled cover PNGs
 * (`getStoryCoverSource`, NO new image assets — R3.1) fills the DeskObject art
 * slot; the whole thing is one labeled 44px button that navigates to /library.
 * Data is props-only (DK4): DK-HOME passes the starter/library story ids it
 * already computes.
 */

// Cap the spines so the shelf reads as a shelf, not a smear — the desk has
// room for a handful of standing books, not the whole catalogue.
const MAX_SPINES = 5;
const SPINE_HEIGHT = 76;
const SPINE_WIDTH = 22;

export type ShelfProps = {
  /** Story ids whose covers become spines (starter/library — props-only, DK4). */
  storyIds: string[];
  /** Navigate to /library (DK-HOME supplies the router push). */
  onPress: () => void;
  /** Layout override (position on the desk). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Shelf({ storyIds, onPress, style, testID }: ShelfProps) {
  const { tokens } = useAppTheme();
  const spines = storyIds.slice(0, MAX_SPINES);

  const art = (
    <View
      style={{
        alignItems: "flex-end",
        flexDirection: "row",
        gap: tokens.spacing.xs,
        height: SPINE_HEIGHT,
        justifyContent: "center",
        width: "100%",
      }}
    >
      {spines.map((id, index) => (
        <Image
          accessibilityIgnoresInvertColors
          key={id}
          resizeMode="cover"
          source={getStoryCoverSource(id)}
          style={{
            backgroundColor: tokens.colors.text,
            borderRadius: tokens.radii.xs,
            // Stagger the heights so the spines read as individual books.
            height: SPINE_HEIGHT - (index % 3) * tokens.spacing.sm,
            width: SPINE_WIDTH,
          }}
        />
      ))}
    </View>
  );

  return (
    <DeskObject
      art={art}
      caption="Shelf"
      destination="Library ->"
      label="Library"
      onPress={onPress}
      style={style}
      {...(testID ? { testID } : {})}
    />
  );
}
