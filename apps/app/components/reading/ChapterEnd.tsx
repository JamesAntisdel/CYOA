import { View } from "react-native";

import { Button, Stamp, Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";
import type { ChoiceHistoryEntry } from "../../hooks/useTurn";
import type { RemoteCinematicView } from "../../lib/cinematicApi";
import { CinematicMoment } from "../media/CinematicMoment";
import { ConsequenceReel } from "./ConsequenceReel";

type ChapterEndProps = {
  chapterIndex: number;
  storyTitle: string;
  entries: ChoiceHistoryEntry[];
  nextChapterHint?: string | undefined;
  onContinue: () => void;
  onSaveAndClose?: () => void;
  /** The Omni chapter-stinger cinematic, if one was generated for this save. */
  cinematic?: RemoteCinematicView;
  reducedMotion?: boolean;
  muted?: boolean;
  audioEnabled?: boolean;
  /**
   * Story-engagement Wave 1 (R1.5, design §4.1) — when this chapter boundary
   * coincides with an act advance (an `act_advanced` diff on the turn), the
   * recap stamps the new act ("Act II — <label>"). Both optional: a normal
   * chapter boundary (no act change) omits them and the stamp doesn't render.
   */
  actNumber?: number;
  actLabel?: string;
  /**
   * Act-mementos (R3.4) — two book-voice lines that ride the act-boundary recap
   * beside the act `Stamp`. `mementoLine` acknowledges the memento pressed
   * server-side ("A memento is pressed between the pages"); `rankTickerLine`
   * echoes the next Librarian rung ("Next: Keeper — 2 more endings"). Both are
   * optional and self-hide (zero layout shift): they render ONLY alongside an
   * act stamp, so plain chapter boundaries and legacy saves are unchanged (BC9).
   */
  mementoLine?: string;
  rankTickerLine?: string;
};

const ACT_ROMAN = ["I", "II", "III", "IV", "V"];
function actRoman(n: number): string {
  if (n < 1) return "I";
  if (n <= ACT_ROMAN.length) return ACT_ROMAN[n - 1]!;
  return String(n);
}

const ROMAN_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

function romanize(index: number): string {
  if (index < 1) return "I";
  if (index <= ROMAN_NUMERALS.length) return ROMAN_NUMERALS[index - 1]!;
  return String(index);
}

/**
 * Chapter-end interstitial per canvas § 12 / `W.ChapterEndBoard`. Surfaces the
 * consequence reel for the chapter that just closed and offers a continue
 * affordance. The reel is sourced from `turn_history` + visible-tier engine
 * diffs by `useTurn`; this surface only displays and is fully skippable.
 *
 * Safety: hidden flags and hidden attributes never reach this surface — the
 * upstream history builder filters them.
 */
export function ChapterEnd({
  chapterIndex,
  storyTitle,
  entries,
  nextChapterHint,
  onContinue,
  onSaveAndClose,
  cinematic,
  reducedMotion = false,
  muted = false,
  audioEnabled = true,
  actNumber,
  actLabel,
  mementoLine,
  rankTickerLine,
}: ChapterEndProps) {
  const { tokens } = useAppTheme();
  const chapterLabel = `Chapter ${romanize(chapterIndex)}`;
  const actStamp =
    actNumber !== undefined
      ? `Act ${actRoman(actNumber)}${actLabel ? ` — ${actLabel}` : ""}`
      : null;

  return (
    <Surface
      accessibilityLabel={`${chapterLabel} ended. Your choices echoed.`}
      padded
      style={{ gap: tokens.spacing.lg }}
      variant="muted"
    >
      {/* Omni chapter-stinger cinematic — a short "movie of this chapter" above
          the consequence reel. Absent ⇒ the reel carries the interstitial. */}
      {cinematic ? (
        <CinematicMoment
          cinematic={cinematic}
          reducedMotion={reducedMotion}
          muted={muted}
          audioEnabled={audioEnabled}
        />
      ) : null}

      <View style={{ gap: tokens.spacing.xs }}>
        {actStamp ? (
          <Stamp accessibilityLabel={`${actStamp} begins`}>{actStamp}</Stamp>
        ) : null}
        {/* Act-mementos (R3.4): the memento acknowledgement + rank ticker ride
            the act stamp only. Both self-hide when absent, and gating on
            `actStamp` keeps every non-act boundary byte-identical to today. */}
        {actStamp && mementoLine ? (
          <Text
            style={{ color: tokens.colors.accent, fontStyle: "italic" }}
            variant="caption"
          >
            {mementoLine}
          </Text>
        ) : null}
        {actStamp && rankTickerLine ? (
          <Text muted variant="caption">
            {rankTickerLine}
          </Text>
        ) : null}
        <Stamp>End of {chapterLabel.toLowerCase()}</Stamp>
        <Text
          style={{
            fontFamily: tokens.typography.families.serif,
            fontStyle: "italic",
          }}
          variant="title"
        >
          A pause between pages.
        </Text>
        <Text muted variant="caption">
          {storyTitle} · {entries.length} {entries.length === 1 ? "decision" : "decisions"}
        </Text>
      </View>

      <ConsequenceReel entries={entries} />

      {nextChapterHint ? (
        <View style={{ gap: tokens.spacing.xs }}>
          <Text
            muted
            style={{
              fontFamily: tokens.typography.families.mono,
              letterSpacing: 3,
              textTransform: "uppercase",
            }}
            variant="caption"
          >
            Up next
          </Text>
          <Text
            style={{
              fontFamily: tokens.typography.families.serif,
              fontStyle: "italic",
            }}
            variant="subtitle"
          >
            {nextChapterHint}
          </Text>
        </View>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
        <Button onPress={onContinue} variant="primary">
          Begin next chapter
        </Button>
        {onSaveAndClose ? (
          <Button onPress={onSaveAndClose} variant="ghost">
            Save and close
          </Button>
        ) : null}
      </View>
    </Surface>
  );
}
