import { View } from "react-native";

import type { RemoteCheck } from "../../lib/gameApi";
import { checkChipAccessibilityLabel, checkChipLabel } from "../../lib/storyEngagement";
import { useAppTheme } from "../../theme";
import { Text } from "../primitives";

/**
 * CheckChip (design §4.2, W2-C1) — the small `⚄ Nerve — risky` marker that
 * rides on a choice card when picking it triggers a skill check. It shows the
 * server-computed ODDS PHRASE only; the reader never sees the stat total, the
 * roll, or the threshold (BC10 — spoiler discipline). Quiet and bookish: mono
 * caption, faint surface, no color alarm (the gamble is signalled by the die,
 * not by a red badge).
 */
export function CheckChip({ check }: { check: RemoteCheck }) {
  const { tokens } = useAppTheme();
  return (
    <View
      accessibilityLabel={checkChipAccessibilityLabel(check)}
      accessibilityRole="text"
      style={{
        alignSelf: "flex-start",
        backgroundColor: tokens.colors.surfaceMuted,
        borderColor: tokens.colors.borderMuted,
        borderRadius: tokens.radii.pill,
        borderWidth: tokens.borderWidths.regular,
        paddingHorizontal: tokens.spacing.sm,
        paddingVertical: 2,
      }}
    >
      <Text
        style={{
          color: tokens.colors.textMuted,
          fontFamily: tokens.typography.families.mono,
          letterSpacing: 0.5,
        }}
        variant="caption"
      >
        {checkChipLabel(check)}
      </Text>
    </View>
  );
}
