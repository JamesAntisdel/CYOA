import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";

import { MagicLinkSent } from "../../components/auth/MagicLinkSent";
import { SignInForm } from "../../components/auth/SignInForm";
import { Text } from "../../components/primitives";
import {
  getConfiguredSocialProviders,
  isMagicLinkAvailable,
  requestMagicLink,
  startSocialSignIn,
  type SocialProvider,
} from "../../lib/authApi";
import { appBaseUrl, isConvexAuthConfigured } from "../../lib/authConfig";
import { useBreakpoint } from "../../lib/responsive";
import { useAppTheme } from "../../theme";

type LoginFlowState =
  | { phase: "idle"; email: string }
  | { phase: "sent"; email: string };

export default function LoginRoute() {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const { isPhone } = useBreakpoint();
  const [flow, setFlow] = useState<LoginFlowState>({ phase: "idle", email: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendDisabled, setResendDisabled] = useState(false);

  // When BetterAuth is wired, availability comes from the server (mirrored via
  // EXPO_PUBLIC_* env). In the local dev fallback, the email path stays a visual
  // stub and no social providers are offered (they have no local implementation).
  const betterAuthMode = isConvexAuthConfigured();
  const socialProviders = useMemo<SocialProvider[]>(
    () => (betterAuthMode ? getConfiguredSocialProviders() : []),
    [betterAuthMode],
  );
  const magicLinkEnabled = betterAuthMode ? isMagicLinkAvailable() : true;

  const callbackURL = `${appBaseUrl.replace(/\/+$/, "")}/profile`;

  const handleSendMagicLink = async (email: string) => {
    setError(null);
    if (betterAuthMode) {
      setBusy(true);
      const result = await requestMagicLink(email, { callbackURL });
      setBusy(false);
      if (result.error) {
        setError(result.error);
        return;
      }
    }
    setFlow({ phase: "sent", email });
  };

  const handleChangeEmail = () => {
    setError(null);
    setResendDisabled(false);
    setFlow({ phase: "idle", email: flow.email });
  };

  const handleResend = async () => {
    setResendDisabled(true);
    if (betterAuthMode && flow.phase === "sent") {
      await requestMagicLink(flow.email, { callbackURL });
    }
    setTimeout(() => setResendDisabled(false), 4000);
  };

  const handleProvider = async (provider: SocialProvider) => {
    setError(null);
    if (!betterAuthMode) {
      // Local dev fallback has no real OAuth; go straight to the profile stub.
      router.replace("/profile");
      return;
    }
    setBusy(true);
    const result = await startSocialSignIn(provider, {
      callbackURL,
      errorCallbackURL: `${appBaseUrl.replace(/\/+$/, "")}/login`,
    });
    setBusy(false);
    if (result.error) {
      setError(result.error);
    }
    // On success startSocialSignIn navigates the browser to the provider; no
    // further routing is needed here.
  };

  return (
    <ScrollView
      contentContainerStyle={{
        alignItems: "center",
        backgroundColor: tokens.colors.background,
        flexGrow: 1,
        gap: tokens.spacing.lg,
        justifyContent: "center",
        // Tighter horizontal padding on phone so SignInForm's 480px max-width
        // Surface can claim the full row width (it falls back to width: "100%"
        // under its own cap). lg → md drops 16 → 12, giving 351px of usable
        // content room at 375px viewport instead of 343.
        padding: isPhone ? tokens.spacing.md : tokens.spacing.lg,
      }}
    >
      <View style={{ alignItems: "center", gap: tokens.spacing.xs, maxWidth: 480, width: "100%" }}>
        <Text variant="caption" muted>
          The Unwritten
        </Text>
      </View>

      {flow.phase === "idle" ? (
        <SignInForm
          defaultEmail={flow.email}
          disabled={busy}
          error={error}
          magicLinkEnabled={magicLinkEnabled}
          socialProviders={socialProviders}
          onSendMagicLink={handleSendMagicLink}
          onProviderSignIn={handleProvider}
        />
      ) : (
        <MagicLinkSent
          email={flow.email}
          onChangeEmail={handleChangeEmail}
          onResend={handleResend}
          resendDisabled={resendDisabled}
        />
      )}
    </ScrollView>
  );
}
