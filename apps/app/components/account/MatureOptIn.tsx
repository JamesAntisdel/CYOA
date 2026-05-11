import { useState } from "react";
import { Pressable, View } from "react-native";

import { Button, Stamp, Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";

type MatureOptInProps = {
  onAccept: () => void;
  onDecline: () => void;
  /**
   * When true, a brief revocation reminder is shown instead of full consent flow.
   * Use this when the surface is shown inside settings for revocation.
   */
  revocable?: boolean;
};

/**
 * Explicit mature opt-in. Defaults to off. Must be a clear, revocable choice.
 */
export function MatureOptIn({ onAccept, onDecline, revocable = false }: MatureOptInProps) {
  const { tokens } = useAppTheme();
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <Surface
      padded
      style={{
        borderColor: tokens.colors.danger,
        gap: tokens.spacing.md,
        maxWidth: 520,
        width: "100%",
      }}
    >
      <Stamp style={{ borderColor: tokens.colors.danger }}>
        Mature content
      </Stamp>
      <Text variant="title">Turn on mature content?</Text>

      <Text>
        Mature content can include violence, intense danger, frank language, and adult themes. We do
        not include sexual content involving anyone under 18 — ever.
      </Text>

      <Text muted variant="bodySmall">
        This setting is off by default. You can turn it back off any time from Settings.
      </Text>

      {revocable ? (
        <Text muted variant="caption">
          Revoking is immediate. Scenes that need mature content will fall back to safer prose.
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: acknowledged }}
        onPress={() => setAcknowledged((current) => !current)}
        style={{
          alignItems: "center",
          flexDirection: "row",
          gap: tokens.spacing.sm,
          minHeight: 44,
          paddingVertical: tokens.spacing.xs,
        }}
      >
        <View
          style={{
            backgroundColor: acknowledged ? tokens.colors.danger : "transparent",
            borderColor: tokens.colors.danger,
            borderRadius: tokens.radii.xs,
            borderWidth: tokens.borderWidths.regular,
            height: 18,
            width: 18,
          }}
        />
        <Text style={{ flex: 1 }} variant="bodySmall">
          I am 18 or older and consent to mature content.
        </Text>
      </Pressable>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
        <Button
          accessibilityLabel="Turn on mature content"
          disabled={!acknowledged}
          onPress={onAccept}
          variant="primary"
        >
          Turn on
        </Button>
        <Button accessibilityLabel="Keep mature content off" onPress={onDecline}>
          Keep it off
        </Button>
      </View>
    </Surface>
  );
}
