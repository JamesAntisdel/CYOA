import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";

import { Text } from "../primitives";
import { useAccountProfile } from "../../hooks/useAccountProfile";
import {
  useReaderSettings,
  type ReaderLayoutVariant,
  type ReaderSettings,
} from "../../hooks/useReaderSettings";
import {
  readerSettingsSections,
  isIllustratedBookUnlocked,
  selectIllustratedBook,
  ILLUSTRATED_BOOK_LABEL,
  ILLUSTRATED_BOOK_LAYOUT,
  type SettingsOption,
} from "../../lib/readerSettingsGroups";
import type { ReadingMode } from "../../lib/readingMode";
import { ReadingModeChooser } from "./ReadingModeChooser";
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
 * Both surfaces now render from ONE shared definition list
 * (`lib/readerSettingsGroups.ts`, reader-chrome-declutter R4.1/RC7): the
 * drawer maps over the groups tagged for the "drawer" surface — the strict
 * mid-tale subset (R4.4) — and renders each with its OWN `PillGroup`
 * primitive (a data-model extraction, not a visual merge). The
 * Illustrated-Book Pro-gate + coupling live in the shared module too, so the
 * gate fires identically here and on /settings.
 *
 * Subset (the shared groups — R4.4; + Candlelight focus, a phase-2 quick-win
 * offered mid-tale so a reader can flip the chrome dimming off without leaving
 * the story):
 *   Theme · Text size · Reading layout · Illustrations · Narration & ambient
 *   · Narrator speed · Scene cinematics · Reduce motion · Candlelight focus
 * (Reader HUD, Audio, Cinematic mode, Dialog blocks, Mature content, and the
 * Narrator voice picker stay /settings-only.)
 *
 * Mobile UX: full-width Modal that anchors to the bottom of the screen on
 * phone (sheet-style) and to the right on tablet/desktop (drawer-style).
 * Closes on backdrop tap, ESC, or Android back.
 */
export type ReaderSettingsDrawerProps = {
  visible: boolean;
  onClose: () => void;
  // Reading-modes cleanup (B3): the CURRENT content axis for the open save +
  // a live switch. Optional so a caller with no save in scope (or that hasn't
  // resolved the save's mode yet) simply omits the "How you read" section.
  // B2 wires these from the reader screen; the switch round-trips through the
  // server mutation and stays disabled while `switchPending`.
  currentReadingMode?: ReadingMode;
  onSwitchReadingMode?: (mode: ReadingMode) => void;
  switchPending?: boolean;
};

// Surface-local help text (presentation, not definition — kept out of the
// shared module which is definitions-only). Keyed by the shared group key.
const DRAWER_HELP: Record<string, string> = {
  imagesEnabled: "The scene image plate above the prose.",
  audioEnabled: "Narrator voice + scene soundscape.",
  videoEnabled: "Short Veo clip below the prose. Image still shows.",
  focusMode: "Dims the chrome while you read; any input restores it.",
};

export function ReaderSettingsDrawer({
  visible,
  onClose,
  currentReadingMode,
  onSwitchReadingMode,
  switchPending = false,
}: ReaderSettingsDrawerProps) {
  const { tokens } = useAppTheme();
  const { isPhone } = useBreakpoint();
  const { resetSettings, settings, updateSettings } = useReaderSettings();
  const account = useAccountProfile();
  const router = useRouter();

  // Illustrated Book (R3.7): Pro-gated so a non-Pro reader can never select
  // the image-first skin into a permanently empty plate — locked → paywall
  // until the account is Pro (or the dev override previews it). ONE gate,
  // shared with /settings (R4.1).
  const illustratedBookUnlocked = isIllustratedBookUnlocked(account.profile);

  // The mid-tale subset (R4.4), now filed under the three honest sections (B3):
  // "How you read" (the reading MODE — rendered as a live switch below, no
  // backing group), "How it looks", "Illustrations & narration".
  const drawerSections = useMemo(
    () =>
      readerSettingsSections({
        illustratedUnlocked: illustratedBookUnlocked,
        surface: "drawer",
      }),
    [illustratedBookUnlocked],
  );

  // The reading-mode switch only appears when the caller passed BOTH the
  // current mode and a handler (i.e. a save is in scope). exactOptional
  // propertyTypes: guard on the values, never render an inert control.
  const canSwitchMode = currentReadingMode != null && onSwitchReadingMode != null;

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

  // Illustrated Book's coupling (RM7) also round-trips the still-guaranteeing
  // `cinematicMode` — unlike the plain media-gate toggles above — so the
  // server strategy tracks the image-first skin. Separate from the gate sync
  // so the ordinary toggles keep their byte-identical three-field payload.
  const syncMediaPrefsWithStrategy = async (next: ReaderSettings) => {
    if (!account.profile) return;
    try {
      await account.setMediaPrefs({
        imagesEnabled: next.imagesEnabled,
        audioEnabled: next.audioEnabled,
        videoEnabled: next.videoEnabled,
        cinematicMode: next.cinematicMode,
      });
    } catch {
      // Silent — the next hydrate will reconcile.
    }
  };

  // ONE per-group dispatch. Media gates round-trip through mediaPrefs; the
  // Reading-layout group additionally offers the coupled Illustrated Book pill
  // (appended below) routed through the shared `selectIllustratedBook` so the
  // coupling + paywall fire identically to /settings.
  const handleSelect = (key: string, value: unknown) => {
    if (key === "layout") {
      if (value === ILLUSTRATED_BOOK_LAYOUT) {
        const result = selectIllustratedBook({ illustratedUnlocked: illustratedBookUnlocked });
        if (result.kind === "paywall") {
          // R3.7: a non-Pro reader can never select into a permanent skeleton.
          // Close the sheet BEFORE routing so the paywall isn't rendered under
          // the modal.
          onClose();
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
          void syncMediaPrefsWithStrategy(next);
        });
        return;
      }
      // Mirror /settings: mark as an explicit user choice so the phone-aware
      // auto-default doesn't override later.
      markLayoutAsExplicitlyChosen();
      updateSettings({ layout: value as ReaderLayoutVariant });
      return;
    }
    if (key === "imagesEnabled" || key === "audioEnabled" || key === "videoEnabled") {
      updateSettings({ [key]: value } as Partial<ReaderSettings>, (next) => {
        void syncMediaPrefs(next);
      });
      return;
    }
    updateSettings({ [key]: value } as Partial<ReaderSettings>);
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
              <Text style={{ fontWeight: "800" }} variant="subtitle">
                Close
              </Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{
              gap: tokens.spacing.lg,
              padding: tokens.spacing.lg,
            }}
          >
            {drawerSections.map((view) => {
              const { section } = view;

              // "How you read" (Axis 1): the per-save reading MODE. No backing
              // group — render the live two-option switch. Skip the whole
              // section (header included) when no save is in scope so the reader
              // never sees an inert control.
              if (section.key === "read") {
                if (!canSwitchMode) return null;
                return (
                  <View key={section.key} style={{ gap: tokens.spacing.sm }}>
                    <SectionHeader label={section.label} blurb={section.blurb} />
                    {/*
                     * Disable the switch while a change is in flight by making
                     * the whole radiogroup non-interactive + dimmed — the
                     * pinned ReadingModeChooser contract has no `disabled`
                     * prop, so we gate at the wrapper (reduced-motion-safe: no
                     * animation, just opacity + pointerEvents).
                     */}
                    <View
                      pointerEvents={switchPending ? "none" : "auto"}
                      style={{ opacity: switchPending ? 0.5 : 1 }}
                    >
                      <ReadingModeChooser
                        value={currentReadingMode as ReadingMode}
                        onChange={(mode) => onSwitchReadingMode?.(mode)}
                      />
                    </View>
                    {switchPending ? (
                      <Text muted variant="caption">
                        Switching…
                      </Text>
                    ) : null}
                  </View>
                );
              }

              // "How it looks" / "Illustrations & narration": the pill groups,
              // under an honest section heading.
              return (
                <View key={section.key} style={{ gap: tokens.spacing.md }}>
                  <SectionHeader label={section.label} blurb={section.blurb} />
                  {view.groups.map((group) => {
                    // The Reading-layout group appends the coupled Illustrated
                    // Book pill using the shared constants (design §1 — offered
                    // as a layout skin on the drawer, and as the cinematicMode
                    // strategy on /settings). `locked` drives the paywall route
                    // (RC5 — no glyph). Illustrated Book is a LOOK here; its
                    // media coupling is spelled out under Illustrations &
                    // narration.
                    const options: SettingsOption<unknown>[] =
                      group.key === "layout"
                        ? [
                            ...group.options,
                            {
                              label: ILLUSTRATED_BOOK_LABEL,
                              value: ILLUSTRATED_BOOK_LAYOUT,
                              locked: !illustratedBookUnlocked,
                            },
                          ]
                        : group.options;
                    const help = DRAWER_HELP[group.key];
                    return (
                      <PillGroup
                        key={group.key}
                        label={group.label}
                        {...(help ? { helpText: help } : {})}
                        options={options}
                        selected={(settings as Record<string, unknown>)[group.key]}
                        onSelect={(value) => handleSelect(group.key, value)}
                      />
                    );
                  })}
                </View>
              );
            })}

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

/**
 * Section heading (B3). One honest name per axis + a one-line blurb so a reader
 * can tell the content mode from the cosmetic skin from the media. Rendered
 * above each section's controls on the drawer; mirrors the /settings surface.
 */
function SectionHeader({ label, blurb }: { label: string; blurb: string }) {
  const { tokens } = useAppTheme();
  return (
    <View style={{ gap: tokens.spacing.xs }}>
      <Text style={{ fontWeight: "800" }} variant="subtitle">
        {label}
      </Text>
      <Text muted variant="caption">
        {blurb}
      </Text>
    </View>
  );
}

/**
 * Pill row group. Same visual treatment as the SettingGroup on /settings
 * so the two surfaces feel like one product. Active state changes fill +
 * text color only — no padding/border drift on selection. A `locked` option
 * (the Pro-gated Illustrated Book) renders a plain-text " · Pro" suffix and a
 * muted border — never a lock emoji (RC5) — and routes selection to the
 * paywall via the shared handler.
 */
function PillGroup({
  label,
  helpText,
  options,
  selected,
  onSelect,
}: {
  label: string;
  helpText?: string;
  options: ReadonlyArray<SettingsOption<unknown>>;
  selected: unknown;
  onSelect: (value: unknown) => void;
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
          const locked = option.locked === true;
          const displayLabel = locked ? `${option.label} · Pro` : option.label;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${label}: ${option.label}${locked ? " (locked)" : ""}`}
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
                opacity: pressed ? 0.75 : locked ? 0.7 : 1,
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
                {displayLabel}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
