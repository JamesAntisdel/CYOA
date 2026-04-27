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
