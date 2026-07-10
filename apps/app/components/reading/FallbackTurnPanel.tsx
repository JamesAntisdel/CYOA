import { useState } from "react";
import { View } from "react-native";

import { Button, Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";

/**
 * FallbackTurnPanel — the reader surface for the deterministic-fallback
 * sentinel (`projection.scene.isFallback === true`).
 *
 * Why this exists:
 *   The deterministic provider is the LLM router's last-resort safety net:
 *   when every real provider fails (or none was eligible), it emits a
 *   shape-valid scene with placeholder prose ("the candle holds...") and
 *   placeholder choices ("Press on into the story", "Hold still and
 *   listen"). For unit tests + the streaming pipeline that's fine — we
 *   need SOMETHING to write down — but the reader should never see that
 *   output rendered as if it were a real scene. They'd pick "Press on"
 *   and confirm to themselves that the story really is nonsense.
 *
 * What it renders:
 *   A muted surface with a brief in-story line ("The page is blank for a
 *   moment.") + a recovery sentence + a "Try again" button. The button
 *   calls `onRetry()`; layouts wire that to `useTurn.retryCurrentTurn`,
 *   which re-opens the SSE stream for the same scene. If a real provider
 *   responds this time, `completeSceneStream` overwrites
 *   `scene.isFallback` with `false`, the projection drops the sentinel,
 *   and this panel unmounts in favor of the real scene.
 *
 * Why it owns its own pending state:
 *   The retry is fire-and-forget from the layout's perspective — the
 *   layout re-renders only when the projection swaps. Without local
 *   pending feedback the reader's tap looks unresponsive for the 1-3
 *   seconds before the new tokens land. We toggle a local `pending` flag
 *   on tap (disabling the button + softening the label) and leave it
 *   true; the unmount when isFallback flips covers the reset.
 */
export type FallbackTurnPanelProps = {
  /**
   * Called when the reader taps "Try again". Layouts wire this to
   * `useTurn.retryCurrentTurn`. Must be a stable reference across renders
   * — the panel uses local pending state so a re-render mid-tap doesn't
   * lose the in-flight signal.
   */
  onRetry: () => void | Promise<void>;
  /**
   * Reduce-motion preference; passed in by the layout so the panel can
   * decline the "thinking..." animation. Currently unused (no animation
   * mounted) but kept for forward-compat — the parent already passes it
   * to every other reading surface.
   */
  reducedMotion?: boolean;
};

export function FallbackTurnPanel({ onRetry }: FallbackTurnPanelProps) {
  const { tokens } = useAppTheme();
  const [pending, setPending] = useState(false);

  const handlePress = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onRetry();
    } catch {
      // The retry path inside useTurn already handles its own errors and
      // surfaces the buffered-prose / "candle guttered out" fallback. We
      // re-enable the button locally so the reader can try once more.
      setPending(false);
    }
  };

  return (
    <Surface
      accessibilityLabel="This turn could not be generated. Tap to try again."
      padded
      style={{ gap: tokens.spacing.md }}
      variant="muted"
    >
      <Text variant="subtitle">The page is blank for a moment.</Text>
      <Text muted>
        We couldn&apos;t reach the storyteller. Tap below to try this turn again.
      </Text>
      <View>
        <Button
          accessibilityLabel="Try this turn again"
          disabled={pending}
          onPress={handlePress}
          variant="primary"
        >
          <Text style={{ color: tokens.colors.background }} variant="body">
            {pending ? "Trying again..." : "Try again"}
          </Text>
        </Button>
      </View>
    </Surface>
  );
}
