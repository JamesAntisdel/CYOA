import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { MatureOptIn } from "../../components/account/MatureOptIn";
import { useMatureOptIn } from "../../hooks/useMatureOptIn";
import { useReaderSettings, type ReaderSettings } from "../../hooks/useReaderSettings";

type Option<T extends string | boolean> = {
  label: string;
  value: T;
};

export default function SettingsRoute() {
  const { resetSettings, settings, updateSettings } = useReaderSettings();
  const mature = useMatureOptIn();
  const [showMatureFlow, setShowMatureFlow] = useState(false);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.header}>
        <Text style={styles.kicker}>Reader settings</Text>
        <Text style={styles.title}>Tune the page.</Text>
      </View>

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
        label="HUD"
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
        label="Motion and audio"
        options={[
          { label: "Motion on", value: false },
          { label: "Reduce motion", value: true },
        ]}
        selected={settings.reduceMotion}
        onSelect={(reduceMotion) => updateSettings({ reduceMotion })}
      />

      <SettingGroup
        label="Ambient sound"
        options={[
          { label: "Sound on", value: false },
          { label: "Muted", value: true },
        ]}
        selected={settings.muted}
        onSelect={(muted) => updateSettings({ muted })}
      />

      <View style={styles.group}>
        <Text style={styles.groupLabel}>Mature content</Text>
        <View style={styles.matureRow}>
          <View style={styles.matureCopy}>
            <Text style={styles.matureStatus}>
              {mature.enabled ? "On — revocable below." : "Off by default."}
            </Text>
            <Text style={styles.matureHelp}>
              Adults only. We never include sexual content involving anyone under 18.
            </Text>
          </View>
          {mature.enabled ? (
            <Pressable
              accessibilityRole="button"
              onPress={mature.revokeMature}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryText}>Turn off</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowMatureFlow(true)}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryText}>Turn on...</Text>
            </Pressable>
          )}
        </View>
        {showMatureFlow ? (
          <MatureOptIn
            revocable
            onAccept={() => {
              mature.enableMature();
              setShowMatureFlow(false);
            }}
            onDecline={() => setShowMatureFlow(false)}
          />
        ) : null}
      </View>

      <Pressable accessibilityRole="button" onPress={resetSettings} style={styles.secondaryButton}>
        <Text style={styles.secondaryText}>Reset settings</Text>
      </Pressable>
    </ScrollView>
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
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.options}>
        {options.map((option) => {
          const isSelected = selected === option.value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              key={String(option.value)}
              onPress={() => onSelect(option.value)}
              style={[styles.option, isSelected && styles.optionSelected]}
            >
              <Text style={styles.optionText}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: "#efe2c8",
    flexGrow: 1,
    gap: 18,
    padding: 18,
  },
  header: {
    gap: 8,
    maxWidth: 760,
  },
  kicker: {
    color: "#7b5a35",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  title: {
    color: "#24180f",
    fontSize: 30,
    fontWeight: "800",
  },
  group: {
    backgroundColor: "#fff8ea",
    borderColor: "#d5b98f",
    borderWidth: 1,
    gap: 10,
    maxWidth: 760,
    padding: 16,
  },
  groupLabel: {
    color: "#24180f",
    fontSize: 18,
    fontWeight: "800",
  },
  options: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  option: {
    borderColor: "#7b5a35",
    borderWidth: 1,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  optionSelected: {
    backgroundColor: "#ead9b6",
  },
  optionText: {
    color: "#24180f",
    fontWeight: "800",
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#7b5a35",
    borderWidth: 1,
    justifyContent: "center",
    maxWidth: 220,
    minHeight: 46,
    paddingHorizontal: 16,
  },
  secondaryText: {
    color: "#2d1d12",
    fontSize: 15,
    fontWeight: "800",
  },
  matureRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
  },
  matureCopy: {
    flex: 1,
    gap: 4,
    minWidth: 200,
  },
  matureStatus: {
    color: "#24180f",
    fontSize: 15,
    fontWeight: "800",
  },
  matureHelp: {
    color: "#594635",
    fontSize: 13,
    lineHeight: 19,
  },
});
