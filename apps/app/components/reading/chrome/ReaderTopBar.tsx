import { Pressable, View } from "react-native";

import { useAppTheme } from "../../../theme";
import { Bar, Icon, Text } from "../../primitives";

/**
 * The single shared reader page-column width (RC9 / R7.1). Every piece of
 * ReaderScreen-owned chrome (this bar, the story ribbon, the interstitials)
 * caps its CONTENT to this width and centers it, so on a wide monitor the tome
 * reads as a page on a desk — never a toolbar stretched edge to edge. 760
 * matches the widest self-capping layout (Book / Novel).
 */
// RC9 — ONE shared page-column constant for the whole chrome directory. The
// canonical declaration lives in ribbonSegments.ts; re-exported here so
// existing import sites (ReaderScreen) keep working without a second copy
// that could drift when the phase-2 marginalia rail retunes the column.
export { PAGE_COLUMN_MAX } from "./ribbonSegments";
import { PAGE_COLUMN_MAX } from "./ribbonSegments";

// Every top-bar touch target clears the 44px Apple HIG floor (R1.4). The bar
// is one text-row tall: a fixed `minHeight` means the presence or absence of
// the optional Auto indicator / wick never shifts the row vertically (R1.2).
const TARGET = 44;

export type ReaderTopBarProps = {
  /** The tale's title — mono caption, single line, ellipsized (R1.1). */
  storyTitle: string;
  /** Exit / brand candle → home (R1.1). */
  onExit: () => void;
  /** Open the Tome menu (R2.1). */
  onOpenTome: () => void;
  /**
   * Inline candle-wick meter — present ONLY when today's `showCandleMeter`
   * rule holds (RC2). Mirrors `CandleBurnMeter`'s props
   * (reading/CandleGutter.tsx:28) so the caller passes the same turn state.
   */
  wick?: { turnsUsed: number; turnsAllowed: number };
  /**
   * Compact Auto indicator — present ONLY when auto-read is ON (R1.2). Tapping
   * it pauses auto (the one-tap wheel-grab, preserved — RC4). When OFF the prop
   * is absent and the indicator does not render; the row height is fixed, so
   * its absence causes zero vertical layout shift.
   */
  auto?: { on: true; onPause: () => void };
};

/**
 * R1 — the slim single-row reader top bar that replaces the old AppNav mount:
 * left an exit/brand candle → home, center the ellipsized mono title, right the
 * optional Auto indicator, the optional candle wick, and the Tome trigger
 * (`book` glyph + the "Tome" text at every width — U2). Purely presentational:
 * no data fetching, all state arrives as props.
 */
export function ReaderTopBar({
  storyTitle,
  onExit,
  onOpenTome,
  wick,
  auto,
}: ReaderTopBarProps) {
  const { tokens } = useAppTheme();

  const remaining = wick ? Math.max(0, wick.turnsAllowed - wick.turnsUsed) : 0;
  const burnPct =
    wick && wick.turnsAllowed > 0
      ? Math.round((wick.turnsUsed / wick.turnsAllowed) * 100)
      : 0;

  return (
    // Outer view spans the row so a desktop hairline background can extend full
    // width (R7.2); the inner view caps CONTENT to the page column and centers
    // it, so glyphs / title / wick stay inside the column at every width.
    <View style={{ alignItems: "center", alignSelf: "stretch" }}>
      <View
        accessibilityLabel="Reader toolbar"
        style={{
          alignItems: "center",
          flexDirection: "row",
          gap: tokens.spacing.sm,
          maxWidth: PAGE_COLUMN_MAX,
          minHeight: TARGET,
          width: "100%",
        }}
      >
        {/* Left — exit / brand candle → home. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Leave the tale"
          onPress={onExit}
          style={({ pressed }) => ({
            alignItems: "center",
            justifyContent: "center",
            minHeight: TARGET,
            minWidth: TARGET,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Icon name="candle" size={20} />
        </Pressable>

        {/* Center — story title. Mono caption, single line, ellipsized. */}
        <Text
          accessibilityRole="header"
          ellipsizeMode="tail"
          numberOfLines={1}
          style={{
            flex: 1,
            fontFamily: tokens.typography.families.mono,
            letterSpacing: 0.5,
            textTransform: "uppercase",
          }}
          variant="caption"
        >
          {storyTitle}
        </Text>

        {/* Right cluster — Auto indicator (only when auto ON), wick (only when
            showCandleMeter), then the always-present Tome trigger. */}
        {auto ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Pause auto-read"
            accessibilityState={{ selected: true }}
            onPress={auto.onPause}
            style={({ pressed }) => ({
              alignItems: "center",
              backgroundColor: tokens.colors.accent,
              borderRadius: tokens.radii.pill,
              justifyContent: "center",
              minHeight: TARGET,
              opacity: pressed ? 0.7 : 1,
              paddingHorizontal: tokens.spacing.sm,
            })}
          >
            <Text
              style={{ color: tokens.colors.background, fontWeight: "800" }}
              variant="caption"
            >
              Auto
            </Text>
          </Pressable>
        ) : null}

        {wick ? (
          <View
            accessibilityLabel={`The day's candle: ${remaining} turns of light remain`}
            style={{ justifyContent: "center", minHeight: TARGET, width: 44 }}
          >
            {/* Reuse the Bar primitive's candle mode for the wick (design §1). */}
            <Bar candle pct={burnPct} />
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tome"
          onPress={onOpenTome}
          style={({ pressed }) => ({
            alignItems: "center",
            flexDirection: "row",
            gap: tokens.spacing.xs,
            minHeight: TARGET,
            opacity: pressed ? 0.7 : 1,
            paddingHorizontal: tokens.spacing.xs,
          })}
        >
          <Icon name="book" size={18} />
          {/* U2 — the "Tome" text renders at EVERY width. An unlabeled glyph is
              undiscoverable to a first-session reader, so the label is the coach
              mark; never hide it behind a breakpoint. */}
          <Text style={{ fontWeight: "800" }} variant="caption">
            Tome
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
