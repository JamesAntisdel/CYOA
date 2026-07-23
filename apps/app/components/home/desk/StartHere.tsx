import { StyleProp, ViewStyle } from "react-native";

import { DeskObject } from "./DeskObject";

/**
 * StartHere (the-desk Wave 2, task 2.1 — R4.2/DK6) — the MANDATORY tutorial-
 * start funnel object. When there is no in-progress save this is the PRIMARY,
 * most-prominent object on the desk (the closed tome sits quiet beside it), at
 * least as prominent as today's "Start {tutorial}" button (R4.2). It fires the
 * existing `launchTutorial` callback (props-only — DK4); the a11y label names
 * the tutorial in plain words ("Start <title>", R2.2).
 */

export type StartHereProps = {
  /** The tutorial story title (from DK-HOME's tutorialStory), or null. */
  tutorialTitle: string | null;
  /** Launch the tutorial save (DK-HOME's `launchTutorial`). */
  onPress: () => void;
  /**
   * Render as the primary/most-prominent object (the bright `base` frame). True
   * by default — StartHere is the first-visit funnel primary (R4.2/DK6). DK-HOME
   * can pass false to demote it (e.g. when a returning reader already has a tome).
   */
  primary?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function StartHere({
  tutorialTitle,
  onPress,
  primary = true,
  style,
  testID,
}: StartHereProps) {
  const label = tutorialTitle ? `Start ${tutorialTitle}` : "Start Tutorial";

  return (
    <DeskObject
      caption="Begin"
      destination="Start here ->"
      label={label}
      onPress={onPress}
      style={style}
      variant={primary ? "base" : "muted"}
      {...(testID ? { testID } : {})}
    />
  );
}
