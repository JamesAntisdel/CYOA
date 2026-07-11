import { View } from "react-native";

import {
  buildDistributionModel,
  distributionShareLine,
  type DistributionBar,
  type RemoteDailyResults,
} from "../../lib/dailyApi";
import { useAppTheme } from "../../theme";
import { Bar, Note, Stamp, Surface, Text } from "../primitives";

type DailyResultsProps = {
  /** The results payload, or null while loading / on transport failure. */
  results: RemoteDailyResults | null;
  /** The daily's title, shown as the header. */
  title?: string;
  /** True while the first fetch is in flight. */
  loading?: boolean;
};

/**
 * DailyResults (design §4.3, R13.3) — the reader's ending against the global
 * distribution: sorted bars, the reader's own ending highlighted, a
 * first-finder badge, and a rarest-path callout ("only 7% found this"). All
 * shares are server-computed (BC10 — the client never derives the math).
 */
export function DailyResults({ results, title, loading = false }: DailyResultsProps) {
  const { tokens } = useAppTheme();
  const model = buildDistributionModel(results);

  return (
    <Surface accessibilityLabel="Daily results" padded style={{ gap: tokens.spacing.md }}>
      <View style={{ gap: tokens.spacing.xs }}>
        <Stamp>daily results</Stamp>
        {title ? (
          <Text style={{ fontFamily: tokens.typography.families.serif }} variant="title">
            {title}
          </Text>
        ) : null}
        {results?.yours ? (
          <Text muted variant="bodySmall">
            {`You reached — ${results.yours.label}`}
          </Text>
        ) : (
          <Text muted variant="bodySmall">
            Finish today's tale to see where your path landed.
          </Text>
        )}
      </View>

      {model.rarest ? (
        <Note>
          {`Rarest path — ${distributionShareLine(model.rarest)}: ${model.rarest.label}.`}
        </Note>
      ) : null}

      {loading && model.bars.length === 0 ? (
        <Text muted variant="bodySmall">
          Tallying how readers ended…
        </Text>
      ) : model.bars.length === 0 ? (
        <Text muted variant="bodySmall">
          No one has finished today's tale yet. Be the first.
        </Text>
      ) : (
        <View style={{ gap: tokens.spacing.sm }}>
          {model.bars.map((bar) => (
            <DistributionRow bar={bar} key={bar.endingId} />
          ))}
        </View>
      )}
    </Surface>
  );
}

function DistributionRow({ bar }: { bar: DistributionBar }) {
  const { tokens } = useAppTheme();
  const pct = Math.round(bar.pct);
  return (
    <View
      accessibilityLabel={`${bar.label}: ${distributionShareLine(bar)}${bar.isYours ? ", your ending" : ""}`}
      style={{ gap: 4 }}
    >
      <View style={{ alignItems: "baseline", flexDirection: "row", gap: tokens.spacing.sm }}>
        <Text
          numberOfLines={1}
          style={{ flex: 1, fontWeight: bar.isYours ? "800" : "400" }}
          tone={bar.isYours ? "accent" : "default"}
          variant="bodySmall"
        >
          {bar.isYours ? `➤ ${bar.label}` : bar.label}
        </Text>
        <Text
          muted
          style={{ fontFamily: tokens.typography.families.mono }}
          variant="caption"
        >
          {`${pct}%`}
        </Text>
      </View>
      {/* The reader's own bar renders in the accent (candle) fill; others use
          the neutral text fill so the eye lands on "where did I end". */}
      <Bar candle={bar.isYours} pct={pct} />
      {bar.hasFirstFinder ? (
        <Text
          style={{ color: tokens.colors.accent, fontFamily: tokens.typography.families.mono }}
          variant="caption"
        >
          {`✦ First found by ${bar.firstAccountName}`}
        </Text>
      ) : null}
      {bar.isRarest && !bar.hasFirstFinder ? (
        <Text muted variant="caption">
          Rarest path
        </Text>
      ) : null}
    </View>
  );
}
