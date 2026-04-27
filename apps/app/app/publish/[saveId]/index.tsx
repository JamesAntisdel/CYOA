import { useLocalSearchParams } from "expo-router";
import { ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Chip, Divider, Stamp, Surface, Text } from "../../../components/primitives";
import { useAppTheme } from "../../../theme";

export default function PublishSaveRoute() {
  const { saveId } = useLocalSearchParams<{ saveId: string }>();
  const { tokens } = useAppTheme();

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView contentContainerStyle={{ marginHorizontal: "auto", maxWidth: 720, padding: tokens.spacing.xl, width: "100%" }}>
        <View style={{ gap: tokens.spacing.lg }}>
          <View style={{ gap: tokens.spacing.sm }}>
            <Stamp>publish</Stamp>
            <Text variant="title">Share this tale</Text>
            <Text muted>Snapshot source: {saveId}</Text>
          </View>
          <Surface padded>
            <View style={{ gap: tokens.spacing.md }}>
              <Text variant="subtitle">Cover metadata</Text>
              <TextInput
                accessibilityLabel="Tale title"
                placeholder="Title"
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
                accessibilityLabel="Tale synopsis"
                multiline
                placeholder="One-line synopsis"
                placeholderTextColor={tokens.colors.textFaint}
                style={{
                  borderColor: tokens.colors.borderMuted,
                  borderRadius: tokens.radii.sm,
                  borderWidth: tokens.borderWidths.regular,
                  color: tokens.colors.text,
                  minHeight: 88,
                  padding: tokens.spacing.md,
                  textAlignVertical: "top",
                }}
              />
              <Divider />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                <Chip>Public</Chip>
                <Chip>Unlisted</Chip>
                <Chip>Friends</Chip>
                <Chip>Fork from any decision</Chip>
              </View>
              <Button variant="primary">Run gates and publish</Button>
            </View>
          </Surface>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
