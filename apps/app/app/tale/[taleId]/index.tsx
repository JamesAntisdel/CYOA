import { useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Chip, Divider, Stamp, Surface, Text } from "../../../components/primitives";
import { useAppTheme } from "../../../theme";

const sampleTurns = [
  { turn: 1, choice: "Open the iron door", prose: "The hinge gives with a careful sigh." },
  { turn: 2, choice: "Follow the candle smoke", prose: "Warm waxlight threads down the stair." },
];

export default function TaleReadAlongRoute() {
  const { taleId } = useLocalSearchParams<{ taleId: string }>();
  const { tokens } = useAppTheme();

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView contentContainerStyle={{ marginHorizontal: "auto", maxWidth: 760, padding: tokens.spacing.xl, width: "100%" }}>
        <View style={{ gap: tokens.spacing.lg }}>
          <View style={{ gap: tokens.spacing.sm }}>
            <Stamp>read along</Stamp>
            <Text variant="title">Published tale</Text>
            <Text muted>{taleId}</Text>
          </View>
          <Surface padded>
            <View style={{ gap: tokens.spacing.md }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                <Chip>Read-only</Chip>
                <Chip>Immutable snapshot</Chip>
              </View>
              <Divider />
              {sampleTurns.map((item) => (
                <View key={item.turn} style={{ gap: tokens.spacing.xs }}>
                  <Text variant="caption" muted>Turn {item.turn}</Text>
                  <Text>{item.prose}</Text>
                  <Button variant="ghost">Fork from: {item.choice}</Button>
                </View>
              ))}
            </View>
          </Surface>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
