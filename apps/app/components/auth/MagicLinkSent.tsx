import { View } from "react-native";

import { Button, Stamp, Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";

type MagicLinkSentProps = {
  email: string;
  onChangeEmail: () => void;
  onResend?: () => void;
  resendDisabled?: boolean;
};

export function MagicLinkSent({
  email,
  onChangeEmail,
  onResend,
  resendDisabled = false,
}: MagicLinkSentProps) {
  const { tokens } = useAppTheme();

  return (
    <Surface padded style={{ gap: tokens.spacing.lg, maxWidth: 480, width: "100%" }}>
      <View style={{ gap: tokens.spacing.xs }}>
        <Stamp>Link sent</Stamp>
        <Text variant="title">Check your inbox.</Text>
        <Text muted>
          We sent a sign-in link to{" "}
          <Text style={{ fontWeight: "700" }}>{email}</Text>. Tap it on this device to finish signing in.
        </Text>
      </View>

      <View
        accessibilityLiveRegion="polite"
        style={{
          backgroundColor: tokens.colors.surfaceMuted,
          borderColor: tokens.colors.borderMuted,
          borderRadius: tokens.radii.sm,
          borderWidth: tokens.borderWidths.hairline,
          gap: tokens.spacing.xs,
          padding: tokens.spacing.md,
        }}
      >
        <Text variant="caption" muted>
          Link expires in 15 minutes.
        </Text>
        <Text variant="caption" muted>
          Trouble finding it? Check spam, then resend.
        </Text>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
        {onResend ? (
          <Button
            accessibilityLabel="Resend sign-in link"
            disabled={resendDisabled}
            onPress={onResend}
            variant="primary"
          >
            Resend link
          </Button>
        ) : null}
        <Button accessibilityLabel="Use a different email" onPress={onChangeEmail}>
          Use a different email
        </Button>
      </View>
    </Surface>
  );
}
