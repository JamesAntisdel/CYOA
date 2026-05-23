import { useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MatureOptIn } from "../../components/account/MatureOptIn";
import { NarratorContinuity, VoicePicker } from "../../components/narrator";
import { AppNav } from "../../components/navigation";
import { Button, Divider, Stamp, Surface, Text } from "../../components/primitives";
import { useAccountProfile } from "../../hooks/useAccountProfile";
import { useMatureOptIn } from "../../hooks/useMatureOptIn";
import { useNarratorVoice } from "../../hooks/useNarratorVoice";
import { useReaderSettings } from "../../hooks/useReaderSettings";
import { useAppTheme } from "../../theme";

// Settings is account-scoped, but the narrator picker is per-save. Until a
// real "active save" context is wired, pin the picker to the tutorial save
// id so a reader can preview the picker from settings.
const SETTINGS_PREVIEW_SAVE_ID = "training-room-demo";

type Option<T extends string | boolean | number> = {
  label: string;
  value: T;
};

export default function SettingsRoute() {
  const { resetSettings, settings, updateSettings } = useReaderSettings();
  const { tokens } = useAppTheme();
  const mature = useMatureOptIn();
  const account = useAccountProfile();
  const [showMatureFlow, setShowMatureFlow] = useState(false);
  const [matureError, setMatureError] = useState<string | null>(null);
  const narratorController = useNarratorVoice(SETTINGS_PREVIEW_SAVE_ID);

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
                label="Chrome"
                options={[
                  { label: "Book", value: "book" },
                  { label: "Focus", value: "focus" },
                ]}
                selected={settings.layoutMode}
                onSelect={(layoutMode) => updateSettings({ layoutMode })}
              />

              <SettingGroup
                label="Reading layout"
                options={[
                  { label: "Book", value: "book" },
                  { label: "Modern app", value: "modernApp" },
                  { label: "Graphic novel", value: "graphicNovel" },
                  { label: "Journal", value: "journal" },
                  { label: "Mobile", value: "mobile" },
                ]}
                selected={settings.layout}
                onSelect={(layout) => updateSettings({ layout })}
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

              <SettingGroup
                label="Audio"
                options={[
                  { label: "Sound on", value: false },
                  { label: "Mute", value: true },
                ]}
                selected={settings.muted}
                onSelect={(muted) => updateSettings({ muted })}
              />

              <SettingGroup
                label="Show illustrations"
                helpText="Turn off if data is limited."
                options={[
                  { label: "On", value: true },
                  { label: "Off", value: false },
                ]}
                selected={settings.imagesEnabled}
                onSelect={(imagesEnabled) => updateSettings({ imagesEnabled })}
              />

              <SettingGroup
                label="Play narration & ambient audio"
                helpText="Mutes the narrator voice and any ambient soundscape."
                options={[
                  { label: "On", value: true },
                  { label: "Off", value: false },
                ]}
                selected={settings.audioEnabled}
                onSelect={(audioEnabled) => updateSettings({ audioEnabled })}
              />

              <SettingGroup
                label="Narrator speed"
                helpText="Adjust how fast the narrator reads."
                options={[
                  { label: "0.75x", value: 0.75 },
                  { label: "1x", value: 1 },
                  { label: "1.25x", value: 1.25 },
                  { label: "1.5x", value: 1.5 },
                ]}
                selected={settings.narratorPlaybackRate}
                onSelect={(narratorPlaybackRate) => updateSettings({ narratorPlaybackRate })}
              />

              <SettingGroup
                label="Play scene cinematics"
                helpText="Skip Veo videos. Image still shows."
                options={[
                  { label: "On", value: true },
                  { label: "Off", value: false },
                ]}
                selected={settings.videoEnabled}
                onSelect={(videoEnabled) => updateSettings({ videoEnabled })}
              />

              <Divider />

              <View style={{ gap: tokens.spacing.sm }}>
                <Text style={{ fontWeight: "800" }} variant="subtitle">Mature content</Text>
                <Text muted variant="bodySmall">
                  Off by default. Requires age 18+ and an active paid plan in production. Revoking turns mature scenes off immediately.
                </Text>
                {matureError ? (
                  <Text muted style={{ color: tokens.colors.danger }} variant="bodySmall">
                    {matureError}
                  </Text>
                ) : null}
                {showMatureFlow ? (
                  <MatureOptIn
                    onDecline={() => {
                      setMatureError(null);
                      setShowMatureFlow(false);
                    }}
                    onAccept={async () => {
                      setMatureError(null);
                      // Persist locally for the picker UI, AND mutate the
                      // server-backed account flag through useAccountProfile
                      // so the 18+/paid gate is enforced authoritatively.
                      // Server enforces canEnableMature regardless.
                      try {
                        mature.enableMature();
                        if (account.profile) {
                          await account.setMatureContentEnabled(true);
                        }
                        setShowMatureFlow(false);
                      } catch (err) {
                        mature.revokeMature();
                        setMatureError(
                          err instanceof Error ? err.message : "mature_opt_in_failed",
                        );
                      }
                    }}
                  />
                ) : mature.enabled ? (
                  <Button
                    onPress={async () => {
                      setMatureError(null);
                      mature.revokeMature();
                      if (account.profile) {
                        try {
                          await account.setMatureContentEnabled(false);
                        } catch (err) {
                          setMatureError(
                            err instanceof Error ? err.message : "mature_revoke_failed",
                          );
                        }
                      }
                    }}
                    variant="default"
                  >
                    Mature content is on — revoke
                  </Button>
                ) : (
                  <Button onPress={() => setShowMatureFlow(true)} variant="default">
                    Turn mature content on
                  </Button>
                )}
              </View>

              <Divider />

              <View style={{ gap: tokens.spacing.md }}>
                <Text style={{ fontWeight: "800" }} variant="subtitle">Narrator</Text>
                <VoicePicker controller={narratorController} />
                <NarratorContinuity />
              </View>

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

function SettingGroup<T extends string | boolean | number>({
  label,
  helpText,
  options,
  selected,
  onSelect,
}: {
  label: string;
  /**
   * Optional one-line help text rendered below the row of choice buttons.
   * Used by the media-gate toggles (illustrations / audio / video) to
   * explain what each switch does without growing a separate primitive.
   */
  helpText?: string;
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
      {helpText ? (
        <Text muted variant="bodySmall">
          {helpText}
        </Text>
      ) : null}
    </View>
  );
}
