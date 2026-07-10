import { View } from "react-native";

import { Icon, Note, Stamp, Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";

type MediaPlateSkeletonProps = {
  label: string;
  failed?: boolean;
  alt?: string | undefined;
};

/**
 * State 1 — paper-textured frame with candle ornament + microcopy.
 * Used while the Imagen job is queued/generating, or when image generation
 * has failed and no poster is available (fallback failure state).
 */
export function MediaPlateSkeleton({ alt, failed = false, label }: MediaPlateSkeletonProps) {
  const { tokens } = useAppTheme();

  return (
    <Surface
      accessibilityLabel={alt ?? label}
      accessibilityRole="image"
      padded
      style={{
        alignItems: "center",
        gap: tokens.spacing.md,
        justifyContent: "center",
        minHeight: 220,
        // Subtle paper-texture cue via doubled border on muted surface.
        backgroundColor: tokens.colors.surfaceMuted,
        borderStyle: failed ? "dashed" : "solid",
      }}
      variant="muted"
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{
          alignItems: "center",
          flexDirection: "row",
          gap: tokens.spacing.sm,
          justifyContent: "center",
        }}
      >
        <Icon
          color={failed ? tokens.colors.danger : tokens.colors.accent}
          name="candle"
          size={20}
        />
        <View
          style={{
            backgroundColor: failed ? tokens.colors.danger : tokens.colors.accent,
            height: tokens.borderWidths.regular,
            opacity: 0.6,
            width: 64,
          }}
        />
        <Icon
          color={failed ? tokens.colors.danger : tokens.colors.accent}
          name="candle"
          size={20}
        />
      </View>
      {failed ? (
        <Stamp accessibilityLabel="Illustration failed">FAILED</Stamp>
      ) : null}
      <Note style={{ textAlign: "center" }}>{label}</Note>
      {failed ? (
        <Text muted style={{ textAlign: "center" }} variant="caption">
          The story continues — prose remains primary.
        </Text>
      ) : null}
    </Surface>
  );
}
