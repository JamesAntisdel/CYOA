import { Fragment, useMemo } from "react";
import { View, type TextStyle, type StyleProp } from "react-native";

import { Text } from "../primitives";
import { useAppTheme } from "../../theme";
import { parseProseToBlocks } from "../../lib/dialogParse";
import { DialogLine } from "./DialogLine";

type ProseTextVariant = "body" | "subtitle";

type ProseRendererProps = {
  /**
   * Streamed (or final) scene prose. The renderer parses this into
   * prose + dialog blocks on every change. `useMemo` keyed on the
   * string keeps the work O(text length) per render rather than per
   * keystroke as the text streams in.
   */
  prose: string;
  /**
   * Whether the renderer is mid-stream. Forwarded to the prose Text as
   * `accessibilityLiveRegion="polite"` so screen readers announce the
   * incoming sentences as they arrive.
   */
  isStreaming: boolean;
  /**
   * Master switch — when false, the parser is bypassed and the prose
   * renders as a single `<Text>` block (the pre-Wave-0 behavior). The
   * settings → "Dialog blocks" toggle wires straight through here.
   */
  dialogBlocksEnabled: boolean;
  /**
   * Optional style override for the inner prose `<Text>`. Each layout
   * (Book, Mobile, Journal, etc.) passes the typography choice it
   * already used for its single-Text render so the visual treatment of
   * narration is unchanged.
   */
  textStyle?: StyleProp<TextStyle>;
  /**
   * Text variant for the prose chunks. Defaults to "body" — the
   * GraphicNovel layout uses "subtitle" for its speech-plate emphasis.
   */
  textVariant?: ProseTextVariant;
};

/**
 * ProseRenderer — the single integration point for the dialog-block
 * visual treatment. Each reader layout calls this in place of the
 * `<Text>{streamedProse}</Text>` it used to render directly.
 *
 * Behavior:
 *  - When `dialogBlocksEnabled` is false, renders the prose verbatim
 *    in one `<Text>` block. This is the bypass for the settings opt-out
 *    and the streaming-safe pre-parse path.
 *  - When true, parses the prose into prose + dialog blocks via
 *    `parseProseToBlocks` and emits a stacked View. Adjacent prose
 *    blocks were already merged by the parser, so the typical scene
 *    renders as prose → dialog → prose → ... with at most a few
 *    blocks per scene.
 *
 * The parse is memoized on the prose string — the parser is cheap
 * (regex per sentence, no allocations beyond the block array), but
 * streaming text changes the input every animation frame, so memo is
 * still worth the line.
 */
export function ProseRenderer({
  prose,
  isStreaming,
  dialogBlocksEnabled,
  textStyle,
  textVariant = "body",
}: ProseRendererProps) {
  const { tokens } = useAppTheme();
  const blocks = useMemo(
    () => (dialogBlocksEnabled ? parseProseToBlocks(prose) : null),
    [dialogBlocksEnabled, prose],
  );

  // Live-region prop must be passed conditionally — under
  // exactOptionalPropertyTypes:true we can't pass `undefined`.
  const liveRegionProps = isStreaming
    ? ({ accessibilityLiveRegion: "polite" } as const)
    : ({} as const);

  if (!blocks) {
    return (
      <Text {...liveRegionProps} style={textStyle} variant={textVariant}>
        {prose}
      </Text>
    );
  }

  return (
    <View style={{ gap: tokens.spacing.sm }}>
      {blocks.map((block, index) =>
        block.kind === "dialog" ? (
          <DialogLine
            key={index}
            text={block.text}
            {...(block.speaker ? { speaker: block.speaker } : {})}
          />
        ) : (
          <Fragment key={index}>
            {/* Only the first prose block gets the live-region prop so
                screen readers don't double-announce. */}
            <Text
              {...(index === 0 ? liveRegionProps : {})}
              style={textStyle}
              variant={textVariant}
            >
              {block.text}
            </Text>
          </Fragment>
        ),
      )}
    </View>
  );
}
