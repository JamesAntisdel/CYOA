import { View } from "react-native";

import {
  buildOpeningForkTiles,
  pulseChipLabel,
  type OpeningForkTile,
  type RemotePulseEntry,
} from "../../lib/dailyApi";
import { useAppTheme } from "../../theme";
import { Stamp, Text } from "../primitives";

type OpeningForksProps = {
  /**
   * The reader's OWN early-turn choice labels (client-known from their history).
   * Only turns that also have a qualifying pulse bucket become tiles.
   */
  choiceHistory: readonly { turnNumber: number; choiceLabel: string }[];
  /** The server pulse buckets (already ≤ KILLCAM_TURN_CAP, threshold-filtered). */
  pulses: readonly RemotePulseEntry[];
};

/**
 * OpeningForks (daily-killcam design §4 / R3.2) — the Wordle-square recap of the
 * day's opening moves, shown ABOVE the ending distribution on the Daily results
 * screen. Up to 3 tiles, each joining the reader's OWN choice label (never
 * another reader's — BC10) with its server pulse bucket. The strip HIDES with
 * zero layout shift when no turn met the threshold (empty join).
 */
export function OpeningForks({ choiceHistory, pulses }: OpeningForksProps) {
  const { tokens } = useAppTheme();
  const tiles = buildOpeningForkTiles(choiceHistory, pulses);
  if (tiles.length === 0) return null;

  return (
    <View accessibilityLabel="Opening forks" style={{ gap: tokens.spacing.sm }}>
      <Stamp>opening forks</Stamp>
      <View style={{ gap: tokens.spacing.sm }}>
        {tiles.map((tile) => (
          <OpeningForkRow key={tile.turnNumber} tile={tile} />
        ))}
      </View>
    </View>
  );
}

function OpeningForkRow({ tile }: { tile: OpeningForkTile }) {
  const { tokens } = useAppTheme();
  const share = pulseChipLabel(tile.entry);
  return (
    <View
      accessibilityLabel={`Turn ${tile.turnNumber}: ${tile.label}. ${share}`}
      style={{
        borderColor: tokens.colors.borderMuted,
        borderRadius: tokens.radii.md,
        borderWidth: tokens.borderWidths.hairline,
        gap: 4,
        padding: tokens.spacing.sm,
      }}
    >
      <Text
        muted
        style={{ fontFamily: tokens.typography.families.mono }}
        variant="caption"
      >
        {`Fork ${tile.turnNumber}`}
      </Text>
      <Text
        numberOfLines={1}
        style={{ fontFamily: tokens.typography.families.serif }}
        variant="bodySmall"
      >
        {tile.label}
      </Text>
      <Text muted variant="caption">
        {share}
      </Text>
    </View>
  );
}
