/**
 * NarratorControl — small inline indicator that combines three affordances
 * for the narrator (priority-1) audio layer:
 *
 *   1. A loading pip while the TTS asset is queued / generating. The
 *      visual style mirrors `BufferingPip` in MediaPlate.image.tsx (pulse
 *      0.4 → 1.0 → 0.4 at 600ms, accent color, pill-shaped).
 *   2. A pause / resume button while the narrator clip is mounted and
 *      ready to play. Toggling the button gates the narrator layer's
 *      `active` flag through `AudioMix`.
 *   3. A horizontal scrub bar showing current playback offset. Tapping
 *      anywhere on the bar seeks to that position; the filled portion is
 *      drawn in `accent`. Only renders when a clip is loaded and its
 *      duration is known (`duration > 0`).
 *
 * The control renders nothing when there is neither a loading state nor a
 * ready narrator clip — it is invisible by default and only surfaces when
 * narration is actually a thing for the current scene.
 *
 * Accessibility: the pause control exposes `accessibilityLabel="Pause
 * narration"` / `"Resume narration"` and `accessibilityRole="button"`. The
 * loading pip uses `role="progressbar"` mirroring the BufferingPip pattern.
 * The scrub bar uses `role="adjustable"` with min/max/now values so screen
 * readers report playback position.
 */
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  Pressable,
  View,
} from "react-native";

import { Text } from "../primitives";
import { useAppTheme } from "../../theme";

type NarratorControlProps = {
  /** Whether the TTS asset is still preparing (loading pip is shown). */
  loading: boolean;
  /** Whether a narrator clip is currently attached and playable. */
  hasNarrator: boolean;
  /** Whether the user has paused the narrator. */
  paused: boolean;
  /** Toggle handler — flips paused state. */
  onTogglePaused: () => void;
  /**
   * Current playback offset in seconds. Optional so legacy callers that
   * don't yet wire `useNarratorPlayback` continue to compile; when omitted
   * the scrub bar simply doesn't render.
   */
  currentTime?: number;
  /** Clip duration in seconds. 0 until metadata loads. */
  duration?: number;
  /** Seek to the given time (seconds). Optional; scrub bar omitted if absent. */
  onSeek?: (time: number) => void;
};

export function NarratorControl({
  currentTime,
  duration,
  hasNarrator,
  loading,
  onSeek,
  onTogglePaused,
  paused,
}: NarratorControlProps) {
  const { tokens } = useAppTheme();

  // Nothing to show — narrator isn't loading and isn't playable.
  if (!loading && !hasNarrator) return null;

  // Scrub bar only renders once we have a real duration. While the clip
  // is loading we'd otherwise display a zero-width filled bar that
  // visually drifts as soon as `loadedmetadata` fires; better to keep the
  // control row compact until the duration is real.
  const hasScrub =
    hasNarrator &&
    typeof duration === "number" &&
    typeof currentTime === "number" &&
    typeof onSeek === "function" &&
    duration > 0;

  return (
    <View style={{ gap: tokens.spacing.xs }}>
      <View
        style={{
          alignItems: "center",
          flexDirection: "row",
          gap: tokens.spacing.sm,
          justifyContent: "flex-end",
        }}
      >
        {loading ? <NarratorLoadingPip /> : null}
        {hasNarrator ? (
          <Pressable
            accessibilityLabel={paused ? "Resume narration" : "Pause narration"}
            accessibilityRole="button"
            accessibilityState={{ selected: paused }}
            hitSlop={8}
            onPress={onTogglePaused}
            style={({ pressed }) => ({
              alignItems: "center",
              backgroundColor: tokens.colors.surface,
              borderColor: tokens.colors.border,
              borderRadius: tokens.radii.pill,
              borderWidth: tokens.borderWidths.hairline,
              flexDirection: "row",
              gap: tokens.spacing.xs,
              opacity: pressed ? 0.78 : 1,
              paddingHorizontal: tokens.spacing.sm,
              paddingVertical: tokens.spacing.xs,
            })}
          >
            <Text style={{ fontFamily: tokens.typography.families.mono }} variant="bodySmall">
              {paused ? "▶" : "⏸"}
            </Text>
            <Text muted variant="bodySmall">
              {paused ? "Resume" : "Pause"}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {hasScrub ? (
        <NarratorScrubBar
          currentTime={currentTime as number}
          duration={duration as number}
          onSeek={onSeek as (time: number) => void}
        />
      ) : null}
    </View>
  );
}

/**
 * Horizontal scrub bar. The outer Pressable captures taps anywhere along
 * the track and converts the event's `locationX` into a seek target. The
 * inner filled View widens proportionally to `currentTime / duration`.
 *
 * The bar lives below the loading/pause row so the existing layout shape
 * is preserved when narration is loading but not yet playable.
 */
function NarratorScrubBar({
  currentTime,
  duration,
  onSeek,
}: {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
}) {
  const { tokens } = useAppTheme();
  const [trackWidth, setTrackWidth] = useState(0);

  const onLayout = (event: LayoutChangeEvent) => {
    const w = event.nativeEvent.layout.width;
    setTrackWidth(w);
  };

  const safeDuration = duration > 0 ? duration : 0;
  const safeCurrent = Math.max(0, Math.min(safeDuration, currentTime));
  const progress = safeDuration > 0 ? safeCurrent / safeDuration : 0;
  const filledWidth = Math.max(0, Math.min(trackWidth, trackWidth * progress));

  const handleSeek = (event: GestureResponderEvent) => {
    if (trackWidth <= 0 || safeDuration <= 0) return;
    const x = event.nativeEvent.locationX;
    const ratio = Math.max(0, Math.min(1, x / trackWidth));
    onSeek(ratio * safeDuration);
  };

  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: tokens.spacing.sm,
        justifyContent: "flex-end",
      }}
    >
      <Pressable
        accessibilityLabel="Narration progress"
        accessibilityRole="adjustable"
        accessibilityValue={{
          min: 0,
          max: Math.round(safeDuration),
          now: Math.round(safeCurrent),
        }}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        onLayout={onLayout}
        // onPressIn fires on the initial touch/click with locationX populated.
        // RN Web's onPress synthesizes a GestureResponderEvent that often
        // lacks locationX, so seek lookups resolve to 0.
        onPressIn={handleSeek}
        style={{
          backgroundColor: tokens.colors.surface,
          borderColor: tokens.colors.border,
          borderRadius: tokens.radii.pill,
          borderWidth: tokens.borderWidths.hairline,
          flex: 1,
          height: 6,
          maxWidth: 240,
          overflow: "hidden",
        }}
      >
        <View
          pointerEvents="none"
          style={{
            backgroundColor: tokens.colors.accent,
            borderRadius: tokens.radii.pill,
            height: "100%",
            width: filledWidth,
          }}
        />
      </Pressable>
      <Text
        muted
        style={{ fontFamily: tokens.typography.families.mono, minWidth: 76, textAlign: "right" }}
        variant="bodySmall"
      >
        {formatTime(safeCurrent)} / {formatTime(safeDuration)}
      </Text>
    </View>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Loading pip — mirrors the BufferingPip pattern in MediaPlate.image.tsx.
 * Renders a small pulsing accent dot in a pill, paired with a quiet
 * "Narrating..." note so the affordance is screen-reader friendly.
 */
function NarratorLoadingPip() {
  const { tokens } = useAppTheme();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View
      accessibilityLabel="Narration loading"
      accessibilityRole="progressbar"
      style={{
        alignItems: "center",
        backgroundColor: tokens.colors.surface,
        borderColor: tokens.colors.accent,
        borderRadius: tokens.radii.pill,
        borderWidth: tokens.borderWidths.regular,
        flexDirection: "row",
        gap: tokens.spacing.xs,
        paddingHorizontal: tokens.spacing.sm,
        paddingVertical: tokens.spacing.xs,
      }}
    >
      <Animated.View
        style={{
          backgroundColor: tokens.colors.accent,
          borderRadius: tokens.radii.pill,
          height: 6,
          opacity: pulse,
          width: 6,
        }}
      />
      <Text muted variant="bodySmall">
        Narrating...
      </Text>
    </View>
  );
}
