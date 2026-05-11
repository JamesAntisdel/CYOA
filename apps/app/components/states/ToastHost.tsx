import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "../../theme";
import { useToast } from "../../hooks/useToast";
import { Toast } from "./Toast";

/**
 * Renders the single active toast (if any) above the route stack. Mounted once
 * at the root of the app, inside the ToastProvider. The presentation layer is
 * absolutely positioned so it never affects route layout.
 */
export function ToastHost() {
  const { tokens } = useAppTheme();
  const { current, dismiss } = useToast();

  if (!current) {
    return null;
  }

  return (
    <View
      pointerEvents="box-none"
      style={{
        bottom: 0,
        left: 0,
        position: "absolute",
        right: 0,
        zIndex: 1000,
      }}
    >
      <SafeAreaView edges={["bottom"]} pointerEvents="box-none">
        <View
          pointerEvents="box-none"
          style={{
            alignItems: "center",
            padding: tokens.spacing.lg,
            width: "100%",
          }}
        >
          <Toast onDismiss={dismiss} toast={current} />
        </View>
      </SafeAreaView>
    </View>
  );
}
