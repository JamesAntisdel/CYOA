import { useRouter } from "expo-router";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";

import type { LibrarySave } from "../../hooks/useLibrary";
import { Chip, Stamp, Text } from "../primitives";
import { useBreakpoint } from "../../lib/responsive";
import { useAppTheme } from "../../theme";

/**
 * Reading-modes R2.7 — a save is "finished" (an ended/dead run) when it
 * carries a terminal status. Only finished rows surface the "Read as book"
 * re-read affordance; active rows self-hide it (they belong to the live
 * reader, not the read-back shelf). Pure + exported so the drift test can
 * mirror it without importing the React Native component module.
 */
export function isFinishedSave(status: LibrarySave["status"]): boolean {
  return (
    status === "dead" || status === "ended" || status === "ended_safely"
  );
}

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
  const router = useRouter();
  const status = candleStatus ?? deriveCandleStatus(save);
  // R2.7 — the read-as-book target (/read/[saveId]/book) only exists as a
  // meaningful re-read for a finished run, so the affordance self-hides on
  // active saves.
  const showReadAsBook = isFinishedSave(save.status);
  // Phone gets a slightly smaller inner pad so the title doesn't crowd
  // against the rounded corners on a 375px viewport. Also keep the bottom
  // chip+Resume row stack-friendly via the flexWrap already in place.
  const { isPhone } = useBreakpoint();

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
            padding: isPhone ? tokens.spacing.md : tokens.spacing.lg,
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
      {showReadAsBook ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Read ${save.title} as a book`}
          onPress={() => router.push(`/read/${save.saveId}/book`)}
          style={({ pressed }) => [
            {
              alignItems: "center",
              borderColor: tokens.colors.border,
              borderRadius: tokens.radii.sm,
              borderWidth: tokens.borderWidths.hairline,
              opacity: pressed ? 0.7 : 1,
              paddingHorizontal: tokens.spacing.md,
              paddingVertical: tokens.spacing.sm,
            } satisfies ViewStyle,
          ]}
        >
          <Text style={{ fontWeight: "700" }}>Read as book</Text>
        </Pressable>
      ) : null}
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
