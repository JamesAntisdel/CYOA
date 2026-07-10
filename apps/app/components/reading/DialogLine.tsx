import { View } from "react-native";

import { Text } from "../primitives";
import { useAppTheme } from "../../theme";

type DialogLineProps = {
  /**
   * Optional speaker label. Rendered as a small-caps muted tag above the
   * dialog text. Omit when the parser couldn't resolve attribution — the
   * dialog block still renders, just without the label row.
   */
  speaker?: string;
  /**
   * The utterance itself, including its quotation marks if any. The
   * parser preserves the quotes the LLM emitted so the visual quote
   * marks survive into the rendered block.
   */
  text: string;
};

/**
 * DialogLine — visual treatment for a single dialog block emitted by
 * `parseProseToBlocks`. Indented from the prose margin with a left
 * accent rule so dialog reads as distinctly grouped without breaking
 * the column. The speaker name, when present, sits as a small-caps
 * muted label above the utterance.
 *
 * All spacing / color / typography is read from theme tokens — no
 * hardcoded values. The block honors `accessibilityRole="text"` so
 * screen readers treat the speaker tag + utterance as one announceable
 * unit ("Mira: I won't help you.") instead of two disjoint fragments.
 */
export function DialogLine({ speaker, text }: DialogLineProps) {
  const { tokens } = useAppTheme();

  // Compose the screen-reader label so the speaker tag and utterance
  // are announced together. Falls back to the utterance alone when
  // attribution wasn't resolved.
  const accessibilityLabel = speaker ? `${speaker}: ${text}` : text;

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      style={{
        // Left accent rule anchors the dialog visually on the speaker
        // side. The accentMuted color picks up the active theme's
        // signature tint (ember in day / sepia, candle in night).
        borderLeftColor: tokens.colors.accentMuted,
        borderLeftWidth: tokens.borderWidths.heavy,
        // Indent from the prose margin so dialog blocks step in from
        // the surrounding narration. Token spacing.md (~12px) plus the
        // left border gives roughly the ~24px the spec asks for without
        // hardcoding a pixel value.
        marginLeft: tokens.spacing.sm,
        paddingLeft: tokens.spacing.md,
        // Vertical breathing room between the dialog block and adjacent
        // prose. The parent Surface owns inter-block gap, but a tiny
        // padding here keeps the border rule from kissing the text.
        paddingVertical: tokens.spacing.xs,
        gap: tokens.spacing.xs,
      }}
    >
      {speaker ? (
        <Text
          muted
          style={{
            color: tokens.colors.textMuted,
            fontFamily: tokens.typography.families.mono,
            // Small-caps look without depending on a font that ships
            // SMCP — uppercase + tracked letter-spacing is the same
            // pattern used by Stamp and the rail labels.
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
          variant="caption"
        >
          {speaker}
        </Text>
      ) : null}
      <Text
        style={{
          // Italic body + serif family marks the tone shift from
          // narration without losing readability. Mirrors the
          // GraphicNovel layout's prose treatment so the visual
          // language stays consistent across the app.
          fontFamily: tokens.typography.families.serif,
          fontStyle: "italic",
        }}
        variant="body"
      >
        {text}
      </Text>
    </View>
  );
}
