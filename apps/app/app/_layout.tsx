import { ConvexProvider } from "convex/react";
import { Slot } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { BetterAuthConvexProvider } from "../components/auth/BetterAuthConvexProvider";
import { isConvexAuthConfigured } from "../lib/authConfig";
import { convexClient } from "../lib/convex";
import { AppThemeProvider } from "../theme";

export default function RootLayout() {
  const content = (
    <SafeAreaProvider>
      <AppThemeProvider>
        <Slot />
      </AppThemeProvider>
    </SafeAreaProvider>
  );

  if (!convexClient) {
    return content;
  }

  if (isConvexAuthConfigured()) {
    return <BetterAuthConvexProvider client={convexClient}>{content}</BetterAuthConvexProvider>;
  }

  return <ConvexProvider client={convexClient}>{content}</ConvexProvider>;
}
