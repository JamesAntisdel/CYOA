import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, View } from "react-native";

import { useAppTheme } from "../../theme";
import type { Toast as ToastShape, ToastTone } from "../../hooks/useToast";
import { Text } from "../primitives";

type ToastProps = {
  toast: ToastShape;
  onDismiss: (id: string) => void;
};

function toneAccent(tokens: ReturnType<typeof useAppTheme>["tokens"], tone: ToastTone): string {
  switch (tone) {
    case "success":
      return tokens.colors.accent;
    case "warning":
      return tokens.colors.accent;
    case "danger":
      return tokens.colors.danger;
    case "info":
    default:
      return tokens.colors.border;
  }
}

/**
 * Single visible toast. Reduced-motion-safe: when the user has reduce-motion
 * enabled, the toast snaps in/out instead of animating.
 */
export function Toast({ toast, onDismiss }: ToastProps) {
  const { tokens, reduceMotion } = useAppTheme();
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const translateY = useRef(new Animated.Value(reduceMotion ? 0 : 8)).current;

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }
    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [opacity, reduceMotion, toast.id, translateY]);

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      pointerEvents="box-none"
      style={{
        opacity,
        transform: [{ translateY }],
        width: "100%",
        maxWidth: 520,
      }}
    >
      <Pressable
        accessibilityHint="Dismiss notice"
        accessibilityLabel={toast.message}
        accessibilityRole="button"
        onPress={() => onDismiss(toast.id)}
        style={{
          backgroundColor: tokens.colors.surface,
          borderColor: toneAccent(tokens, toast.tone),
          borderLeftWidth: tokens.borderWidths.heavy + 1,
          borderRadius: tokens.radii.sm,
          borderWidth: tokens.borderWidths.regular,
          paddingHorizontal: tokens.spacing.lg,
          paddingVertical: tokens.spacing.md,
          shadowColor: tokens.colors.shadow,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 1,
          shadowRadius: 6,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.spacing.sm }}>
          <Text style={{ flexShrink: 1 }} variant="bodySmall">
            {toast.message}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}
