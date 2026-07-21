import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
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
import {
  useReaderSettings,
  type CinematicMode,
  type ReaderLayoutVariant,
  type ReaderSettings,
} from "../../hooks/useReaderSettings";
import {
  readerSettingsGroups,
  isIllustratedBookUnlocked,
  selectIllustratedBook,
  ILLUSTRATED_BOOK_STRATEGY,
  ILLUSTRATED_BOOK_LAYOUT,
  type SettingsOption,
} from "../../lib/readerSettingsGroups";
import { useBreakpoint } from "../../lib/responsive";
import { useAppTheme } from "../../theme";

// Settings is account-scoped. The narrator picker on this surface edits the
// reader's last-used voice (the seed for every NEW save). It must NOT pin to
// a per-save key, because picking from settings is meant to influence the
// next save created from /library, /creator, or the cover screen — those
// surfaces also call useNarratorVoice(null) and read the same last-used
// value at mount. Mid-tale per-save changes happen on the read screen.
//
// Every reader-settings GROUP (label, options, the Illustrated-Book Pro-gate +
// coupling) now lives ONCE in `lib/readerSettingsGroups.ts`
// (reader-chrome-declutter R4.1/RC7). This surface maps over the groups tagged
// for "settings" and renders each with its OWN `SettingGroup` button primitive
// — a data-model extraction, not a visual merge. The in-reader
// `ReaderSettingsDrawer` renders the "drawer" subset from the same list.

// Surface-local help text (presentation, not definition — kept out of the
// shared module which is definitions-only). Keyed by the shared group key.
const SETTINGS_HELP: Record<string, string> = {
  imagesEnabled: "Turn off if data is limited.",
  audioEnabled: "Mutes the narrator voice and any ambient soundscape.",
  narratorPlaybackRate: "Adjust how fast the narrator reads.",
  videoEnabled: "Skip Veo videos. Image still shows.",
  cinematicMode:
    "How much generated media a run produces. Endpoint cinematics and Illustrated Book need Pro; your plan may cap the effective setting.",
  dialogBlocksEnabled: "Render quoted speech as indented blocks with the speaker's name.",
};

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
  // → paywall until the account is Pro (or the dev override previews it). ONE
  // gate, shared with the reader drawer (R4.1).
  const illustratedBookUnlocked = isIllustratedBookUnlocked(account.profile);

  // The full reader-settings inventory (R4.4): every group tagged for
  // /settings, rendered top-to-bottom in the shared canonical order.
  const settingsGroups = useMemo(
    () =>
      readerSettingsGroups({ illustratedUnlocked: illustratedBookUnlocked }).filter((g) =>
        g.surfaces.includes("settings"),
      ),
    [illustratedBookUnlocked],
  );

  // ONE per-group dispatch. Media gates round-trip through mediaPrefs; the
  // Cinematic-mode group hosts the coupled Illustrated Book strategy routed
  // through the shared `selectIllustratedBook` so the coupling + paywall fire
  // identically to the reader drawer.
  const handleSelect = (key: string, value: unknown) => {
    if (key === "layout") {
      // Mark this as an explicit user choice so ReaderScreen's phone-aware
      // default no longer overrides the stored value. Without this flag a
      // desktop reader who picks "Book" then loads on a phone would still see
      // Mobile — exactly the opposite of what the picker promises.
      markLayoutAsExplicitlyChosen();
      updateSettings({ layout: value as ReaderLayoutVariant });
      return;
    }
    if (key === "imagesEnabled" || key === "audioEnabled" || key === "videoEnabled") {
      // Sync server prefs from the post-merge snapshot (`next`) — NOT from the
      // closed-over `settings`. Two rapid toggles in the same frame would
      // otherwise each see the pre-toggle `settings` and the second one would
      // clobber the first sibling's change server-side.
      updateSettings({ [key]: value } as Partial<ReaderSettings>, (next) => {
        void syncMediaPrefs(account, pickMediaPrefs(next));
      });
      return;
    }
    if (key === "cinematicMode") {
      if (value === ILLUSTRATED_BOOK_STRATEGY) {
        const result = selectIllustratedBook({ illustratedUnlocked: illustratedBookUnlocked });
        if (result.kind === "paywall") {
          // R3.7: a non-Pro reader can never select into a permanent skeleton.
          router.push(result.route);
          return;
        }
        // RM7 / R3.8 coupling: set the image-first skin, force images-ON, and
        // the stills-guaranteeing strategy TOGETHER — `layout` is client-only
        // localStorage while `cinematicMode` round-trips through mediaPrefs, so
        // the two axes must move as one or the reader gets a full-bleed plate
        // that never fills.
        markLayoutAsExplicitlyChosen();
        updateSettings({ ...result.settings }, (next) => {
          void syncMediaPrefs(account, pickMediaPrefs(next));
        });
        return;
      }
      // Leaving Illustrated Book: if the reader picks any other strategy while
      // still on the image-first skin, drop back to the Book skin so they don't
      // strand on a full-bleed plate the new strategy may never fill.
      const leavingIllustrated = settings.layout === ILLUSTRATED_BOOK_LAYOUT;
      if (leavingIllustrated) markLayoutAsExplicitlyChosen();
      updateSettings(
        leavingIllustrated
          ? { cinematicMode: value as CinematicMode, layout: "book" }
          : { cinematicMode: value as CinematicMode },
        (next) => {
          // Persist locally (authoritative client cache) and echo to the server
          // through the mediaPrefs path from the post-merge snapshot — same
          // discipline as imagesEnabled.
          void syncMediaPrefs(account, pickMediaPrefs(next));
        },
      );
      return;
    }
    updateSettings({ [key]: value } as Partial<ReaderSettings>);
  };

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
              {settingsGroups.map((group) => {
                const help = SETTINGS_HELP[group.key];
                return (
                  <SettingGroup
                    key={group.key}
                    label={group.label}
                    {...(help ? { helpText: help } : {})}
                    options={group.options}
                    selected={(settings as Record<string, unknown>)[group.key]}
                    onSelect={(value) => handleSelect(group.key, value)}
                  />
                );
              })}

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
              <Button onPress={resetSettings}>Reset reader preferences</Button>
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

function SettingGroup({
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
  options: ReadonlyArray<SettingsOption<unknown>>;
  selected: unknown;
  onSelect: (value: unknown) => void;
}) {
  const { tokens } = useAppTheme();

  return (
    <View style={{ gap: tokens.spacing.sm }}>
      <Text style={{ fontWeight: "800" }} variant="subtitle">{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
        {options.map((option) => {
          const isSelected = selected === option.value;
          const locked = option.locked === true;
          // The Pro-gated Illustrated Book option reads as locked with a
          // plain-text " · Pro" suffix — never a lock emoji (RC5). Selecting it
          // routes to the paywall via the shared handler.
          const displayLabel = locked ? `${option.label} · Pro` : option.label;
          return (
            <Button
              accessibilityState={{ selected: isSelected }}
              key={String(option.value)}
              onPress={() => onSelect(option.value)}
              variant={isSelected ? "primary" : "default"}
            >
              {displayLabel}
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
