import { Component, type ErrorInfo, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "../../theme";
import { Button, Stamp, Surface, Text } from "../primitives";

type ErrorBoundaryProps = {
  children: ReactNode;
  /** Optional fallback override; receives a reset callback. */
  fallback?: (reset: () => void) => ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

/**
 * Catches render-time errors anywhere in the route tree and shows a quiet
 * book-voice fallback. Intentionally never displays the error message, stack
 * trace, or any internal id — that information is sent to console only, where
 * developer tooling can pick it up.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(_error: unknown): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Log to console for operator visibility. Never surface raw text to users.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] captured", error, info?.componentStack);
  }

  private reset = (): void => {
    this.setState({ hasError: false });
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.reset);
      }
      return <ErrorFallback onReset={this.reset} />;
    }
    return this.props.children;
  }
}

function ErrorFallback({ onReset }: { onReset: () => void }) {
  const { tokens } = useAppTheme();

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          alignItems: "center",
          flexGrow: 1,
          justifyContent: "center",
          padding: tokens.spacing.xl,
        }}
      >
        <Surface
          padded
          style={{
            alignItems: "center",
            gap: tokens.spacing.lg,
            maxWidth: 520,
            width: "100%",
          }}
        >
          <Stamp>the margin tore</Stamp>
          <View style={{ gap: tokens.spacing.sm }}>
            <Text style={{ textAlign: "center" }} variant="title">
              A page of the book came loose.
            </Text>
            <Text muted style={{ textAlign: "center" }} variant="body">
              The story is safe. Smooth the page and try the chapter again.
            </Text>
          </View>
          <Button onPress={onReset} variant="primary">
            Return to the book
          </Button>
        </Surface>
      </ScrollView>
    </SafeAreaView>
  );
}
