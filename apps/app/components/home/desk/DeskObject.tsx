import { ReactNode, useState } from "react";
import {
  GestureResponderEvent,
  Pressable,
  StyleProp,
  View,
  ViewStyle,
} from "react-native";

import { Text } from "../../primitives";
import { useAppTheme } from "../../../theme";

/**
 * DeskObject — the shared wrapper EVERY object on the Desk home uses (DK5).
 *
 * It is a REAL labeled button first and a diegetic decoration second: an
 * accessible `Pressable` (role "button", a REQUIRED plain-words `label`
 * naming the destination) with a >=44px target and a visible keyboard-focus
 * state. On top of that control sits a themed, token-only frame that holds
 * an OPTIONAL `art` slot — so a FUTURE painted-art pass (R3.2) swaps ONLY the
 * visual inside the slot without touching the button/label/nav wiring. When
 * no `art` is supplied the slot renders a clean token frame (never a broken
 * object).
 *
 * Art-light V1 rules honored here:
 *  - tokens only (no raw hex, no new image assets — R3.1/R3.3);
 *  - no control emoji — the icon font / text carry any glyph (RC5);
 *  - reduced-motion safe: this wrapper renders NO ambient motion by default,
 *    so a still desk is the baseline; the only visual feedback is an instant
 *    (un-animated) press dim + focus ring, which is safe under reduced-motion
 *    (DK8). Ambient flourishes (e.g. candle flicker) live in the specific
 *    object and are gated there.
 */
export type DeskObjectProps = {
  /**
   * REQUIRED plain-words destination for the screen reader, e.g.
   * "Library", "Today's tale", "Continue reading The Drowned Bell". The
   * diegetic look never costs a screen-reader user the plain meaning (R2.2).
   */
  label: string;
  /** Fires the navigation for this object. */
  onPress: (event: GestureResponderEvent) => void;
  /**
   * The small uppercase object name printed under the frame, e.g. "Shelf",
   * "Candle". Purely decorative — the `label` carries the a11y meaning.
   */
  caption?: string;
  /** A short visible destination hint under the caption, e.g. "Library ->". */
  destination?: string;
  /**
   * The visual for this object — a cover `Image`, spines, a glyph, etc. This
   * is the seam a future painted-art pass swaps (R3.2). When omitted the
   * frame renders a clean token placeholder.
   */
  art?: ReactNode;
  /**
   * Quiet/greyed state (e.g. the tome closed when there is no in-progress
   * save — R2.3). Still focusable/pressable unless combined with the caller's
   * own guard; dims the frame to read as "inactive".
   */
  dimmed?: boolean;
  /** Frame fill: the diegetic desk objects default to the muted surface. */
  variant?: "base" | "muted";
  /** Layout overrides merged onto the outer control (position on the desk). */
  style?: StyleProp<ViewStyle>;
  /** Optional test hook. */
  testID?: string;
};

// Minimum tappable target per WCAG 2.5.5 (44 logical px) — the same floor the
// Button primitive pins. Named so the magic number doesn't leak.
const MIN_TAPPABLE = 44;
// Minimum height of the art/frame slot so an art-less object still reads as a
// deliberate object on the desk (not a hairline box).
const ART_SLOT_MIN_HEIGHT = 72;
// Instant, un-animated press feedback — safe under reduced-motion.
const PRESSED_OPACITY = 0.78;
const DIMMED_OPACITY = 0.55;

export function DeskObject({
  label,
  onPress,
  caption,
  destination,
  art,
  dimmed = false,
  variant = "muted",
  style,
  testID,
}: DeskObjectProps) {
  const { tokens } = useAppTheme();
  // Focus is tracked explicitly (onFocus/onBlur) rather than via the RN-web
  // style callback so the focus ring is type-safe on every platform and needs
  // no animation to be visible (DK8).
  const [focused, setFocused] = useState(false);

  const frameFill =
    variant === "muted" ? tokens.colors.surfaceMuted : tokens.colors.surface;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: dimmed }}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        {
          alignItems: "center",
          gap: tokens.spacing.xs,
          minHeight: MIN_TAPPABLE,
          minWidth: MIN_TAPPABLE,
          opacity: dimmed ? DIMMED_OPACITY : pressed ? PRESSED_OPACITY : 1,
        } satisfies ViewStyle,
        style as StyleProp<ViewStyle>,
      ]}
    >
      {/* The diegetic frame + art slot — the ONLY thing a future art pass
          swaps (R3.2). Present art fills the slot; absent art => clean frame. */}
      <View
        style={{
          alignItems: "center",
          backgroundColor: frameFill,
          borderColor: focused ? tokens.colors.accent : tokens.colors.border,
          borderRadius: tokens.radii.sm,
          borderWidth: focused
            ? tokens.borderWidths.heavy
            : tokens.borderWidths.regular,
          justifyContent: "center",
          minHeight: ART_SLOT_MIN_HEIGHT,
          overflow: "hidden",
          padding: tokens.spacing.sm,
          width: "100%",
        }}
      >
        {art ?? (
          // Clean token frame when there is no art — a quiet inner panel, not
          // a broken object.
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              backgroundColor: tokens.colors.surface,
              borderColor: tokens.colors.borderMuted,
              borderRadius: tokens.radii.xs,
              borderWidth: tokens.borderWidths.hairline,
              flex: 1,
              minHeight: ART_SLOT_MIN_HEIGHT - tokens.spacing.md,
              width: "100%",
            }}
          />
        )}
      </View>
      {caption ? (
        <Text
          tone="muted"
          variant="caption"
          style={{
            letterSpacing: 1,
            textAlign: "center",
            textTransform: "uppercase",
          }}
        >
          {caption}
        </Text>
      ) : null}
      {destination ? (
        <Text tone="accent" variant="caption" style={{ textAlign: "center" }}>
          {destination}
        </Text>
      ) : null}
    </Pressable>
  );
}
