import { useEffect, useRef } from "react";
import { View } from "react-native";

import type { RemoteRecentDiff } from "../../lib/gameApi";
import { threadFiredInDiffs } from "../../lib/storyEngagement";
import { useToast } from "../../hooks/useToast";
import { useAppTheme } from "../../theme";
import { Text } from "../primitives";

type ThreadsPillProps = {
  /** Count of scheduled-but-unfired Chekhov threads (design §7 `threadsPending`). */
  threadsPending: number;
  /** The current turn's signed diffs — used to fire the one-shot echo toast. */
  recentDiffs?: RemoteRecentDiff[] | undefined;
  /**
   * Scene identity — the fired-thread toast fires at most once per scene. When
   * the reader advances and a NEW scene's diffs carry a fired thread, the toast
   * fires again; re-renders of the same scene do not re-fire it.
   */
  sceneId: string;
};

/**
 * ThreadsPill (design §4.1, R3.4) — a quiet pill near the HUD showing how many
 * early choices are still waiting to come back ("🧵 N threads yet to pull").
 * Hidden entirely at zero so it never nags. When a thread FIRES this turn (a
 * `thread_fired` diff), it raises a one-shot "An earlier choice echoes" toast —
 * the reader-facing signal that the story remembered (R3.3).
 */
export function ThreadsPill({ threadsPending, recentDiffs, sceneId }: ThreadsPillProps) {
  const { tokens } = useAppTheme();
  const toast = useToast();
  // Track the last scene we announced a fired thread for, so the toast is a
  // true one-shot per scene rather than firing on every re-render.
  const announcedSceneRef = useRef<string | null>(null);

  useEffect(() => {
    if (!threadFiredInDiffs(recentDiffs)) return;
    if (announcedSceneRef.current === sceneId) return;
    announcedSceneRef.current = sceneId;
    toast.push({ message: "An earlier choice echoes.", tone: "info" });
  }, [recentDiffs, sceneId, toast]);

  if (threadsPending <= 0) return null;

  const label = `🧵 ${threadsPending} ${threadsPending === 1 ? "thread" : "threads"} yet to pull`;

  return (
    <View
      accessibilityLabel={`${threadsPending} ${threadsPending === 1 ? "thread" : "threads"} yet to pull`}
      accessibilityRole="text"
      style={{
        alignSelf: "flex-start",
        borderColor: tokens.colors.borderMuted,
        borderRadius: tokens.radii.pill,
        borderWidth: tokens.borderWidths.hairline,
        paddingHorizontal: tokens.spacing.md,
        paddingVertical: tokens.spacing.xs,
      }}
    >
      <Text
        muted
        style={{ fontFamily: tokens.typography.families.serif, fontStyle: "italic" }}
        variant="caption"
      >
        {label}
      </Text>
    </View>
  );
}
