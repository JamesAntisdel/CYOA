import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Bar, Chip, Stamp, Surface, Text } from "../../components/primitives";
import { useAppTheme } from "../../theme";

const leaders = [
  { rank: 1, name: "First candle", ending: "North Door", score: "00:18" },
  { rank: 2, name: "Ash reader", ending: "North Door", score: "00:24" },
  { rank: 3, name: "Quiet quill", ending: "Mirror Hall", score: "rare 7%" },
];

export default function SeasonsRoute() {
  const { tokens } = useAppTheme();

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView contentContainerStyle={{ marginHorizontal: "auto", maxWidth: 760, padding: tokens.spacing.xl, width: "100%" }}>
        <View style={{ gap: tokens.spacing.lg }}>
          <View style={{ gap: tokens.spacing.sm }}>
            <Stamp>season</Stamp>
            <Text variant="title">First Candle</Text>
            <Text muted>Shared endings, first finds, and rare paths.</Text>
          </View>
          <Surface padded>
            <View style={{ gap: tokens.spacing.md }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                <Chip>Active</Chip>
                <Chip>Achievements</Chip>
                <Chip>Leaderboards</Chip>
              </View>
              <Bar pct={42} />
              {leaders.map((leader) => (
                <View
                  key={`${leader.rank}-${leader.name}`}
                  style={{
                    borderTopColor: tokens.colors.borderMuted,
                    borderTopWidth: tokens.borderWidths.hairline,
                    gap: tokens.spacing.xs,
                    paddingTop: tokens.spacing.md,
                  }}
                >
                  <Text variant="subtitle">#{leader.rank} {leader.name}</Text>
                  <Text muted>{leader.ending} · {leader.score}</Text>
                </View>
              ))}
            </View>
          </Surface>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
