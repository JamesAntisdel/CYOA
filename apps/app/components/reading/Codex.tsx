import { View } from "react-native";

import type { RemoteCodexEntry } from "../../lib/gameApi";
import { codexNewestFirst, hasNewCodexTruth } from "../../lib/storyEngagement";
import { useAppTheme } from "../../theme";
import { Stamp, Surface, Text } from "../primitives";

/**
 * Codex (design §4.2, W2-C4) — "Truths the tome recorded". Lists the codex
 * entries (string-valued recorded flags) newest-first. When a truth was
 * recorded on the current turn, an "✒️ New truth recorded" pip stamps the
 * section header (the pure `hasNewCodexTruth` gate keeps this testable).
 *
 * Reader never sees spoilers here — the server only projects flags it deemed
 * reader-visible truths (BC10); this component just renders what it's given.
 */
export type CodexProps = {
  codex: RemoteCodexEntry[] | undefined;
  /** Current turn number — drives the "new truth" pip when the newest entry matches. */
  currentTurn?: number;
};

export function Codex({ codex, currentTurn }: CodexProps) {
  const { tokens } = useAppTheme();
  const entries = codexNewestFirst(codex);
  if (entries.length === 0) return null;

  const showNewPip = hasNewCodexTruth(codex, currentTurn);
  const newestTurn = entries[0]!.turnNumber;

  return (
    <View accessibilityLabel="Codex — truths the tome recorded" style={{ gap: tokens.spacing.sm }}>
      <View
        style={{
          alignItems: "center",
          flexDirection: "row",
          gap: tokens.spacing.sm,
          justifyContent: "space-between",
        }}
      >
        <Text variant="subtitle">Truths the tome recorded</Text>
        {showNewPip ? <Stamp accessibilityLabel="New truth recorded">✒️ New truth</Stamp> : null}
      </View>
      <View style={{ gap: tokens.spacing.xs }}>
        {entries.map((entry, index) => {
          const isNewestTurn = currentTurn != null && entry.turnNumber === newestTurn && showNewPip;
          return (
            <Surface
              key={`${entry.flag}-${entry.turnNumber}-${index}`}
              padded
              variant="muted"
              style={{ gap: 2 }}
            >
              <Text
                style={{
                  fontFamily: tokens.typography.families.serif,
                  fontStyle: "italic",
                }}
                variant="bodySmall"
              >
                {entry.text}
              </Text>
              <Text muted variant="caption">
                {isNewestTurn ? `recorded just now · turn ${entry.turnNumber}` : `recorded turn ${entry.turnNumber}`}
              </Text>
            </Surface>
          );
        })}
      </View>
    </View>
  );
}
