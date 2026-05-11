import { View } from "react-native";

import { Button, Divider, Stamp, Surface, Text } from "../../primitives";
import { VeoCinematic } from "../../media/VeoCinematic";
import { useAppTheme } from "../../../theme";
import type { DeathVariantProps } from "../types";

/**
 * Cinematic: Pro-only, first-find death with Veo playback.
 *
 * Gated upstream by the dispatcher to fire exactly once per ending per
 * account (the `firstFind` check) and only when the entitled tier allows
 * cinematic playback. Re-renders of an already-seen ending fall back to
 * the Brutal variant before reaching this component.
 *
 * Veo playback delegates to the existing `<VeoCinematic />` primitive.
 * If reduced motion is on, that component already shows a static
 * "Cinematic ready" surface.
 */
export function Cinematic({
  ending,
  turnNumber,
  cinematicUri,
  reducedMotion = false,
  onBeginAgain,
  onShareEnding,
}: DeathVariantProps) {
  const { tokens } = useAppTheme();

  return (
    <Surface
      accessibilityLabel={`Cinematic ending: ${ending.title}`}
      padded
      style={{
        backgroundColor: tokens.colors.text,
        borderColor: tokens.colors.danger,
        gap: tokens.spacing.md,
        overflow: "hidden",
      }}
      testID="death-variant-cinematic"
    >
      {cinematicUri ? (
        <VeoCinematic
          alt={`Final scene illustration for ${ending.title}`}
          reducedMotion={reducedMotion}
          uri={cinematicUri}
        />
      ) : (
        <View
          accessibilityLabel="Cinematic ending illustration unavailable"
          style={{
            backgroundColor: tokens.colors.overlay,
            borderColor: tokens.colors.borderMuted,
            borderRadius: tokens.radii.sm,
            borderWidth: tokens.borderWidths.hairline,
            minHeight: 180,
          }}
        />
      )}

      <View style={{ gap: tokens.spacing.xs }}>
        <Stamp
          style={{
            alignSelf: "flex-start",
            borderColor: tokens.colors.danger,
          }}
        >
          You died · turn {turnNumber ?? "—"}
        </Stamp>
        <Text
          style={{
            color: tokens.colors.background,
            fontFamily: tokens.typography.families.serif,
            fontStyle: "italic",
          }}
          variant="title"
        >
          {ending.title}
        </Text>
        <Text style={{ color: tokens.colors.background }} variant="body">
          {ending.body}
        </Text>
        <Text style={{ color: tokens.colors.textFaint }} variant="caption">
          First time anyone has reached this ending on your account. Share it
          before someone else does.
        </Text>
      </View>

      <Divider />

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: tokens.spacing.sm,
        }}
      >
        {onShareEnding ? (
          <Button
            accessibilityLabel="Share ending"
            onPress={onShareEnding}
            style={{ backgroundColor: tokens.colors.danger, borderColor: tokens.colors.danger }}
            variant="primary"
          >
            Share
          </Button>
        ) : null}
        {onBeginAgain ? (
          <Button
            accessibilityLabel="Begin again"
            onPress={onBeginAgain}
            style={{ backgroundColor: "transparent", borderColor: tokens.colors.background }}
          >
            Begin again
          </Button>
        ) : null}
      </View>
    </Surface>
  );
}
