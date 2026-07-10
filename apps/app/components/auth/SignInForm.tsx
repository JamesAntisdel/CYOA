import { useState } from "react";
import { View } from "react-native";

import { SOCIAL_PROVIDER_LABELS, type SocialProvider } from "../../lib/authApi";
import { useBreakpoint } from "../../lib/responsive";
import { Button, Divider, Field, Note, Stamp, Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";

export type { SocialProvider } from "../../lib/authApi";
/** @deprecated use SocialProvider; kept for callers that also model the email path. */
export type SignInProvider = SocialProvider | "email";

type SignInFormProps = {
  defaultEmail?: string;
  disabled?: boolean;
  error?: string | null;
  /** When false the email magic-link entry is hidden (server has no email delivery). */
  magicLinkEnabled?: boolean;
  /** Social providers to render — only configured/available providers should be passed. */
  socialProviders?: SocialProvider[];
  onSendMagicLink: (email: string) => void;
  onProviderSignIn?: (provider: SocialProvider) => void;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignInForm({
  defaultEmail = "",
  disabled = false,
  error = null,
  magicLinkEnabled = true,
  socialProviders = ["apple", "google"],
  onSendMagicLink,
  onProviderSignIn,
}: SignInFormProps) {
  const { tokens } = useAppTheme();
  const { isPhone } = useBreakpoint();
  const [email, setEmail] = useState(defaultEmail);
  const [touched, setTouched] = useState(false);

  const trimmed = email.trim();
  const emailValid = EMAIL_PATTERN.test(trimmed);
  const showError = touched && !emailValid;
  const submitDisabled = disabled || !emailValid;

  const hasSocial = socialProviders.length > 0;
  const nothingAvailable = !magicLinkEnabled && !hasSocial;

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
          Saves stay portable across devices once you sign in.
          {magicLinkEnabled ? " No password — we send a link to your inbox." : ""}
        </Text>
      </View>

      {nothingAvailable ? (
        <Note>
          Sign-in is not configured for this environment yet. Add an auth provider or email delivery to enable it.
        </Note>
      ) : null}

      {/*
       * Magic-link field. Single primary action ("Send sign-in link") sits below.
       * Validation copy routes through Field's `error` slot so the danger-color
       * caption is rendered consistently with account / settings forms. Hidden
       * entirely when the server has no email delivery configured.
       */}
      {magicLinkEnabled ? (
        <>
          <Field
            accessibilityLabel="Email address"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            editable={!disabled}
            error={showError ? "Enter a valid email address." : error ?? null}
            inputMode="email"
            keyboardType="email-address"
            label="Email address"
            onBlur={() => setTouched(true)}
            onChangeText={setEmail}
            onSubmitEditing={handleSubmit}
            placeholder="reader@yourdomain.com"
            value={email}
          />

          <Button
            accessibilityLabel="Send sign-in link"
            disabled={submitDisabled}
            onPress={handleSubmit}
            variant="primary"
          >
            Send sign-in link
          </Button>
        </>
      ) : null}

      {!magicLinkEnabled && error ? <Note>{error}</Note> : null}

      {magicLinkEnabled && hasSocial ? (
        <View style={{ alignItems: "center", flexDirection: "row", gap: tokens.spacing.sm }}>
          <Divider style={{ flex: 1 }} />
          <Text muted variant="caption">
            or continue with
          </Text>
          <Divider style={{ flex: 1 }} />
        </View>
      ) : null}

      {/*
       * Provider row. On phone we stack vertically so each provider button keeps
       * its full 44px+ touch height without flex-1 squeezing them into tiny
       * half-width pills. Desktop+ keeps the canonical side-by-side row. Only
       * providers the server has secrets for are passed in, so every button here
       * initiates a real OAuth flow.
       */}
      {hasSocial ? (
        <View style={{ flexDirection: isPhone ? "column" : "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
          {socialProviders.map((provider) => (
            <Button
              key={provider}
              accessibilityLabel={`Continue with ${SOCIAL_PROVIDER_LABELS[provider]}`}
              disabled={disabled}
              onPress={() => onProviderSignIn?.(provider)}
              style={isPhone ? undefined : { flexBasis: "45%", flexGrow: 1 }}
            >
              {SOCIAL_PROVIDER_LABELS[provider]}
            </Button>
          ))}
        </View>
      ) : null}
    </Surface>
  );
}
