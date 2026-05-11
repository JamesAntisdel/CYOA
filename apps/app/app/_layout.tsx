import { ConvexProvider } from "convex/react";
import { Slot } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "../components/states/ErrorBoundary";
import { ToastHost } from "../components/states/ToastHost";
import { ToastProvider } from "../hooks/useToast";
import { convexClient } from "../lib/convex";
import { AppThemeProvider } from "../theme";

export default function RootLayout() {
  const content = (
    <SafeAreaProvider>
      <AppThemeProvider>
        <ToastProvider>
          <ErrorBoundary>
            <Slot />
          </ErrorBoundary>
          <ToastHost />
        </ToastProvider>
      </AppThemeProvider>
    </SafeAreaProvider>
  );

  if (!convexClient) {
    return content;
  }

  return <ConvexProvider client={convexClient}>{content}</ConvexProvider>;
}
