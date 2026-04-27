import { Image, View } from "react-native";

import { Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";
import { useMediaPreferences } from "../../hooks/useMediaPreferences";
import type { StreamingScene } from "../../hooks/useStreamingScene";
import { AmbientSoundscape } from "./AmbientSoundscape";
import { VeoCinematic } from "./VeoCinematic";

type SceneMediaProps = {
  media: StreamingScene["media"];
  muted?: boolean;
  appActive?: boolean;
  reducedMotion?: boolean;
};

export function SceneMedia({
  media,
  appActive,
  muted,
  reducedMotion,
}: SceneMediaProps) {
  const { tokens } = useAppTheme();
  const preferences = useMediaPreferences();
  const resolvedReducedMotion = reducedMotion ?? preferences.reducedMotion;
  const resolvedMuted = muted ?? preferences.muted ?? preferences.nativeBackground;
  const resolvedAppActive = appActive ?? preferences.appActive;

  if (!media || media.status === "idle") return null;

  const ambient = (
    <AmbientSoundscape
      appActive={resolvedAppActive}
      loop={media.ambient}
      muted={resolvedMuted}
      reducedMotion={resolvedReducedMotion}
    />
  );

  if (media.kind === "audio") return ambient;

  if (media.status !== "ready" || !media.uri) {
    const label =
      media.status === "queued"
        ? media.kind === "video"
          ? "Cinematic queued"
          : "Illustration queued"
        : media.status === "generating"
          ? media.kind === "video"
            ? "Cinematic generating"
            : "Illustration generating"
        : media.status === "blocked"
          ? "Media unavailable"
          : "Media failed";

    return (
      <>
        {ambient}
        <Surface padded variant="muted">
          <Text muted variant="bodySmall">
            {label}
          </Text>
        </Surface>
      </>
    );
  }

  if (media.kind === "video") {
    return (
      <>
        {ambient}
        <VeoCinematic alt={media.alt} reducedMotion={resolvedReducedMotion} uri={media.uri} />
      </>
    );
  }

  return (
    <>
      {ambient}
      <View
        accessibilityLabel={media.alt}
        style={{
          borderColor: tokens.colors.borderMuted,
          borderRadius: tokens.radii.sm,
          borderWidth: tokens.borderWidths.hairline,
          minHeight: resolvedReducedMotion ? 180 : 220,
          overflow: "hidden",
        }}
      >
        <Image
          accessibilityIgnoresInvertColors
          source={{ uri: media.uri }}
          style={{ height: "100%", width: "100%" }}
        />
      </View>
    </>
  );
}
