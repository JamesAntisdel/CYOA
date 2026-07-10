import { useEffect, useRef } from "react";
import { Animated, Easing, Image } from "react-native";

import { useAppTheme } from "../../theme";

type MediaPlateImageProps = {
  uri: string;
  alt: string;
  /** Reduced motion users skip the 240ms fade-in. */
  reducedMotion: boolean;
};

/**
 * State 3 — Imagen plate. Renders the ready illustration above the prose
 * surface. This is the page's visual anchor: once mounted, the URI stays
 * here until the next scene arrives. Veo cinematics live in a sibling
 * slot below the prose; they never swap this plate in place.
 */
export function MediaPlateImage({ alt, reducedMotion, uri }: MediaPlateImageProps) {
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
        aspectRatio: 16 / 9,
        borderColor: tokens.colors.borderMuted,
        borderRadius: tokens.radii.sm,
        borderWidth: tokens.borderWidths.hairline,
        opacity: fade,
        overflow: "hidden",
        position: "relative",
        width: "100%",
      }}
    >
      <Image
        accessibilityIgnoresInvertColors
        resizeMode="cover"
        source={{ uri }}
        style={{ height: "100%", width: "100%" }}
      />
    </Animated.View>
  );
}
