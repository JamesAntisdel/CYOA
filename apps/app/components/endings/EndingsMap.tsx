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
  /**
   * Story-engagement Wave 3 (R14.2): a fogged CANDIDATE ghost — an unreached
   * candidate ending from a terminal arc save, rendered heavily muted with a
   * fog glyph. Ghosts are always locked and carry only a label + hint (never a
   * full spoiler — BC10). Distinct from a plain locked ("Hidden ending") node:
   * a ghost is a KNOWN candidate the reader could still reach.
   */
  ghost?: boolean;
};

type EndingsMapProps = {
  nodes: EndingNode[];
  /**
   * Story-engagement Wave 3 (R14.2): fogged candidate ghosts appended after the
   * discovered nodes. Optional so legacy / arc-less callers render nothing new.
   * Only pass these for a terminal arc save (BC9/BC10).
   */
  ghostCandidates?: Array<{ label: string; hint: string }>;
};

/**
 * Endings map — vertical list of visited nodes, themed through tokens
 * so the surface paints correctly in day, night, and sepia. Each node
 * carries a step number, a title (or "Hidden ending" when locked), and
 * a path hint. Locked nodes use a dashed muted border to read as
 * unfinished business.
 */
export function EndingsMap({ nodes, ghostCandidates }: EndingsMapProps) {
  const { tokens } = useAppTheme();
  // Merge discovered nodes with any fogged candidate ghosts (R14.2). Ghosts
  // render after the real nodes as locked, dashed, fog-glyphed rows so the
  // reader sees candidate paths still worth reaching. Deduped defensively by
  // label against already-unlocked titles.
  const unlockedTitles = new Set(nodes.filter((n) => n.unlocked).map((n) => n.title));
  const ghostNodes: EndingNode[] = (ghostCandidates ?? [])
    .filter((c) => c.label && !unlockedTitles.has(c.label))
    .map((c, i) => ({
      id: `ghost-${i}-${c.label}`,
      title: c.label,
      unlocked: false,
      ghost: true,
      ...(c.hint ? { pathHint: c.hint } : {}),
    }));
  const allNodes = [...nodes, ...ghostNodes];
  return (
    <View
      accessibilityLabel="Endings map"
      style={{ gap: tokens.spacing.sm }}
    >
      {allNodes.map((node, index) => (
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
          <Text
            style={{ fontWeight: "800" }}
            tone={node.ghost ? "faint" : "default"}
            variant="body"
          >
            {node.unlocked ? node.title : node.ghost ? `🌫 ${node.title}` : "Hidden ending"}
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
            {node.unlocked
              ? (node.pathHint ?? "Path recorded")
              : node.ghost
                ? (node.pathHint ?? "A path you didn't take")
                : "Undiscovered path"}
          </Text>
        </View>
      ))}
    </View>
  );
}
