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
  /**
   * Open-book spread (R4) — OPTIONAL drop-cap treatment. When true, the
   * first SETTLED paragraph's first letter renders enlarged in the accent,
   * spanning ~2–3 serif lines, like a printed book's illuminated capital.
   *
   * ABSENT (the default) ⇒ every other layout renders byte-identically
   * (OB6 / R7.2): none of the drop-cap code below runs. It is a settled-
   * paragraph treatment — while `isStreaming`, the cap is suppressed so it
   * never fights the reveal (R4.3); it appears only once the paragraph has
   * settled. A too-short first paragraph degrades to the normal render (no
   * orphaned cap — R4.2), decided purely by `splitDropCap`.
   */
  dropCap?: boolean;
};

/**
 * Minimum first-paragraph length (chars) that can hold a ~2–3 line drop cap
 * without leaving a giant orphaned capital next to a stub of text. Below this
 * the cap degrades to the normal render (R4.2).
 */
export const DROP_CAP_MIN_CHARS = 120;

export type DropCapSplit =
  | { readonly hasDropCap: false }
  | {
      readonly hasDropCap: true;
      /** Any opening punctuation/whitespace BEFORE the cap (e.g. a `"` quote), un-enlarged. */
      readonly lead: string;
      /** The single enlarged initial letter/digit. */
      readonly cap: string;
      /** The remainder of the prose after the cap. */
      readonly rest: string;
    };

/**
 * PURE — split the prose into `{ lead, cap, rest }` for a drop cap, or report
 * that the scene is too short to carry one (R4.2). The cap illuminates the
 * first LETTER/DIGIT of the first paragraph; an opening quote or dash rides in
 * front of it as the (un-enlarged) `lead` so `"The…` still illuminates T.
 *
 * No React / React Native — the ProseRenderer and its `.test.mjs` import the
 * SAME logic, and the short-scene degradation is exercised for real.
 */
export function splitDropCap(
  text: string,
  minChars: number = DROP_CAP_MIN_CHARS,
): DropCapSplit {
  const source = typeof text === "string" ? text : "";
  // The drop cap illuminates only the FIRST paragraph (up to the first blank
  // line). A scene whose opener is too short to wrap around a large capital
  // degrades to the normal render (no orphaned cap).
  const breakAt = source.search(/\n[ \t]*\n/);
  const firstPara = breakAt === -1 ? source : source.slice(0, breakAt);
  if (firstPara.trim().length < minChars) return { hasDropCap: false };
  const capMatch = /[\p{L}\p{N}]/u.exec(source);
  if (!capMatch) return { hasDropCap: false };
  const capIndex = capMatch.index;
  return {
    hasDropCap: true,
    lead: source.slice(0, capIndex),
    cap: source.slice(capIndex, capIndex + 1),
    rest: source.slice(capIndex + 1),
  };
}

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
  dropCap = false,
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

  // Drop cap is a SETTLED-paragraph treatment (R4.3): suppressed mid-stream so
  // it never fights the reveal, and absent entirely unless the layout opts in
  // (OB6). When inactive, everything below is the byte-identical original path.
  const dropCapActive = dropCap && !isStreaming;
  const baseFont = tokens.typography[textVariant];
  const dropCapStyle = {
    color: tokens.colors.accent,
    fontFamily: tokens.typography.families.serif,
    fontSize: Math.round(baseFont * 2.6),
    lineHeight: Math.round(baseFont * 2.3),
    fontWeight: "600" as const,
  };

  if (!blocks) {
    if (dropCapActive) {
      const split = splitDropCap(prose);
      if (split.hasDropCap) {
        return (
          <Text {...liveRegionProps} style={textStyle} variant={textVariant}>
            {split.lead}
            <Text style={dropCapStyle}>{split.cap}</Text>
            {split.rest}
          </Text>
        );
      }
    }
    return (
      <Text {...liveRegionProps} style={textStyle} variant={textVariant}>
        {prose}
      </Text>
    );
  }

  return (
    <View style={{ gap: tokens.spacing.sm }}>
      {blocks.map((block, index) => {
        if (block.kind === "dialog") {
          return (
            <DialogLine
              key={index}
              text={block.text}
              {...(block.speaker ? { speaker: block.speaker } : {})}
            />
          );
        }
        // The drop cap illuminates the FIRST prose block only — the parser
        // merges adjacent prose, so a scene that opens on narration has its
        // opener at index 0. A settled first block too short to carry the cap
        // degrades to the normal render (splitDropCap → hasDropCap:false).
        const split = index === 0 && dropCapActive ? splitDropCap(block.text) : null;
        return (
          <Fragment key={index}>
            {/* Only the first prose block gets the live-region prop so
                screen readers don't double-announce. */}
            <Text
              {...(index === 0 ? liveRegionProps : {})}
              style={textStyle}
              variant={textVariant}
            >
              {split && split.hasDropCap ? (
                <>
                  {split.lead}
                  <Text style={dropCapStyle}>{split.cap}</Text>
                  {split.rest}
                </>
              ) : (
                block.text
              )}
            </Text>
          </Fragment>
        );
      })}
    </View>
  );
}
