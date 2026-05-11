import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";

import type { LibrarySave } from "../../hooks/useLibrary";
import { Chip, Stamp, Text } from "../primitives";
import { useAppTheme } from "../../theme";

export type ContinueReadingProps = {
  save: LibrarySave;
  /** Optional last-beat preview surfaced from the reader projection or scene cache. */
  lastBeatPreview?: string;
  /** Optional candle/turns status: e.g. "Candle 3 of 4" or "12 turns in". */
  candleStatus?: string;
  onContinue: (save: LibrarySave) => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * Continue Reading row for the home shelf. Sources its data from the
 * existing useLibrary save list (last-played beat number, mode, status)
 * and accepts optional richer preview/candle status from any caller that
 * has a reader projection in scope.
 *
 * Matches the canvas V.ContinueReadingBoard pattern: dark cover-style panel,
 * title, tone/status line, and a thumb-reachable continue tap target.
 */
export function ContinueReading({
  candleStatus,
  lastBeatPreview,
  onContinue,
  save,
  style,
}: ContinueReadingProps) {
  const { tokens } = useAppTheme();
  const status = candleStatus ?? deriveCandleStatus(save);

  return (
    <View style={[{ gap: tokens.spacing.sm }, style]}>
      <View
        style={{
          alignItems: "center",
          flexDirection: "row",
          gap: tokens.spacing.sm,
          justifyContent: "space-between",
        }}
      >
        <Text variant="subtitle">Continue reading</Text>
        <Stamp>{save.mode}</Stamp>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Continue ${save.title}, ${status}`}
        onPress={() => onContinue(save)}
        style={({ pressed }) => [
          {
            backgroundColor: tokens.colors.text,
            borderRadius: tokens.radii.sm,
            gap: tokens.spacing.sm,
            minHeight: 96,
            opacity: pressed ? 0.85 : 1,
            padding: tokens.spacing.lg,
          } satisfies ViewStyle,
        ]}
      >
        <Text
          style={{
            color: tokens.colors.background,
            fontFamily: tokens.typography.families.serif,
            fontSize: tokens.typography.title,
            fontWeight: "700",
          }}
        >
          {save.title}
        </Text>
        {lastBeatPreview ? (
          <Text
            numberOfLines={2}
            style={{
              color: tokens.colors.background,
              opacity: 0.78,
            }}
          >
            {lastBeatPreview}
          </Text>
        ) : null}
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            flexWrap: "wrap",
            gap: tokens.spacing.sm,
            justifyContent: "space-between",
          }}
        >
          <Chip
            style={{ backgroundColor: tokens.colors.background, borderColor: tokens.colors.background }}
          >
            {status}
          </Chip>
          <Text
            style={{
              color: tokens.colors.background,
              fontWeight: "700",
            }}
          >
            Resume
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

function deriveCandleStatus(save: LibrarySave): string {
  if (save.status === "dead") return "Candle out";
  if (save.status === "ended") return "Tale closed";
  if (save.status === "ended_safely") return "Closed safely";
  if (save.turnNumber <= 0) return "Candle lit";
  return `Turn ${save.turnNumber}`;
}
