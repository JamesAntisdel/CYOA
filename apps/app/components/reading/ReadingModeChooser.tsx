import { Pressable, View } from "react-native";

import {
  ModeMark,
  READING_MODE_META,
  type ReadingMode,
} from "../../lib/readingMode";
import { useAppTheme } from "../../theme";
import { Text } from "../primitives";

/**
 * `ReadingModeChooser` — the ONE two-option control for content Axis 1
 * ("Branching" vs "Novel"), replacing the three duplicated inline toggles the
 * cleanup retires. Presentational only: it fetches nothing and persists
 * nothing — the owner passes the current `value` and handles the switch in
 * `onChange` (create flow → local state; reader drawer → the server mutation).
 *
 * Radio semantics: a `radiogroup` wrapping two 44px `radio` rows, each showing
 * the drawn {@link ModeMark}, the label, and the ALWAYS-visible blurb from
 * {@link READING_MODE_META} so both modes are legible side by side.
 */
const MODES: readonly ReadingMode[] = ["branching", "novel"];

export type ReadingModeChooserProps = {
  value: ReadingMode;
  onChange: (mode: ReadingMode) => void;
  /** Show the small "How this story reads" caption above the two rows. */
  caption?: boolean;
};

export function ReadingModeChooser({
  value,
  onChange,
  caption = false,
}: ReadingModeChooserProps) {
  const { tokens } = useAppTheme();

  return (
    <View accessibilityRole="radiogroup" style={{ gap: tokens.spacing.sm }}>
      {caption ? (
        <Text muted variant="caption">
          How this story reads
        </Text>
      ) : null}
      {MODES.map((mode) => {
        const selected = mode === value;
        const meta = READING_MODE_META[mode];
        return (
          <Pressable
            key={mode}
            accessibilityLabel={`${meta.label}. ${meta.blurb}`}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(mode)}
            style={{
              alignItems: "flex-start",
              backgroundColor: selected
                ? tokens.colors.surfaceMuted
                : "transparent",
              borderColor: selected
                ? tokens.colors.accent
                : tokens.colors.borderMuted,
              borderRadius: tokens.radii.md,
              borderWidth: selected
                ? tokens.borderWidths.regular
                : tokens.borderWidths.hairline,
              flexDirection: "row",
              gap: tokens.spacing.md,
              minHeight: 44,
              padding: tokens.spacing.md,
            }}
          >
            <View style={{ paddingTop: tokens.spacing.xs }}>
              <ModeMark mode={mode} size={22} />
            </View>
            <View style={{ flex: 1, gap: tokens.spacing.xs }}>
              <Text
                style={{ fontFamily: tokens.typography.families.serif }}
                variant="subtitle"
              >
                {meta.label}
              </Text>
              <Text muted variant="bodySmall">
                {meta.blurb}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
