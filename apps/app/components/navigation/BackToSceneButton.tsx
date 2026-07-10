import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";

import { useAppTheme } from "../../theme";
import { Text } from "../primitives";

type BackToSceneButtonProps = {
  /**
   * The fallback href to push when `router.canGoBack()` returns
   * false — typically `/read/${saveId}` for save-scoped routes,
   * or `/account` for paywall, or `/` for top-level routes.
   */
  fallbackHref: string;
  /**
   * Override the default "← Back to current scene" label when the
   * surface isn't save-scoped (e.g. /paywall back to /account
   * should read "← Back to account"). Default keeps the
   * save-scoped wording the user already knows.
   */
  label?: string;
  /**
   * Accessibility label spoken by screen readers. Defaults to the
   * visible label minus the leading arrow glyph so the assistive
   * text matches the visible text exactly.
   */
  accessibilityLabel?: string;
};

/**
 * Shared back-affordance for save-scoped and adjacent surfaces.
 * Single source of truth for the pill treatment so /map, /history,
 * /paywall, and /account can't drift apart in padding, color,
 * border width, or wording.
 *
 * Always falls through `router.canGoBack() ? back() : push(fallback)`
 * so deep-link entry (the surface was the first page loaded) still
 * has a defined destination.
 */
export function BackToSceneButton({
  fallbackHref,
  label = "← Back to current scene",
  accessibilityLabel = "Back to current scene",
}: BackToSceneButtonProps) {
  const router = useRouter();
  const { tokens } = useAppTheme();

  return (
    <View style={{ alignSelf: "flex-start" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.push(fallbackHref);
          }
        }}
        style={({ pressed }) => ({
          backgroundColor: tokens.colors.surface,
          borderColor: tokens.colors.border,
          borderRadius: tokens.radii.pill,
          borderWidth: tokens.borderWidths.hairline,
          opacity: pressed ? 0.7 : 1,
          paddingHorizontal: tokens.spacing.md,
          paddingVertical: tokens.spacing.xs,
        })}
      >
        <Text
          style={{
            color: tokens.colors.text,
            fontWeight: "800",
          }}
          variant="bodySmall"
        >
          {label}
        </Text>
      </Pressable>
    </View>
  );
}
