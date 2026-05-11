import { View } from "react-native";

import { Button, Divider, Surface, Text } from "../../primitives";
import { useAppTheme } from "../../../theme";
import type { DeathVariantProps } from "../types";

/**
 * Bookish: tonal, manuscript-style closing page.
 *
 * Chosen automatically when the story metadata flags a tonal voice (the
 * Bone Cathedral / Iron Court family). Reads as a paper epilogue — no
 * heavy danger paint — with three quiet actions: start anew, share, see
 * the endings map.
 */
export function Bookish({
  ending,
  turnNumber,
  choicesMade,
  endingNumber,
  endingsTotal,
  onBeginAgain,
  onShareEnding,
  onSeeMap,
}: DeathVariantProps) {
  const { tokens } = useAppTheme();

  return (
    <Surface
      accessibilityLabel={`Ending: ${ending.title}`}
      padded
      style={{ gap: tokens.spacing.md }}
      testID="death-variant-bookish"
      variant="muted"
    >
      <View style={{ alignItems: "center", gap: tokens.spacing.xs }}>
        <Text
          muted
          style={{
            fontFamily: tokens.typography.families.mono,
            letterSpacing: 3,
          }}
          variant="caption"
        >
          — FINIS —
        </Text>
        <Text
          style={{
            fontFamily: tokens.typography.families.serif,
            fontStyle: "italic",
            textAlign: "center",
          }}
          variant="title"
        >
          And so the tale ended.
        </Text>
        <Divider />
        <Text
          style={{
            fontFamily: tokens.typography.families.serif,
            textAlign: "center",
          }}
          variant="body"
        >
          {ending.body}
        </Text>
        <Text
          style={{
            fontFamily: tokens.typography.families.serif,
            fontStyle: "italic",
            textAlign: "center",
          }}
          variant="subtitle"
        >
          {ending.title}
        </Text>
        <Divider />
        <Text muted variant="caption">
          {[
            typeof turnNumber === "number" ? `turn ${turnNumber}` : null,
            typeof choicesMade === "number"
              ? `${choicesMade} choices made`
              : null,
            typeof endingNumber === "number" && typeof endingsTotal === "number"
              ? `${endingNumber} of ${endingsTotal} endings`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: tokens.spacing.sm,
          justifyContent: "center",
        }}
      >
        {onBeginAgain ? (
          <Button accessibilityLabel="Start anew" onPress={onBeginAgain} variant="primary">
            Start anew
          </Button>
        ) : null}
        {onShareEnding ? (
          <Button accessibilityLabel="Share this ending" onPress={onShareEnding}>
            Share this ending
          </Button>
        ) : null}
        {onSeeMap ? (
          <Button accessibilityLabel="Endings map" onPress={onSeeMap}>
            Endings map
          </Button>
        ) : null}
      </View>
    </Surface>
  );
}
