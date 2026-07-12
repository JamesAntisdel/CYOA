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
 *
 * When a companion's visible stat backs the check, the server also sends a
 * companion-support PHRASE ("Mira stands with you") — rendered as a second
 * serif-italic whisper line. Read structurally so the chip tolerates
 * projections from a server that predates the field (BC2/BC4); like the odds,
 * it is words only — the bonus number never reaches the client (BC10).
 */
export function CheckChip({ check }: { check: RemoteCheck }) {
  const { tokens } = useAppTheme();
  const rawCompanion = (check as { companion?: unknown }).companion;
  const companion =
    typeof rawCompanion === "string" && rawCompanion.length > 0 ? rawCompanion : undefined;
  const a11y = companion
    ? `${checkChipAccessibilityLabel(check)} ${companion}.`
    : checkChipAccessibilityLabel(check);
  return (
    <View
      accessibilityLabel={a11y}
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
      {companion ? (
        <Text
          style={{
            color: tokens.colors.textFaint,
            fontFamily: tokens.typography.families.serif,
            fontStyle: "italic",
          }}
          variant="caption"
        >
          {companion}
        </Text>
      ) : null}
    </View>
  );
}
