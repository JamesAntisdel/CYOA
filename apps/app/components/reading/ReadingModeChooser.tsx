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

/**
 * Pure gate for the Pro-only Novel row. Novel is a paid mode (it maps to the
 * SAME `pro_media` paywall as Illustrated Book); a non-entitled reader sees it
 * locked. Extracted as a standalone function so the gating decision is unit-
 * testable without mounting the RN tree. `isPro` defaults to entitled at the
 * call sites, so absent the flag nothing is ever locked (byte-identical to the
 * pre-gate behavior the settings drawer relies on).
 */
export function isReadingModeLocked(mode: ReadingMode, isPro: boolean): boolean {
  return mode === "novel" && !isPro;
}

export type ReadingModeChooserProps = {
  value: ReadingMode;
  onChange: (mode: ReadingMode) => void;
  /** Show the small "How this story reads" caption above the two rows. */
  caption?: boolean;
  /**
   * Whether the reader is entitled to the Pro-gated Novel mode. Defaults to
   * `true` so existing callers (incl. the settings drawer, owned elsewhere)
   * compile and behave UNCHANGED — nothing is ever locked unless a create
   * surface explicitly passes `isPro={false}`. When false, the Novel row shows
   * a " · Pro" affordance and a tap routes through {@link onNovelLocked}.
   */
  isPro?: boolean;
  /**
   * Called when a non-Pro reader taps the locked Novel row, INSTEAD of
   * `onChange("novel")`. Create surfaces route this to the pro_media paywall,
   * mirroring the reader-side switch + Illustrated Book. No-op by default.
   */
  onNovelLocked?: () => void;
};

export function ReadingModeChooser({
  value,
  onChange,
  caption = false,
  isPro = true,
  onNovelLocked,
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
        // Novel is a Pro mode. A non-entitled reader sees a " · Pro" suffix
        // (matching Illustrated Book in the settings drawer) and a muted,
        // dimmed row; the tap routes to the paywall via onNovelLocked instead
        // of committing the switch (mirrors the reader-side switch's needs_pro
        // → pro_media route). The Pro/entitled path is byte-identical to before.
        const locked = isReadingModeLocked(mode, isPro);
        const displayLabel = locked ? `${meta.label} · Pro` : meta.label;
        return (
          <Pressable
            key={mode}
            accessibilityLabel={
              locked
                ? `${meta.label}, Pro feature. ${meta.blurb}`
                : `${meta.label}. ${meta.blurb}`
            }
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => {
              if (locked) {
                onNovelLocked?.();
                return;
              }
              onChange(mode);
            }}
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
              // Dim the locked row so it reads as a gated affordance, matching
              // the Illustrated Book pill treatment.
              opacity: locked ? 0.7 : 1,
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
                {displayLabel}
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
