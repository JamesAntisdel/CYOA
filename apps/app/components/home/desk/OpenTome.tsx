import { Image, StyleProp, ViewStyle } from "react-native";

import { getStoryCoverSource } from "../../../lib/designAssets";
import { useAppTheme } from "../../../theme";
import { DeskObject } from "./DeskObject";

/**
 * OpenTome (the-desk Wave 2, task 2.1 — R2.1/R2.3/DK3/DK6) — the CONTINUE
 * funnel object, the tome at the centre of the desk. With an in-progress save
 * it shows that story's cover (`getStoryCoverSource`, NO new image assets —
 * R3.1) as the open book and navigates to /read/[saveId]; the a11y label names
 * the destination in plain words ("Continue reading <title>", R2.2). With NO
 * in-progress save it renders as the CLOSED tome — dimmed, art-less, quiet
 * (R2.3) — while StartHere carries the first-visit funnel as the primary. Data
 * is props-only (DK4): DK-HOME passes the `continueSave` it already computes.
 */

/** The slice of a library save the tome needs — plain-words props, no hooks. */
export type ContinueSaveInfo = {
  saveId: string;
  storyId: string;
  title: string;
};

export type OpenTomeProps = {
  /** The reader's in-progress save, or null when there is none (R2.3). */
  continueSave: ContinueSaveInfo | null;
  /** Open the reader at this save (DK-HOME's `openSave`). */
  onOpenSave: (saveId: string) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

// The open cover, sized to a 7:10 book aspect so it reads as a tome, not a card.
const COVER_HEIGHT = 160;
const COVER_WIDTH = 112;

export function OpenTome({ continueSave, onOpenSave, style, testID }: OpenTomeProps) {
  const { tokens } = useAppTheme();

  if (!continueSave) {
    // No in-progress save: the tome is closed and greyed (R2.3). No art => the
    // DeskObject renders its clean token frame; `dimmed` reads it as inactive.
    return (
      <DeskObject
        caption="The tome"
        dimmed
        label="No tale in progress yet"
        onPress={() => {}}
        style={style}
        variant="muted"
        {...(testID ? { testID } : {})}
      />
    );
  }

  const art = (
    <Image
      accessibilityIgnoresInvertColors
      resizeMode="cover"
      source={getStoryCoverSource(continueSave.storyId)}
      style={{
        backgroundColor: tokens.colors.text,
        borderRadius: tokens.radii.xs,
        height: COVER_HEIGHT,
        width: COVER_WIDTH,
      }}
    />
  );

  return (
    <DeskObject
      art={art}
      caption="The open tome"
      destination="Continue reading ->"
      label={`Continue reading ${continueSave.title}`}
      onPress={() => onOpenSave(continueSave.saveId)}
      style={style}
      variant="base"
      {...(testID ? { testID } : {})}
    />
  );
}
