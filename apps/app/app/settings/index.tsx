import { useRouter } from "expo-router";
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
import { markLayoutAsExplicitlyChosen } from "../../components/reading/ReaderScreen";
import { useReaderSettings } from "../../hooks/useReaderSettings";
import { useBreakpoint } from "../../lib/responsive";
import { useAppTheme } from "../../theme";

// Settings is account-scoped. The narrator picker on this surface edits the
// reader's last-used voice (the seed for every NEW save). It must NOT pin to
// a per-save key, because picking from settings is meant to influence the
// next save created from /library, /creator, or the cover screen — those
// surfaces also call useNarratorVoice(null) and read the same last-used
// value at mount. Mid-tale per-save changes happen on the read screen.

type Option<T extends string | boolean | number> = {
  label: string;
  value: T;
};

// Illustrated Book couples two axes (RM7/R3.8): the cosmetic layout skin
// (`illustratedBook`, camelCase — client-only localStorage) and the
// still-guaranteeing media strategy (`illustrated_book`, snake_case — round-
// trips to the server via mediaPrefs.cinematicMode). Selecting the mode in
// EITHER picker writes both plus images-ON so the reader can never land on the
// image-first plate with a strategy that produces no still.
const ILLUSTRATED_BOOK_STRATEGY = "illustrated_book" as const;
const ILLUSTRATED_BOOK_SETTINGS = {
  layout: "illustratedBook",
  cinematicMode: ILLUSTRATED_BOOK_STRATEGY,
  imagesEnabled: true,
} as const;

// Pro-gate for Illustrated Book (R3.7). The guaranteed still is a paid
// entitlement, so a non-Pro reader sees the option locked → paywall. The dev
// unlock mirrors the server `CYOA_DEV_FORCE_PRO_MEDIA` / `devForceProMedia`
// flag through the EXPO_PUBLIC_ seam so local dev previews the full mode; the
// literal access is required for the Expo web bundler to inline the value.
function isIllustratedBookUnlocked(
  profile: {
    entitlementTier: "free" | "unlimited" | "pro";
    entitlementStatus: "active" | "grace" | "expired" | "revoked";
  } | null,
): boolean {
  if (process.env.EXPO_PUBLIC_DEV_FORCE_PRO_MEDIA === "1") return true;
  return Boolean(
    profile &&
      profile.entitlementStatus === "active" &&
      (profile.entitlementTier === "pro" || profile.entitlementTier === "unlimited"),
  );
}

export default function SettingsRoute() {
  const { resetSettings, settings, updateSettings } = useReaderSettings();
  const { tokens } = useAppTheme();
  const { isPhone } = useBreakpoint();
  const mature = useMatureOptIn();
  const account = useAccountProfile();
  const [showMatureFlow, setShowMatureFlow] = useState(false);
  const [matureError, setMatureError] = useState<string | null>(null);
  const narratorController = useNarratorVoice(null);
  const router = useRouter();

  // Illustrated Book (R3.7): a Pro reading mode whose whole promise is a
  // guaranteed still. A non-Pro reader must NEVER be able to select the
  // image-first skin into a permanently empty plate, so the option is locked
  // → paywall until the account is Pro (or the dev override previews it).
  const illustratedBookUnlocked = isIllustratedBookUnlocked(account.profile);

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          // Tighter outer padding on phone — see Account route for rationale.
          gap: isPhone ? tokens.spacing.lg : tokens.spacing.xl,
          marginHorizontal: "auto",
          maxWidth: 980,
          padding: isPhone ? tokens.spacing.lg : tokens.spacing.xl,
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

        {/*
         * Main settings column + "Reading feel" muted hint card. On phone we
         * force each Surface to claim 100% of the row so the muted info card
         * flows below the controls instead of trying to fit beside them in a
         * 300px sliver. flexBasis 100% guarantees the wrap even when flex 1
         * + minWidth would technically squeeze the layout to a single column
         * on its own; relying on intrinsic wrap can produce awkward
         * half-column reflow at exactly 375px. See `lib/responsive.ts` for
         * the breakpoint definition.
         */}
        <View style={{ alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.lg }}>
          <Surface
            padded
            style={isPhone ? { flexBasis: "100%", minWidth: "100%", width: "100%" } : { flex: 1, minWidth: 320 }}
          >
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
                onSelect={(layout) => {
                  // Mark this as an explicit user choice so ReaderScreen's
                  // phone-aware default no longer overrides the stored
                  // value. Without this flag a desktop reader who picks
                  // "Book" then loads on a phone would still see Mobile —
                  // exactly the opposite of what the picker promises.
                  markLayoutAsExplicitlyChosen();
                  updateSettings({ layout });
                }}
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
                onSelect={(imagesEnabled) => {
                  // Sync server prefs from the post-merge snapshot
                  // (`next`) — NOT from the closed-over `settings`. Two
                  // rapid toggles in the same frame would otherwise each
                  // see the pre-toggle `settings` and the second one
                  // would clobber the first sibling's change server-side.
                  updateSettings({ imagesEnabled }, (next) => {
                    void syncMediaPrefs(account, pickMediaPrefs(next));
                  });
                }}
              />

              <SettingGroup
                label="Play narration & ambient audio"
                helpText="Mutes the narrator voice and any ambient soundscape."
                options={[
                  { label: "On", value: true },
                  { label: "Off", value: false },
                ]}
                selected={settings.audioEnabled}
                onSelect={(audioEnabled) => {
                  updateSettings({ audioEnabled }, (next) => {
                    void syncMediaPrefs(account, pickMediaPrefs(next));
                  });
                }}
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
                onSelect={(videoEnabled) => {
                  updateSettings({ videoEnabled }, (next) => {
                    void syncMediaPrefs(account, pickMediaPrefs(next));
                  });
                }}
              />

              <SettingGroup
                label="Cinematic mode"
                helpText="How much generated media a run produces. Endpoint cinematics and Illustrated Book need Pro; your plan may cap the effective setting."
                options={[
                  { label: "Off", value: "off" },
                  { label: "Stills only", value: "stills_only" },
                  { label: "Endpoint cinematics", value: "endpoint_cinematic" },
                  { label: "Per-scene", value: "per_scene_legacy" },
                  {
                    // Illustrated Book carries the guaranteed-still strategy
                    // (OQ7 distinct value). The lock glyph on non-Pro accounts
                    // signals it routes to the paywall rather than selecting.
                    label: illustratedBookUnlocked ? "Illustrated Book" : "Illustrated Book 🔒",
                    value: ILLUSTRATED_BOOK_STRATEGY,
                  },
                ]}
                selected={settings.cinematicMode}
                onSelect={(cinematicMode) => {
                  if (cinematicMode === ILLUSTRATED_BOOK_STRATEGY) {
                    // R3.7: a non-Pro reader can never select into a permanent
                    // skeleton — locked → paywall (dev override previews).
                    if (!illustratedBookUnlocked) {
                      router.push("/paywall?reason=pro_media");
                      return;
                    }
                    // RM7 / R3.8 coupling: set the image-first skin, force
                    // images-ON, and the stills-guaranteeing strategy TOGETHER
                    // — `layout` is client-only localStorage while
                    // `cinematicMode` round-trips through mediaPrefs, so the two
                    // axes must move as one or the reader gets a full-bleed
                    // plate that never fills.
                    markLayoutAsExplicitlyChosen();
                    updateSettings({ ...ILLUSTRATED_BOOK_SETTINGS }, (next) => {
                      void syncMediaPrefs(account, pickMediaPrefs(next));
                    });
                    return;
                  }
                  // Leaving Illustrated Book: if the reader picks any other
                  // strategy while still on the image-first skin, drop back to
                  // the Book skin so they don't strand on a full-bleed plate the
                  // new strategy may never fill.
                  const leavingIllustrated = settings.layout === "illustratedBook";
                  if (leavingIllustrated) markLayoutAsExplicitlyChosen();
                  updateSettings(
                    leavingIllustrated ? { cinematicMode, layout: "book" } : { cinematicMode },
                    (next) => {
                      // Persist locally (authoritative client cache) and echo to
                      // the server through the mediaPrefs path from the
                      // post-merge snapshot — same discipline as imagesEnabled.
                      void syncMediaPrefs(account, pickMediaPrefs(next));
                    },
                  );
                }}
              />

              <SettingGroup
                label="Dialog blocks"
                helpText="Render quoted speech as indented blocks with the speaker's name."
                options={[
                  { label: "On", value: true },
                  { label: "Off", value: false },
                ]}
                selected={settings.dialogBlocksEnabled}
                onSelect={(dialogBlocksEnabled) => updateSettings({ dialogBlocksEnabled })}
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
                <VoicePicker
                  controller={narratorController}
                  subtitle="Picks the narrator voice for new adventures. Each save also locks its own narrator from the read screen."
                  title="Default narrator"
                />
                <NarratorContinuity />
              </View>

              <Divider />
              <Button onPress={resetSettings}>Reset settings</Button>
            </View>
          </Surface>

          <Surface
            padded
            style={isPhone ? { flexBasis: "100%", minWidth: "100%", width: "100%" } : { flex: 1, minWidth: 300 }}
            variant="muted"
          >
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

// Best-effort wrapper around useAccountProfile().setMediaPrefs. The toggle
// UI is driven by localStorage (already written before this fires) so the
// network call is purely a cross-device sync — a failure here must NEVER
// surface to the reader. Returning the promise lets the void in the
// onSelect handler stay explicit while still swallowing rejections.
// Pick the three media-gate fields off a ReaderSettings snapshot. Kept
// as a top-level helper so the toggle handlers and a future bulk-sync
// path can share it without re-spelling the field list.
function pickMediaPrefs(
  next: import("../../hooks/useReaderSettings").ReaderSettings,
): {
  imagesEnabled: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  cinematicMode: string;
} {
  return {
    imagesEnabled: next.imagesEnabled,
    audioEnabled: next.audioEnabled,
    videoEnabled: next.videoEnabled,
    cinematicMode: next.cinematicMode,
  };
}

async function syncMediaPrefs(
  account: ReturnType<typeof useAccountProfile>,
  prefs: {
    imagesEnabled: boolean;
    audioEnabled: boolean;
    videoEnabled: boolean;
    cinematicMode?: string;
  },
): Promise<void> {
  if (!account.profile) return;
  try {
    await account.setMediaPrefs(prefs);
  } catch {
    // localStorage already holds the new value; the next hydrate from a
    // device where the network worked will reconcile through the
    // useAccountProfile hydrate path.
  }
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
