import { Platform, View } from "react-native";

import { Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";

type VeoCinematicProps = {
  uri: string;
  alt: string;
  reducedMotion: boolean;
};

export function VeoCinematic({ alt, reducedMotion, uri }: VeoCinematicProps) {
  const { tokens } = useAppTheme();

  // Defensive guard: an empty `uri` would mount `<video src="">` and trip
  // the browser's "Invalid URI" error on every render. The death variant
  // dispatcher already checks for a populated cinematicUri before reaching
  // here, but the primitive should still refuse to render with no source.
  if (typeof uri !== "string" || uri.length === 0) return null;

  if (reducedMotion) {
    return (
      <Surface padded variant="muted">
        <Text muted variant="bodySmall">
          Cinematic ready
        </Text>
      </Surface>
    );
  }

  if (Platform.OS === "web") {
    return (
      <View
        accessibilityLabel={alt}
        style={{
          borderColor: tokens.colors.borderMuted,
          borderRadius: tokens.radii.sm,
          borderWidth: tokens.borderWidths.hairline,
          minHeight: 220,
          overflow: "hidden",
        }}
      >
        <video
          aria-label={alt}
          autoPlay
          loop
          muted
          playsInline
          src={uri}
          style={{ height: "100%", objectFit: "cover", width: "100%" }}
        />
      </View>
    );
  }

  return (
    <Surface padded variant="muted">
      <Text muted variant="bodySmall">
        Cinematic ready
      </Text>
    </Surface>
  );
}
