import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppNav } from "../../components/navigation";
import { Button, Chip, Divider, Stamp, Surface, Text } from "../../components/primitives";
import {
  buildQuitBars,
  formatPlayTime,
  getRemoteCreatorSeedStats,
  peakQuitTurn,
  type CreatorSeedStats,
} from "../../lib/creatorDashboardApi";
import { useBreakpoint } from "../../lib/responsive";
import { guestAuthArgs, useGuestSession } from "../../hooks/useGuestSession";
import { useAppTheme } from "../../theme";

/**
 * Creator analytics dashboard (core-read-loop Req 22.4/22.5). One card per
 * published seed: plays / terminals / attributed play time, the ending
 * distribution, and the quit-point histogram — the panel-review headline
 * ("readers drift away around turn N"). Owner-scoped: the query only ever
 * returns the signed-in creator's own seeds.
 */

/** `undefined` = loading, `null` = backend unreachable, `[]` = no seeds. */
type StatsState = CreatorSeedStats[] | null | undefined;

export default function CreatorDashboardRoute() {
  const router = useRouter();
  const guest = useGuestSession();
  const { tokens } = useAppTheme();
  const { isPhone } = useBreakpoint();
  const [stats, setStats] = useState<StatsState>(undefined);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!guest.session) return;
      const rows = await getRemoteCreatorSeedStats({
        accountId: guest.session.accountId,
        ...guestAuthArgs(),
      });
      if (!cancelled) setStats(rows);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [guest.session, nonce]);

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          marginHorizontal: "auto",
          maxWidth: 940,
          padding: isPhone ? tokens.spacing.md : tokens.spacing.xl,
          width: "100%",
        }}
      >
        <View style={{ gap: tokens.spacing.lg }}>
          <AppNav current="creator" />
          <View style={{ gap: tokens.spacing.sm, maxWidth: 680 }}>
            <Stamp>creator dashboard</Stamp>
            <Text variant="title">How your seeds are read</Text>
            <Text muted>
              Plays, endings, attributed play time, and where readers drift away — for every seed
              you have published.
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
              <Button onPress={() => router.push("/creator")} variant="ghost">
                Back to the seed builder
              </Button>
            </View>
          </View>

          {!guest.session ? (
            <Surface padded style={{ maxWidth: 680, width: "100%" }}>
              <View style={{ gap: tokens.spacing.sm }}>
                <Text variant="subtitle">Start a session first</Text>
                <Text muted>Your dashboard appears once you are reading (and publishing).</Text>
                <Button onPress={() => router.push("/")} variant="primary">
                  Start reading
                </Button>
              </View>
            </Surface>
          ) : stats === undefined ? (
            <Surface padded style={{ maxWidth: 680, width: "100%" }}>
              <Text accessibilityLabel="Dashboard loading" muted>
                Gathering your readers' footprints…
              </Text>
            </Surface>
          ) : stats === null ? (
            <Surface padded style={{ maxWidth: 680, width: "100%" }}>
              <View style={{ gap: tokens.spacing.sm }}>
                <Text muted>The dashboard could not be reached.</Text>
                <Button onPress={() => setNonce((n) => n + 1)}>Try again</Button>
              </View>
            </Surface>
          ) : stats.length === 0 ? (
            <Surface padded style={{ maxWidth: 680, width: "100%" }}>
              <View style={{ gap: tokens.spacing.sm }}>
                <Text variant="subtitle">No published seeds yet</Text>
                <Text muted>
                  Publish a seed from the builder and this page will chart every read it gets.
                </Text>
                <View style={{ flexDirection: "row" }}>
                  <Button onPress={() => router.push("/creator")} variant="primary">
                    Publish your first seed
                  </Button>
                </View>
              </View>
            </Surface>
          ) : (
            stats.map((seed) => <SeedStatsCard key={seed.seedId} seed={seed} />)
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SeedStatsCard({ seed }: { seed: CreatorSeedStats }) {
  const { tokens } = useAppTheme();
  const terminals = seed.completions + seed.deaths + seed.safeExits;
  return (
    <Surface padded style={{ maxWidth: 680, width: "100%" }}>
      <View style={{ gap: tokens.spacing.md }}>
        <View
          style={{ alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}
        >
          <View style={{ flex: 1, minWidth: 160 }}>
            <Text variant="subtitle">{seed.title}</Text>
          </View>
          <Chip variant="accent">{`${seed.plays} ${seed.plays === 1 ? "play" : "plays"}`}</Chip>
          {seed.forks > 0 ? <Chip variant="muted">{`${seed.forks} forks`}</Chip> : null}
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.lg }}>
          <StatCell label="Finished" value={String(seed.completions)} />
          <StatCell label="Died" value={String(seed.deaths)} />
          <StatCell label="Safe exits" value={String(seed.safeExits)} />
          <StatCell label="Still reading" value={String(seed.inProgress)} />
          <StatCell label="Reader time" value={formatPlayTime(seed.externalPlaySeconds)} />
        </View>
        {seed.selfPlays > 0 ? (
          <Text muted variant="caption">
            {`${seed.selfPlays} of ${seed.plays} plays are your own test runs (excluded from reader time).`}
          </Text>
        ) : null}

        {seed.endings.length > 0 ? (
          <View style={{ gap: tokens.spacing.xs }}>
            <Text variant="bodySmall">Endings reached</Text>
            {seed.endings.map((ending) => (
              <View
                key={ending.endingId}
                style={{ flexDirection: "row", gap: tokens.spacing.sm, justifyContent: "space-between" }}
              >
                <Text muted variant="bodySmall">
                  {ending.label ?? ending.endingId}
                </Text>
                <Text variant="bodySmall">{String(ending.count)}</Text>
              </View>
            ))}
          </View>
        ) : terminals === 0 ? (
          <Text muted variant="caption">
            No finished runs yet.
          </Text>
        ) : null}

        <Divider />
        <QuitSparkline quitPoints={seed.quitPoints} />
      </View>
    </Surface>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  const { tokens } = useAppTheme();
  return (
    <View style={{ gap: tokens.spacing.xs, minWidth: 72 }}>
      <Text variant="subtitle">{value}</Text>
      <Text muted variant="caption">
        {label}
      </Text>
    </View>
  );
}

/**
 * Quit-point histogram as a bar sparkline. Single series, so identity rides
 * the card title (no legend); bars use the theme accent so the mark reads in
 * both day and night palettes, values stay in text tokens, and the whole
 * figure carries an accessibility summary (the "table view" for readers who
 * can't see the bars).
 */
function QuitSparkline({ quitPoints }: { quitPoints: CreatorSeedStats["quitPoints"] }) {
  const { tokens } = useAppTheme();
  const bars = buildQuitBars(quitPoints);
  const peak = peakQuitTurn(quitPoints);
  if (bars.length === 0 || peak === null) {
    return (
      <Text accessibilityLabel="Quit points: none yet" muted variant="caption">
        No stalled runs yet — nobody has drifted away mid-story.
      </Text>
    );
  }
  const lastBar = bars[bars.length - 1];
  const summary = quitPoints
    .map((point) => `${point.count} at turn ${point.turnNumber}`)
    .join(", ");
  return (
    <View accessibilityLabel={`Quit points: ${summary}`} style={{ gap: tokens.spacing.xs }}>
      <Text variant="bodySmall">{`Readers drift away around turn ${peak}`}</Text>
      <View
        style={{
          alignItems: "flex-end",
          borderBottomColor: tokens.colors.borderMuted,
          borderBottomWidth: tokens.borderWidths.hairline,
          flexDirection: "row",
          gap: 2,
          height: 56,
          paddingBottom: 0,
        }}
      >
        {bars.map((bar) => (
          <View
            key={bar.turnNumber}
            style={{
              backgroundColor: bar.count > 0 ? tokens.colors.accent : tokens.colors.accentMuted,
              borderTopLeftRadius: 2,
              borderTopRightRadius: 2,
              flexGrow: 1,
              flexShrink: 1,
              height: bar.count > 0 ? Math.max(6, Math.round(bar.ratio * 52)) : 2,
              maxWidth: 18,
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text tone="faint" variant="caption">
          turn 0
        </Text>
        <Text tone="faint" variant="caption">
          {lastBar?.overflow ? `turn ${lastBar.turnNumber}+` : `turn ${lastBar?.turnNumber ?? 0}`}
        </Text>
      </View>
    </View>
  );
}
