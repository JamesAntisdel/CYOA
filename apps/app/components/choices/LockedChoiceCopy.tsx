import { View } from "react-native";

import { Text } from "../primitives";
import { useAppTheme } from "../../theme";

type LockedChoiceCopyProps = {
  /**
   * Optional visible hint shown to the reader. The hint should describe an
   * observable in-world signal (e.g. "the door is barred") — never a hidden
   * flag, stat threshold, or scripted requirement name.
   */
  hint?: string | undefined;
  /**
   * Near-miss band on a numeric (stat/currency) gate, precomputed server-side
   * (BC10 — the client only ever sees the phrase, never value/threshold).
   * Absent on binary item/flag gates and legacy projections.
   */
  nearness?: "near" | "far" | undefined;
};

/**
 * Tome-voice near-miss lines. "near" tells the reader their nerve nearly
 * suffices (come back one scene stronger); "far" warns the door wants real
 * growth first. No stat names, no numbers — the band is all we know here.
 */
const NEARNESS_COPY: Record<"near" | "far", string> = {
  near: "You nearly suffice — a little more, and this would give way.",
  far: "This asks far more of you than you yet possess.",
};

/**
 * Spec-gap guidance shown beneath a locked choice. The copy must not reveal
 * any hidden flags, raw stat thresholds, or scripted requirement IDs. We
 * surface a generic narrator note plus an optional in-world hint.
 *
 * Contrast note: the in-world hint was previously rendered as `muted
 * variant="caption"`, which on the day theme dropped to ~52% opacity ink
 * and read as almost-disappeared microcopy. The user-flagged "muted-text
 * issue" hit this line hardest, so the hint now renders at bodySmall with
 * the regular text color — still secondary to the headline but actually
 * readable.
 */
export function LockedChoiceCopy({ hint, nearness }: LockedChoiceCopyProps) {
  const { tokens } = useAppTheme();

  return (
    <View
      accessibilityLabel="Locked choice guidance"
      style={{
        borderColor: tokens.colors.danger,
        borderLeftWidth: tokens.borderWidths.regular,
        gap: tokens.spacing.xs,
        paddingHorizontal: tokens.spacing.md,
        paddingVertical: tokens.spacing.sm,
      }}
    >
      <Text style={{ color: tokens.colors.danger, fontWeight: "700" }} variant="caption">
        Path closed for now
      </Text>
      <Text variant="bodySmall">
        Something the story has not yet given you would be needed here.
      </Text>
      {hint ? (
        <Text style={{ color: tokens.colors.textMuted }} variant="bodySmall">
          {hint}
        </Text>
      ) : null}
      {nearness ? (
        <Text style={{ fontStyle: "italic" }} variant="bodySmall">
          {NEARNESS_COPY[nearness]}
        </Text>
      ) : null}
    </View>
  );
}
