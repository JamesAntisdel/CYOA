import { useState } from "react";
import { Pressable, View } from "react-native";

import { useBreakpoint } from "../../lib/responsive";
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
  const { isPhone } = useBreakpoint();
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    // MatureOptIn renders inline (not inside RN Modal) so the host route
    // controls visibility. We still want full-coverage behavior on phone:
    // width 100% guarantees the Surface fills its parent column, and the
    // maxWidth: "100%" override on phone defeats the 520px cap so a 375px
    // viewport gets every available pixel of read-room for the consent
    // copy. This is the "modal coverage fix" the mobile pass calls out —
    // without it the 520-cap leaves whitespace gutters on either side of
    // the danger surface and the action buttons feel orphaned.
    <Surface
      padded
      style={{
        borderColor: tokens.colors.danger,
        gap: tokens.spacing.md,
        maxWidth: isPhone ? "100%" : 520,
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

      {/*
       * Consent action buttons. On phone we stack so each button claims
       * the full Surface width — two side-by-side buttons on a 327px
       * content row produce tiny ~160px CTAs that fail the comfortable
       * touch target. Desktop+ keeps the inline row.
       */}
      <View
        style={{
          flexDirection: isPhone ? "column" : "row",
          flexWrap: "wrap",
          gap: tokens.spacing.sm,
        }}
      >
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
