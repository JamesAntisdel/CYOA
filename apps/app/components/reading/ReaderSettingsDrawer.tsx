import { Modal, Pressable, ScrollView, View } from "react-native";

import { Text } from "../primitives";
import { useAccountProfile } from "../../hooks/useAccountProfile";
import {
  NARRATOR_PLAYBACK_RATES,
  useReaderSettings,
  type ReaderSettings,
} from "../../hooks/useReaderSettings";
import { useBreakpoint } from "../../lib/responsive";
import { markLayoutAsExplicitlyChosen } from "./ReaderScreen";
import { useAppTheme } from "../../theme";

/**
 * Mid-tale quick settings drawer.
 *
 * The full `/settings` page lives in `apps/app/app/settings/index.tsx` and
 * covers every reader pref + account-level toggles (mature content,
 * narrator voice continuity, etc). That's the deep-dive surface. This
 * drawer is the SUBSET a reader reaches for WHILE reading, so they don't
 * have to bounce out to /settings and back to flip a theme or mute the
 * narrator mid-scene.
 *
 * Subset (covers ~80% of in-tale tweaks):
 *   - Theme               (Day / Night / Sepia / System)
 *   - Text size           (Compact / Default / Large)
 *   - Reading layout      (Book / Mobile / Modern app / Journal /
 *                          Graphic novel)
 *   - Illustrations       (on / off)         — also writes server prefs
 *   - Narration & ambient (on / off)         — also writes server prefs
 *   - Narrator speed      (0.75 / 1 / 1.25 / 1.5)
 *   - Scene cinematics    (on / off)         — also writes server prefs
 *   - Reduce motion       (on / off)
 *
 * What this drawer does NOT show (use /settings):
 *   - Reader HUD mode, Chrome, Dialog blocks (rarely toggled mid-tale)
 *   - Mature content opt-in (account-level, not reading)
 *   - Narrator voice picker + continuity (per-save concern; lives on the
 *     reader chrome already via `<NarratorControl>`)
 *   - Account export / delete (not reading)
 *
 * Mobile UX: full-width Modal that anchors to the bottom of the screen on
 * phone (sheet-style) and to the right on tablet/desktop (drawer-style).
 * Closes on backdrop tap, ESC, or Android back.
 */
export type ReaderSettingsDrawerProps = {
  visible: boolean;
  onClose: () => void;
};

export function ReaderSettingsDrawer({ visible, onClose }: ReaderSettingsDrawerProps) {
  const { tokens } = useAppTheme();
  const { isPhone } = useBreakpoint();
  const { resetSettings, settings, updateSettings } = useReaderSettings();
  const account = useAccountProfile();

  // Best-effort server sync for the three media gates. Mirrors the same
  // pattern /settings uses — localStorage is the authoritative client
  // cache (already updated via `updateSettings`'s onMerged callback);
  // the server call is a cross-device sync that must NEVER block the
  // toggle UI. Failures are swallowed.
  const syncMediaPrefs = async (next: ReaderSettings) => {
    if (!account.profile) return;
    try {
      await account.setMediaPrefs({
        imagesEnabled: next.imagesEnabled,
        audioEnabled: next.audioEnabled,
        videoEnabled: next.videoEnabled,
      });
    } catch {
      // Silent — the next hydrate will reconcile.
    }
  };

  return (
    <Modal
      animationType={isPhone ? "slide" : "fade"}
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <Pressable
        accessibilityLabel="Close reader settings"
        onPress={onClose}
        style={{
          backgroundColor: "rgba(0,0,0,0.45)",
          flex: 1,
          // Phone: anchor sheet to bottom. Tablet/desktop: anchor drawer
          // to the right side so the reader stays visible on the left.
          flexDirection: isPhone ? "column" : "row",
          justifyContent: isPhone ? "flex-end" : "flex-end",
        }}
      >
        <Pressable
          accessibilityLabel="Reader settings"
          onPress={() => undefined}
          style={{
            backgroundColor: tokens.colors.background,
            borderTopLeftRadius: isPhone ? tokens.radii.md : 0,
            borderTopRightRadius: isPhone ? tokens.radii.md : 0,
            // Phone: full-width sheet, capped at 75 % viewport height so
            // the prose underneath is partially visible.
            // Desktop: right drawer, fixed 380 px wide and full height.
            ...(isPhone
              ? { alignSelf: "stretch", maxHeight: "75%" }
              : { alignSelf: "stretch", maxWidth: 380, width: 380 }),
          }}
        >
          <View
            style={{
              alignItems: "center",
              borderBottomColor: tokens.colors.borderMuted,
              borderBottomWidth: tokens.borderWidths.hairline,
              flexDirection: "row",
              gap: tokens.spacing.sm,
              justifyContent: "space-between",
              padding: tokens.spacing.lg,
            }}
          >
            <Text style={{ fontWeight: "800" }} variant="subtitle">
              Reading
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close reading settings"
              onPress={onClose}
              style={({ pressed }) => ({
                alignItems: "center",
                justifyContent: "center",
                minHeight: 44,
                minWidth: 44,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ fontSize: 22, fontWeight: "800" }}>×</Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{
              gap: tokens.spacing.lg,
              padding: tokens.spacing.lg,
            }}
          >
            <PillGroup
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

            <PillGroup
              label="Text size"
              options={[
                { label: "Compact", value: "compact" },
                { label: "Default", value: "default" },
                { label: "Large", value: "large" },
              ]}
              selected={settings.fontScale}
              onSelect={(fontScale) => updateSettings({ fontScale })}
            />

            <PillGroup
              label="Reading layout"
              options={[
                { label: "Book", value: "book" },
                { label: "Mobile", value: "mobile" },
                { label: "Modern", value: "modernApp" },
                { label: "Journal", value: "journal" },
                { label: "Comic", value: "graphicNovel" },
              ]}
              selected={settings.layout}
              onSelect={(layout) => {
                // Mirror /settings: mark as an explicit user choice so
                // the phone-aware auto-default doesn't override later.
                markLayoutAsExplicitlyChosen();
                updateSettings({ layout });
              }}
            />

            <PillGroup
              label="Illustrations"
              helpText="The scene image plate above the prose."
              options={[
                { label: "On", value: true },
                { label: "Off", value: false },
              ]}
              selected={settings.imagesEnabled}
              onSelect={(imagesEnabled) => {
                updateSettings({ imagesEnabled }, (next) => {
                  void syncMediaPrefs(next);
                });
              }}
            />

            <PillGroup
              label="Narration & ambient"
              helpText="Narrator voice + scene soundscape."
              options={[
                { label: "On", value: true },
                { label: "Off", value: false },
              ]}
              selected={settings.audioEnabled}
              onSelect={(audioEnabled) => {
                updateSettings({ audioEnabled }, (next) => {
                  void syncMediaPrefs(next);
                });
              }}
            />

            <PillGroup
              label="Narrator speed"
              options={NARRATOR_PLAYBACK_RATES.map((rate) => ({
                label: `${rate}×`,
                value: rate,
              }))}
              selected={settings.narratorPlaybackRate}
              onSelect={(narratorPlaybackRate) => updateSettings({ narratorPlaybackRate })}
            />

            <PillGroup
              label="Scene cinematics"
              helpText="Short Veo clip below the prose. Image still shows."
              options={[
                { label: "On", value: true },
                { label: "Off", value: false },
              ]}
              selected={settings.videoEnabled}
              onSelect={(videoEnabled) => {
                updateSettings({ videoEnabled }, (next) => {
                  void syncMediaPrefs(next);
                });
              }}
            />

            <PillGroup
              label="Reduce motion"
              options={[
                { label: "Motion on", value: false },
                { label: "Reduce", value: true },
              ]}
              selected={settings.reduceMotion}
              onSelect={(reduceMotion) => updateSettings({ reduceMotion })}
            />

            <View
              style={{
                borderTopColor: tokens.colors.borderMuted,
                borderTopWidth: tokens.borderWidths.hairline,
                gap: tokens.spacing.sm,
                paddingTop: tokens.spacing.md,
              }}
            >
              <Text muted variant="caption">
                More controls (mature content, narrator voice, dialog blocks)
                live in the full Settings page.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reset reading preferences"
                onPress={() => resetSettings()}
                style={({ pressed }) => ({
                  alignSelf: "flex-start",
                  opacity: pressed ? 0.65 : 1,
                  paddingVertical: tokens.spacing.xs,
                })}
              >
                <Text muted style={{ fontWeight: "800" }} variant="caption">
                  Reset reading preferences
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type Option<T extends string | boolean | number> = {
  label: string;
  value: T;
};

/**
 * Pill row group. Same visual treatment as the SettingGroup on /settings
 * so the two surfaces feel like one product. Active state changes fill +
 * text color only — no padding/border drift on selection.
 */
function PillGroup<T extends string | boolean | number>({
  label,
  helpText,
  options,
  selected,
  onSelect,
}: {
  label: string;
  helpText?: string;
  options: ReadonlyArray<Option<T>>;
  selected: T;
  onSelect: (value: T) => void;
}) {
  const { tokens } = useAppTheme();
  return (
    <View style={{ gap: tokens.spacing.sm }}>
      <Text style={{ fontWeight: "800" }} variant="bodySmall">
        {label}
      </Text>
      {helpText ? (
        <Text muted variant="caption">
          {helpText}
        </Text>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: tokens.spacing.xs,
        }}
      >
        {options.map((option) => {
          const active = option.value === selected;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${label}: ${option.label}`}
              accessibilityState={{ selected: active }}
              key={String(option.value)}
              onPress={() => onSelect(option.value)}
              style={({ pressed }) => ({
                alignItems: "center",
                backgroundColor: active ? tokens.colors.text : "transparent",
                borderColor: active ? tokens.colors.text : tokens.colors.borderMuted,
                borderRadius: tokens.radii.pill,
                borderWidth: tokens.borderWidths.hairline,
                justifyContent: "center",
                minHeight: 44,
                minWidth: 64,
                opacity: pressed ? 0.75 : 1,
                paddingHorizontal: tokens.spacing.md,
                paddingVertical: tokens.spacing.sm,
              })}
            >
              <Text
                style={{
                  color: active ? tokens.colors.background : tokens.colors.textMuted,
                  fontWeight: "800",
                }}
                variant="caption"
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
