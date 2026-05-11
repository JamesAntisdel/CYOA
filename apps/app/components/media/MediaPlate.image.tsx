import { useEffect, useRef } from "react";
import { Animated, Easing, Image, View } from "react-native";

import { Note } from "../primitives";
import { useAppTheme } from "../../theme";

type MediaPlateImageProps = {
  uri: string;
  alt: string;
  /** Reduced motion users skip the 240ms fade-in. */
  reducedMotion: boolean;
  /** Show a small Veo-en-route corner pip (state 3 overlay). */
  videoBuffering?: boolean;
  /** Veo failed; show a quiet inline note that the cinematic is unavailable. */
  videoFailed?: boolean;
};

/**
 * State 2 — Imagen plate. Renders the ready illustration.
 *
 * Also serves as the visual base for state 3 (`videoBuffering`), with a small
 * corner pip overlaid to indicate Veo is en route. When Veo fails the same
 * image stays mounted (state 2 fallback per Requirement 27.5).
 */
export function MediaPlateImage({
  alt,
  reducedMotion,
  uri,
  videoBuffering = false,
  videoFailed = false,
}: MediaPlateImageProps) {
  const { tokens } = useAppTheme();
  const fade = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reducedMotion) {
      fade.setValue(1);
      return;
    }
    // Lift transition timing from canvas § 24A: ~240ms ease-out fade-in
    // when Imagen settles. This matches the typical ≤3s plate budget.
    Animated.timing(fade, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [fade, reducedMotion, uri]);

  return (
    <Animated.View
      accessibilityLabel={alt}
      accessibilityRole="image"
      style={{
        borderColor: tokens.colors.borderMuted,
        borderRadius: tokens.radii.sm,
        borderWidth: tokens.borderWidths.hairline,
        minHeight: reducedMotion ? 180 : 220,
        opacity: fade,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <Image
        accessibilityIgnoresInvertColors
        source={{ uri }}
        style={{ height: "100%", width: "100%" }}
      />
      {videoBuffering ? <BufferingPip /> : null}
      {videoFailed ? (
        <View
          style={{
            backgroundColor: tokens.colors.overlay,
            borderTopColor: tokens.colors.borderMuted,
            borderTopWidth: tokens.borderWidths.hairline,
            bottom: 0,
            left: 0,
            paddingHorizontal: tokens.spacing.md,
            paddingVertical: tokens.spacing.xs,
            position: "absolute",
            right: 0,
          }}
        >
          <Note style={{ textAlign: "center" }}>Cinematic unavailable</Note>
        </View>
      ) : null}
    </Animated.View>
  );
}

/**
 * State 3 — small corner pip indicating Veo is en route while the image stays.
 */
function BufferingPip() {
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
      accessibilityLabel="Cinematic loading"
      accessibilityRole="progressbar"
      style={{
        alignItems: "center",
        backgroundColor: tokens.colors.surface,
        borderColor: tokens.colors.accent,
        borderRadius: tokens.radii.pill,
        borderWidth: tokens.borderWidths.regular,
        bottom: tokens.spacing.sm,
        flexDirection: "row",
        gap: tokens.spacing.xs,
        paddingHorizontal: tokens.spacing.sm,
        paddingVertical: tokens.spacing.xs,
        position: "absolute",
        right: tokens.spacing.sm,
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
    </View>
  );
}
