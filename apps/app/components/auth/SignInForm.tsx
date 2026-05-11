import { useState } from "react";
import { TextInput, View } from "react-native";

import { Button, Divider, Stamp, Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";

export type SignInProvider = "apple" | "google" | "email";

type SignInFormProps = {
  defaultEmail?: string;
  disabled?: boolean;
  error?: string | null;
  onSendMagicLink: (email: string) => void;
  onProviderSignIn?: (provider: Exclude<SignInProvider, "email">) => void;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignInForm({
  defaultEmail = "",
  disabled = false,
  error = null,
  onSendMagicLink,
  onProviderSignIn,
}: SignInFormProps) {
  const { tokens } = useAppTheme();
  const [email, setEmail] = useState(defaultEmail);
  const [touched, setTouched] = useState(false);

  const trimmed = email.trim();
  const emailValid = EMAIL_PATTERN.test(trimmed);
  const showError = touched && !emailValid;
  const submitDisabled = disabled || !emailValid;

  const handleSubmit = () => {
    setTouched(true);
    if (!emailValid) return;
    onSendMagicLink(trimmed);
  };

  return (
    <Surface padded style={{ gap: tokens.spacing.lg, maxWidth: 480, width: "100%" }}>
      <View style={{ gap: tokens.spacing.xs }}>
        <Stamp>Sign in</Stamp>
        <Text variant="title">Keep the tale yours.</Text>
        <Text muted variant="bodySmall">
          Saves stay portable across devices once you sign in. No password — we send a link to your inbox.
        </Text>
      </View>

      <View style={{ gap: tokens.spacing.sm }}>
        <Text variant="caption" muted>
          Email address
        </Text>
        <TextInput
          accessibilityLabel="Email address"
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          editable={!disabled}
          inputMode="email"
          keyboardType="email-address"
          onBlur={() => setTouched(true)}
          onChangeText={setEmail}
          onSubmitEditing={handleSubmit}
          placeholder="reader@yourdomain.com"
          placeholderTextColor={tokens.colors.textFaint}
          style={{
            backgroundColor: tokens.colors.background,
            borderColor: tokens.colors.border,
            borderRadius: tokens.radii.sm,
            borderWidth: tokens.borderWidths.regular,
            color: tokens.colors.text,
            fontSize: tokens.typography.body,
            minHeight: 44,
            paddingHorizontal: tokens.spacing.md,
            paddingVertical: tokens.spacing.sm,
          }}
          value={email}
        />
        {showError ? (
          <Text variant="caption" style={{ color: tokens.colors.danger }}>
            Enter a valid email address.
          </Text>
        ) : null}
        {error ? (
          <Text variant="caption" style={{ color: tokens.colors.danger }}>
            {error}
          </Text>
        ) : null}
      </View>

      <Button
        accessibilityLabel="Send sign-in link"
        disabled={submitDisabled}
        onPress={handleSubmit}
        variant="primary"
      >
        Send sign-in link
      </Button>

      <View style={{ alignItems: "center", flexDirection: "row", gap: tokens.spacing.sm }}>
        <Divider style={{ flex: 1 }} />
        <Text muted variant="caption">
          or continue with
        </Text>
        <Divider style={{ flex: 1 }} />
      </View>

      <View style={{ flexDirection: "row", gap: tokens.spacing.sm }}>
        <Button
          accessibilityLabel="Continue with Apple"
          disabled={disabled}
          onPress={() => onProviderSignIn?.("apple")}
          style={{ flex: 1 }}
        >
          Apple
        </Button>
        <Button
          accessibilityLabel="Continue with Google"
          disabled={disabled}
          onPress={() => onProviderSignIn?.("google")}
          style={{ flex: 1 }}
        >
          Google
        </Button>
      </View>
    </Surface>
  );
}
