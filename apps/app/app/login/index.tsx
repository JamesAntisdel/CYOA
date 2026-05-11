import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { MagicLinkSent } from "../../components/auth/MagicLinkSent";
import { SignInForm, type SignInProvider } from "../../components/auth/SignInForm";
import { Text } from "../../components/primitives";
import { useAppTheme } from "../../theme";

type LoginFlowState =
  | { phase: "idle"; email: string }
  | { phase: "sent"; email: string };

export default function LoginRoute() {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const [flow, setFlow] = useState<LoginFlowState>({ phase: "idle", email: "" });
  const [error, setError] = useState<string | null>(null);
  const [resendDisabled, setResendDisabled] = useState(false);

  const handleSendMagicLink = (email: string) => {
    setError(null);
    setFlow({ phase: "sent", email });
  };

  const handleChangeEmail = () => {
    setError(null);
    setResendDisabled(false);
    setFlow({ phase: "idle", email: flow.email });
  };

  const handleResend = () => {
    setResendDisabled(true);
    setTimeout(() => setResendDisabled(false), 4000);
  };

  const handleProvider = (_provider: Exclude<SignInProvider, "email">) => {
    // Provider OAuth flow is handled by the platform integration; visual stub here.
    router.replace("/profile");
  };

  return (
    <ScrollView
      contentContainerStyle={{
        alignItems: "center",
        backgroundColor: tokens.colors.background,
        flexGrow: 1,
        gap: tokens.spacing.lg,
        justifyContent: "center",
        padding: tokens.spacing.lg,
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
          error={error}
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
