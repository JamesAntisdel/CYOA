import { View } from "react-native";

import { Button, Stamp, Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";
import type { ChoiceHistoryEntry } from "../../hooks/useTurn";
import { ConsequenceReel } from "./ConsequenceReel";

type ChapterEndProps = {
  chapterIndex: number;
  storyTitle: string;
  entries: ChoiceHistoryEntry[];
  nextChapterHint?: string | undefined;
  onContinue: () => void;
  onSaveAndClose?: () => void;
};

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
}: ChapterEndProps) {
  const { tokens } = useAppTheme();
  const chapterLabel = `Chapter ${romanize(chapterIndex)}`;

  return (
    <Surface
      accessibilityLabel={`${chapterLabel} ended. Your choices echoed.`}
      padded
      style={{ gap: tokens.spacing.lg }}
      variant="muted"
    >
      <View style={{ gap: tokens.spacing.xs }}>
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
