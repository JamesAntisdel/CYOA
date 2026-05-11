import { View } from "react-native";

import { Button, Divider, Surface, Text } from "../../primitives";
import { useAppTheme } from "../../../theme";
import type { DeathVariantProps } from "../types";

/**
 * Brutal: stark, accent-on-dark "You died." treatment.
 *
 * Default death variant. Uses the `danger` token per the Ember Rule for
 * the death stamp, an accent-coloured headline, and the title/body from
 * the engine ending. Provides "begin again" and (when available) "see the
 * map" actions.
 */
export function Brutal({
  ending,
  turnNumber,
  endingNumber,
  endingsTotal,
  hardcore,
  onBeginAgain,
  onSeeMap,
}: DeathVariantProps) {
  const { tokens } = useAppTheme();

  return (
    <Surface
      accessibilityLabel={`Death: ${ending.title}`}
      padded
      style={{
        backgroundColor: tokens.colors.text,
        borderColor: tokens.colors.danger,
        gap: tokens.spacing.md,
      }}
      testID="death-variant-brutal"
    >
      <View style={{ alignItems: "center", gap: tokens.spacing.sm }}>
        <Text
          style={{
            color: tokens.colors.danger,
            fontFamily: tokens.typography.families.mono,
            fontWeight: "700",
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
          variant="caption"
        >
          You died
        </Text>
        <Text
          style={{
            color: tokens.colors.background,
            fontFamily: tokens.typography.families.serif,
            fontStyle: "italic",
            textAlign: "center",
          }}
          variant="display"
        >
          {ending.title}
        </Text>
        <Divider />
        <Text
          style={{ color: tokens.colors.background, textAlign: "center" }}
          variant="body"
        >
          {ending.body}
        </Text>
        {typeof endingNumber === "number" && typeof endingsTotal === "number" ? (
          <Text
            style={{ color: tokens.colors.textFaint, textAlign: "center" }}
            variant="caption"
          >
            Ending #{endingNumber} of {endingsTotal}
            {typeof turnNumber === "number" ? ` · turn ${turnNumber}` : ""}
          </Text>
        ) : null}
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
          <Button
            accessibilityLabel="Begin again"
            onPress={onBeginAgain}
            style={{ backgroundColor: tokens.colors.danger, borderColor: tokens.colors.danger }}
            variant="primary"
          >
            Begin again
          </Button>
        ) : null}
        {onSeeMap ? (
          <Button
            accessibilityLabel="See the map"
            onPress={onSeeMap}
            style={{
              backgroundColor: "transparent",
              borderColor: tokens.colors.background,
            }}
          >
            See the map
          </Button>
        ) : null}
      </View>

      {hardcore ? (
        <Text
          muted
          style={{ color: tokens.colors.textFaint, textAlign: "center" }}
          variant="caption"
        >
          Hardcore mode · save purged
        </Text>
      ) : null}
    </Surface>
  );
}
