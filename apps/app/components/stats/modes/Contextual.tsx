import { useEffect, useState } from "react";
import { View } from "react-native";

import { Button, Surface, Text } from "../../primitives";
import { useAppTheme } from "../../../theme";
import { StatPip } from "../StatPip";
import { diffVisibleStats, type StatsDelta, type StatsHudCommonProps } from "../types";
import { usePreviousStats } from "../usePreviousStats";

/**
 * Mode 3 · Contextual — only appears when something changes.
 *
 * Lifted from CYOA Wireframes (Stats_Contextual):
 *   "only appears when something changes."
 *   "↳ pip fades after 3s. tap ≡ to see all."
 *   "most book-like. risk: hardcore players miss critical state."
 *
 * In this mode the HUD itself stays hidden; receipts (StatPip) bubble up
 * when stats change. A fallback "open character sheet" CTA is provided
 * so hardcore players can still see all visible state on demand.
 */
export function ContextualMode({
  hiddenStatIds,
  onOpenFullSheet,
  stats,
}: StatsHudCommonProps) {
  const { tokens } = useAppTheme();
  const previous = usePreviousStats(stats);
  const [pips, setPips] = useState<Array<StatsDelta & { issuedAt: number }>>([]);

  useEffect(() => {
    const deltas = diffVisibleStats(previous, stats, hiddenStatIds);
    if (deltas.length === 0) return;
    const issuedAt = Date.now();
    setPips((current) => [
      ...current,
      ...deltas.map((delta) => ({ ...delta, issuedAt })),
    ]);
  }, [hiddenStatIds, previous, stats]);

  const dismiss = (key: string, issuedAt: number) => {
    setPips((current) =>
      current.filter((pip) => !(pip.key === key && pip.issuedAt === issuedAt)),
    );
  };

  return (
    <View
      accessibilityLabel="Contextual stats HUD"
      style={{ gap: tokens.spacing.sm }}
    >
      {pips.length > 0 ? (
        <View style={{ gap: tokens.spacing.xs }}>
          {pips.map((pip) => (
            <StatPip
              delta={pip.delta}
              holdMs={3000}
              key={`${pip.key}-${pip.issuedAt}`}
              label={pip.label}
              onDismiss={() => dismiss(pip.key, pip.issuedAt)}
              value={pip.value}
            />
          ))}
        </View>
      ) : null}
      {onOpenFullSheet ? (
        <Surface padded style={{ gap: tokens.spacing.xs }}>
          <Text muted variant="caption">
            HUD hidden — receipts appear when stats change.
          </Text>
          <Button
            accessibilityLabel="Open character sheet"
            onPress={onOpenFullSheet}
            variant="ghost"
          >
            Open character sheet
          </Button>
        </Surface>
      ) : null}
    </View>
  );
}
