import { View } from "react-native";

import { Text } from "../primitives";
import { useAppTheme } from "../../theme";
import type { RemoteCinematicView } from "../../lib/cinematicApi";

export type EndingNode = {
  id: string;
  title: string;
  unlocked: boolean;
  pathHint?: string;
  /** Recently unlocked (firstSeen) — renders a "★ NEW" badge. */
  isNew?: boolean;
  /**
   * Endpoint (Omni) cinematic for one of the reader's saves that reached
   * this ending (omni-cinematics Req 7.3, C5 per-save). Present only when a
   * cinematic exists; the trophy crypt offers inline playback for it.
   */
  cinematic?: RemoteCinematicView;
};

type EndingsMapProps = {
  nodes: EndingNode[];
};

/**
 * Endings map — vertical list of visited nodes, themed through tokens
 * so the surface paints correctly in day, night, and sepia. Each node
 * carries a step number, a title (or "Hidden ending" when locked), and
 * a path hint. Locked nodes use a dashed muted border to read as
 * unfinished business.
 */
export function EndingsMap({ nodes }: EndingsMapProps) {
  const { tokens } = useAppTheme();
  return (
    <View
      accessibilityLabel="Endings map"
      style={{ gap: tokens.spacing.sm }}
    >
      {nodes.map((node, index) => (
        <View
          key={node.id}
          style={{
            backgroundColor: tokens.colors.surface,
            borderColor: node.unlocked
              ? tokens.colors.border
              : tokens.colors.borderMuted,
            borderRadius: tokens.radii.sm,
            borderStyle: node.unlocked ? "solid" : "dashed",
            borderWidth: tokens.borderWidths.hairline,
            gap: tokens.spacing.xs,
            padding: tokens.spacing.md,
          }}
        >
          <Text
            muted
            style={{
              fontFamily: tokens.typography.families.mono,
              fontWeight: "800",
              letterSpacing: 1,
            }}
            variant="caption"
          >
            {String(index + 1).padStart(2, "0")}
          </Text>
          <Text style={{ fontWeight: "800" }} variant="body">
            {node.unlocked ? node.title : "Hidden ending"}
            {node.unlocked && node.isNew ? (
              <Text
                style={{ color: tokens.colors.accent, fontWeight: "800" }}
                variant="caption"
              >
                {"  ★ NEW"}
              </Text>
            ) : null}
            {/* Distinct from the "★ NEW" unlock badge: this flags that the
                reader's own endpoint cinematic for this ending has finished
                generating and is ready to watch in the crypt (Req 7.3). */}
            {node.unlocked && node.cinematic?.status === "ready" ? (
              <Text
                style={{ color: tokens.colors.accent, fontWeight: "800" }}
                variant="caption"
              >
                {"  ❖ CINEMATIC READY"}
              </Text>
            ) : null}
          </Text>
          <Text muted variant="bodySmall">
            {node.unlocked ? (node.pathHint ?? "Path recorded") : "Undiscovered path"}
          </Text>
        </View>
      ))}
    </View>
  );
}
