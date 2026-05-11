import { View } from "react-native";

import { Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";
import type { ChoiceHistoryEntry } from "../../hooks/useTurn";

type ConsequenceReelProps = {
  entries: ChoiceHistoryEntry[];
};

const toneAccessibleLabel: Record<ChoiceHistoryEntry["tone"], string> = {
  positive: "favorable",
  neutral: "noted",
  negative: "unfavorable",
};

/**
 * The "your choices echoed" list from canvas § 12. One row per visible choice
 * the reader made during the chapter, with the publicly safe echo derived
 * from engine diffs. Hidden flags and hidden attributes are never displayed —
 * the entries arrive already filtered by `deriveEngineEcho` in `useTurn`.
 */
export function ConsequenceReel({ entries }: ConsequenceReelProps) {
  const { tokens } = useAppTheme();

  if (entries.length === 0) {
    return (
      <Text muted variant="bodySmall">
        No echoing choices were recorded in this chapter.
      </Text>
    );
  }

  return (
    <View accessibilityLabel="Your choices echoed" style={{ gap: tokens.spacing.xs }}>
      <Text
        muted
        style={{
          fontFamily: tokens.typography.families.mono,
          letterSpacing: 3,
          textTransform: "uppercase",
        }}
        variant="caption"
      >
        Your choices echoed
      </Text>
      <Surface padded style={{ gap: tokens.spacing.sm }} variant="muted">
        {entries.map((entry, index) => (
          <ReelRow
            entry={entry}
            isLast={index === entries.length - 1}
            key={`${entry.turnNumber}-${entry.choiceLabel}`}
          />
        ))}
      </Surface>
    </View>
  );
}

type ReelRowProps = {
  entry: ChoiceHistoryEntry;
  isLast: boolean;
};

function ReelRow({ entry, isLast }: ReelRowProps) {
  const { tokens } = useAppTheme();
  const toneColor =
    entry.tone === "negative"
      ? tokens.colors.danger
      : entry.tone === "positive"
        ? tokens.colors.accent
        : tokens.colors.textFaint;

  return (
    <View
      accessibilityLabel={`Choice ${entry.choiceLabel}. Result ${toneAccessibleLabel[entry.tone]}.`}
      style={{
        borderBottomColor: tokens.colors.borderMuted,
        borderBottomWidth: isLast ? 0 : tokens.borderWidths.hairline,
        flexDirection: "row",
        gap: tokens.spacing.md,
        justifyContent: "space-between",
        paddingBottom: tokens.spacing.xs,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{
            fontFamily: tokens.typography.families.serif,
            fontStyle: "italic",
          }}
          variant="body"
        >
          You {entry.choiceLabel.toLowerCase()}.
        </Text>
        <Text muted variant="caption">
          {entry.fromSceneTitle} {"->"} {entry.toSceneTitle}
        </Text>
      </View>
      <Text
        style={{
          color: toneColor,
          fontFamily: tokens.typography.families.mono,
          letterSpacing: 1,
          textTransform: "uppercase",
        }}
        variant="caption"
      >
        {entry.echo}
      </Text>
    </View>
  );
}
