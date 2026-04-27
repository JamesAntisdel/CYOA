import { ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Chip, Divider, Stamp, Surface, Text } from "../../components/primitives";
import { useAppTheme } from "../../theme";

export default function CreatorRoute() {
  const { tokens } = useAppTheme();

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView contentContainerStyle={{ marginHorizontal: "auto", maxWidth: 760, padding: tokens.spacing.xl, width: "100%" }}>
        <View style={{ gap: tokens.spacing.lg }}>
          <View style={{ gap: tokens.spacing.sm }}>
            <Stamp>creator</Stamp>
            <Text variant="title">Seed an adventure</Text>
            <Text muted>Author an opening, tone, and launchable rule seed.</Text>
          </View>
          <Surface padded>
            <View style={{ gap: tokens.spacing.md }}>
              <TextInput
                accessibilityLabel="Seed title"
                placeholder="Adventure title"
                placeholderTextColor={tokens.colors.textFaint}
                style={{
                  borderColor: tokens.colors.borderMuted,
                  borderRadius: tokens.radii.sm,
                  borderWidth: tokens.borderWidths.regular,
                  color: tokens.colors.text,
                  minHeight: 44,
                  paddingHorizontal: tokens.spacing.md,
                }}
              />
              <TextInput
                accessibilityLabel="Opening seed"
                multiline
                placeholder="Opening seed"
                placeholderTextColor={tokens.colors.textFaint}
                style={{
                  borderColor: tokens.colors.borderMuted,
                  borderRadius: tokens.radii.sm,
                  borderWidth: tokens.borderWidths.regular,
                  color: tokens.colors.text,
                  minHeight: 140,
                  padding: tokens.spacing.md,
                  textAlignVertical: "top",
                }}
              />
              <Divider />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                <Chip>Validation required</Chip>
                <Chip>Safety gated</Chip>
                <Chip>Play-time attribution</Chip>
              </View>
              <Button variant="primary">Publish seed</Button>
            </View>
          </Surface>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
