import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppNav } from "../../components/navigation";
import { Button, Divider, Stamp, Surface, Text } from "../../components/primitives";
import { useReaderSettings } from "../../hooks/useReaderSettings";
import { useAppTheme } from "../../theme";

type Option<T extends string | boolean> = {
  label: string;
  value: T;
};

export default function SettingsRoute() {
  const { resetSettings, settings, updateSettings } = useReaderSettings();
  const { tokens } = useAppTheme();

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          gap: tokens.spacing.xl,
          marginHorizontal: "auto",
          maxWidth: 980,
          padding: tokens.spacing.xl,
          width: "100%",
        }}
      >
        <AppNav current="settings" />

        <View style={{ gap: tokens.spacing.sm, maxWidth: 680 }}>
          <Stamp>settings</Stamp>
          <Text variant="title">Reader preferences</Text>
          <Text muted>
            These controls affect the reading surface immediately and persist in this browser.
          </Text>
        </View>

        <View style={{ alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.lg }}>
          <Surface padded style={{ flex: 1, minWidth: 320 }}>
            <View style={{ gap: tokens.spacing.lg }}>
              <SettingGroup
                label="Theme"
                options={[
                  { label: "System", value: "system" },
                  { label: "Day", value: "day" },
                  { label: "Night", value: "night" },
                  { label: "Sepia", value: "sepia" },
                ]}
                selected={settings.theme}
                onSelect={(theme) => updateSettings({ theme })}
              />

              <SettingGroup
                label="Typography"
                options={[
                  { label: "Compact", value: "compact" },
                  { label: "Default", value: "default" },
                  { label: "Large", value: "large" },
                ]}
                selected={settings.fontScale}
                onSelect={(fontScale) => updateSettings({ fontScale })}
              />

              <SettingGroup
                label="Reader HUD"
                options={[
                  { label: "Full", value: "full" },
                  { label: "Quiet", value: "quiet" },
                  { label: "Hidden", value: "hidden" },
                ]}
                selected={settings.hudMode}
                onSelect={(hudMode) => updateSettings({ hudMode })}
              />

              <SettingGroup
                label="Layout"
                options={[
                  { label: "Book", value: "book" },
                  { label: "Focus", value: "focus" },
                ]}
                selected={settings.layoutMode}
                onSelect={(layoutMode) => updateSettings({ layoutMode })}
              />

              <SettingGroup
                label="Motion"
                options={[
                  { label: "Motion on", value: false },
                  { label: "Reduce motion", value: true },
                ]}
                selected={settings.reduceMotion}
                onSelect={(reduceMotion) => updateSettings({ reduceMotion })}
              />

              <Divider />
              <Button onPress={resetSettings}>Reset settings</Button>
            </View>
          </Surface>

          <Surface padded style={{ flex: 1, minWidth: 300 }} variant="muted">
            <View style={{ gap: tokens.spacing.md }}>
              <Text variant="subtitle">Reading feel</Text>
              <Text muted>
                These settings only change how the story is displayed. Story progress, choices, and account features are handled automatically.
              </Text>
            </View>
          </Surface>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingGroup<T extends string | boolean>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: Array<Option<T>>;
  selected: T;
  onSelect: (value: T) => void;
}) {
  const { tokens } = useAppTheme();

  return (
    <View style={{ gap: tokens.spacing.sm }}>
      <Text style={{ fontWeight: "800" }} variant="subtitle">{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
        {options.map((option) => {
          const isSelected = selected === option.value;
          return (
            <Button
              accessibilityState={{ selected: isSelected }}
              key={String(option.value)}
              onPress={() => onSelect(option.value)}
              variant={isSelected ? "primary" : "default"}
            >
              {option.label}
            </Button>
          );
        })}
      </View>
    </View>
  );
}
