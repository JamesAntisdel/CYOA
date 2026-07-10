import { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";

import { useAppTheme } from "../../theme";
import { Text } from "../primitives";
import type { ChoiceHistoryEntry } from "../../hooks/useTurn";

/**
 * EffectBadge — inline "what just changed" pill shown beneath the scene prose
 * (or alongside the choice list) so the reader sees the consequence of their
 * last pick AS they read the next scene. Hidden when the most recent echo is
 * the neutral/empty default ("the story remembered") — there is nothing
 * meaningful to surface in that case.
 *
 * Mounts with a 320ms fade-in to draw the eye to the change. Reduced-motion
 * readers see the badge immediately at full opacity instead.
 *
 * Theme tokens only: positive uses the accent color, negative uses danger,
 * neutral falls back to muted text — every value resolves through the active
 * theme so day/night/sepia all behave correctly.
 */
export type EffectBadgeProps = {
  /**
   * The most recent ChoiceHistoryEntry — i.e. the choice that brought the
   * reader to the CURRENT scene. When null the badge renders nothing.
   */
  entry: ChoiceHistoryEntry | null;
  /**
   * When true, skip the fade-in animation and render at full opacity.
   * Wired from the reader settings' reduceMotion flag.
   */
  reducedMotion?: boolean;
};

const NEUTRAL_ECHO_TEXTS = new Set(["the story remembered", "the room remembered"]);

function shouldRender(entry: ChoiceHistoryEntry | null): entry is ChoiceHistoryEntry {
  if (!entry) return false;
  const text = entry.echo.trim().toLowerCase();
  if (text.length === 0) return false;
  if (NEUTRAL_ECHO_TEXTS.has(text)) return false;
  return true;
}

export function EffectBadge({ entry, reducedMotion = false }: EffectBadgeProps) {
  const { tokens } = useAppTheme();
  const opacity = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  // Re-trigger the fade whenever the underlying turn changes — using
  // turnNumber + echo as the dependency means subsequent reads of the same
  // scene don't replay the animation but a new choice always does.
  const animationKey = entry ? `${entry.turnNumber}:${entry.echo}` : null;

  useEffect(() => {
    if (!animationKey) return;
    if (reducedMotion) {
      opacity.setValue(1);
      return;
    }
    opacity.setValue(0);
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [animationKey, opacity, reducedMotion]);

  if (!shouldRender(entry)) return null;

  const toneColor =
    entry.tone === "negative"
      ? tokens.colors.danger
      : entry.tone === "positive"
        ? tokens.colors.accent
        : tokens.colors.textMuted;
  const toneBackground =
    entry.tone === "negative" || entry.tone === "positive"
      ? tokens.colors.accentMuted
      : tokens.colors.surfaceMuted;
  const toneLabel =
    entry.tone === "negative"
      ? "unfavorable"
      : entry.tone === "positive"
        ? "favorable"
        : "noted";
  const accessibilityLabel = `Consequence of "${entry.choiceLabel}": ${entry.echo}. Result ${toneLabel}.`;

  return (
    <Animated.View
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      style={{
        alignSelf: "flex-start",
        backgroundColor: toneBackground,
        borderColor: toneColor,
        borderRadius: tokens.radii.pill,
        borderWidth: tokens.borderWidths.regular,
        flexDirection: "row",
        flexWrap: "wrap",
        gap: tokens.spacing.xs,
        opacity,
        paddingHorizontal: tokens.spacing.md,
        paddingVertical: tokens.spacing.xs,
      }}
    >
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
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ flexDirection: "row" }}
      >
        <Text muted variant="caption">
          from "{entry.choiceLabel}"
        </Text>
      </View>
    </Animated.View>
  );
}
