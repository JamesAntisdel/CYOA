// Shared reader-settings group definitions (reader-chrome-declutter R4.1/R4.2,
// design §1, RC7/RC11).
//
// ONE source of truth for every reader-settings GROUP: its canonical label
// (R4.2 — one name per group), its options, and which surface(s) render it.
// Both `/settings` (`app/settings/index.tsx`, `SettingGroup` buttons) and the
// in-reader `ReaderSettingsDrawer` (`PillGroup` pills) map over this list
// filtered by their surface tag and render with their OWN primitive — this is
// a DATA-MODEL extraction, not a visual merge (RC7). The Illustrated-Book
// Pro-gate + coupling constants + select handler live here too so the two
// surfaces share the ONE gate instead of the verbatim copies they carried in
// `settings/index.tsx` and `ReaderSettingsDrawer.tsx` (R4.1).
//
// This module is intentionally React-free and dependency-free so it can be
// transpiled + imported directly under `node --test` (see its .test.mjs).
//
// RC5 (glyph discipline): NO emoji here. The Illustrated-Book lock is a
// `locked` boolean on the option; each surface renders the locked state with
// its own on-system treatment (muted chip / plain "locked" text), never a 🔒.
//
// RC11 / PM P2: there is NO "Chrome (Book/Focus)" group. `layoutMode` is a
// dead control (consumed by nothing at HEAD, grep-verified) and is retired in
// task 2.2; it is deliberately absent from this list so neither surface can
// re-grow it.

// ── Surface / group model (design §1) ───────────────────────────────────────

export type SettingsSurface = "settings" | "drawer";

export type SettingsOption<T> = {
  label: string;
  value: T;
  // Present + true only on the Illustrated-Book option for a non-Pro reader:
  // the surface renders it as locked and routes selection to the paywall
  // (see `selectIllustratedBook`). Absent on every ordinary option.
  locked?: boolean;
};

export type SettingsGroupDef<T> = {
  // Stable id used by BOTH surfaces. For plain groups this is the
  // `ReaderSettings` field the group edits (`theme`, `fontScale`, …) so a
  // surface can dispatch `updateSettings({ [key]: value })`; the coupled
  // groups (`layout`, `cinematicMode`) route the Illustrated value through
  // `selectIllustratedBook` instead.
  key: string;
  label: string; // CANONICAL label (R4.2) — exactly one per group.
  options: SettingsOption<T>[];
  surfaces: SettingsSurface[]; // where this group renders.
};

// ── Illustrated Book: the ONE Pro-gate + coupling (moved from both surfaces) ─

// Illustrated Book couples two axes (RM7/R3.8): the cosmetic layout skin
// (`illustratedBook`, camelCase — client-only localStorage) and the
// still-guaranteeing media strategy (`illustrated_book`, snake_case — round-
// trips to the server via mediaPrefs.cinematicMode). Selecting the mode on
// EITHER surface writes both PLUS images-ON so the reader can never land on the
// image-first plate with a strategy that produces no still.
export const ILLUSTRATED_BOOK_STRATEGY = "illustrated_book" as const;
export const ILLUSTRATED_BOOK_LAYOUT = "illustratedBook" as const;

export const ILLUSTRATED_BOOK_SETTINGS = {
  layout: ILLUSTRATED_BOOK_LAYOUT,
  cinematicMode: ILLUSTRATED_BOOK_STRATEGY,
  imagesEnabled: true,
} as const;

// Canonical option label (R4.2). Fixes the drawer's "Illustrated" drift.
export const ILLUSTRATED_BOOK_LABEL = "Illustrated Book";

// The pro-media paywall route both surfaces navigate to when a non-Pro reader
// selects Illustrated Book (RC3 — a protected monetization surface, unchanged).
export const PRO_MEDIA_PAYWALL_ROUTE = "/paywall?reason=pro_media";

type EntitlementProfile = {
  entitlementTier: "free" | "unlimited" | "pro";
  entitlementStatus: "active" | "grace" | "expired" | "revoked";
} | null;

// Pro-gate for Illustrated Book (R3.7). The guaranteed still is a paid
// entitlement, so a non-Pro reader sees the option locked → paywall. The dev
// unlock mirrors the server `CYOA_DEV_FORCE_PRO_MEDIA` / `devForceProMedia`
// flag through the EXPO_PUBLIC_ seam so local dev previews the full mode; the
// literal access is required for the Expo web bundler to inline the value.
export function isIllustratedBookUnlocked(profile: EntitlementProfile): boolean {
  if (process.env.EXPO_PUBLIC_DEV_FORCE_PRO_MEDIA === "1") return true;
  return Boolean(
    profile &&
      profile.entitlementStatus === "active" &&
      (profile.entitlementTier === "pro" || profile.entitlementTier === "unlimited"),
  );
}

// Result of selecting Illustrated Book. The surface performs the effect
// (router.push for `paywall`; updateSettings(...settings) + media sync for
// `apply`) — the DECISION is shared so the coupling fires identically for both
// surfaces from this ONE handler.
export type IllustratedSelectResult =
  | { kind: "paywall"; route: string }
  | { kind: "apply"; settings: typeof ILLUSTRATED_BOOK_SETTINGS };

// The ONE coupled Illustrated-Book select/paywall handler (R4.1). Locked ⇒ the
// paywall route string; unlocked ⇒ the coupled layout + strategy + images-ON
// settings written TOGETHER (RM7/R3.8).
export function selectIllustratedBook(input: {
  illustratedUnlocked: boolean;
}): IllustratedSelectResult {
  if (!input.illustratedUnlocked) {
    return { kind: "paywall", route: PRO_MEDIA_PAYWALL_ROUTE };
  }
  return { kind: "apply", settings: ILLUSTRATED_BOOK_SETTINGS };
}

// ── The ordered group list ──────────────────────────────────────────────────

const BOTH: SettingsSurface[] = ["settings", "drawer"];
const SETTINGS_ONLY: SettingsSurface[] = ["settings"];

// Returns the FULL ordered reader-settings group list, each group tagged for
// the surface(s) it renders on. The 8 shared groups (surfaces include
// "drawer") are the strict mid-tale subset (R4.4); the settings-only groups
// (Reader HUD, Audio, Cinematic mode, Dialog blocks) render on `/settings`
// only. There is NO Chrome/layoutMode group (P2/RC11). Illustrated Book is a
// coupled control (see `selectIllustratedBook`): on `/settings` it is offered
// inside the Cinematic-mode group as the `illustrated_book` strategy (below);
// the drawer offers it as an appended layout pill using the shared constants.
export function readerSettingsGroups(input: {
  illustratedUnlocked: boolean;
}): SettingsGroupDef<unknown>[] {
  const illustratedLocked = !input.illustratedUnlocked;

  const groups: SettingsGroupDef<unknown>[] = [
    // ── 8 shared groups (mid-tale subset, R4.4) ──
    {
      key: "theme",
      label: "Theme",
      surfaces: BOTH,
      options: [
        { label: "System", value: "system" },
        { label: "Day", value: "day" },
        { label: "Night", value: "night" },
        { label: "Sepia", value: "sepia" },
      ],
    },
    {
      key: "fontScale",
      label: "Text size",
      surfaces: BOTH,
      options: [
        { label: "Compact", value: "compact" },
        { label: "Default", value: "default" },
        { label: "Large", value: "large" },
      ],
    },
    {
      key: "layout",
      label: "Reading layout",
      surfaces: BOTH,
      options: [
        { label: "Book", value: "book" },
        { label: "Modern app", value: "modernApp" },
        { label: "Graphic novel", value: "graphicNovel" },
        { label: "Journal", value: "journal" },
        { label: "Mobile", value: "mobile" },
      ],
    },
    {
      key: "imagesEnabled",
      label: "Illustrations",
      surfaces: BOTH,
      options: [
        { label: "On", value: true },
        { label: "Off", value: false },
      ],
    },
    {
      key: "audioEnabled",
      label: "Narration & ambient",
      surfaces: BOTH,
      options: [
        { label: "On", value: true },
        { label: "Off", value: false },
      ],
    },
    {
      key: "narratorPlaybackRate",
      label: "Narrator speed",
      surfaces: BOTH,
      options: [
        { label: "0.75x", value: 0.75 },
        { label: "1x", value: 1 },
        { label: "1.25x", value: 1.25 },
        { label: "1.5x", value: 1.5 },
      ],
    },
    {
      key: "videoEnabled",
      label: "Scene cinematics",
      surfaces: BOTH,
      options: [
        { label: "On", value: true },
        { label: "Off", value: false },
      ],
    },
    {
      key: "reduceMotion",
      label: "Reduce motion",
      surfaces: BOTH,
      options: [
        { label: "Motion on", value: false },
        { label: "Reduce motion", value: true },
      ],
    },
    {
      // Candlelight Focus (phase-2 quick-win). Fades the top bar + story ribbon
      // after ~4s of no input while reading; any input restores them instantly.
      // Offered on BOTH surfaces so a reader who finds the dimming distracting
      // can flip it off mid-tale from the drawer without leaving the story.
      // A plain boolean group — both surfaces' default dispatch
      // (`updateSettings({ [key]: value })`) handles it with no coupling.
      key: "focusMode",
      label: "Candlelight focus",
      surfaces: BOTH,
      options: [
        { label: "On", value: true },
        { label: "Off", value: false },
      ],
    },

    // ── settings-only groups (R4.4) ──
    {
      key: "hudMode",
      label: "Reader HUD",
      surfaces: SETTINGS_ONLY,
      options: [
        { label: "Full", value: "full" },
        { label: "Quiet", value: "quiet" },
        { label: "Hidden", value: "hidden" },
      ],
    },
    {
      // The merged Audio section (R4.3): one coherent sound control on
      // `/settings`. Distinct from "Narration & ambient" (audioEnabled) — this
      // is the global mute gate.
      key: "muted",
      label: "Audio",
      surfaces: SETTINGS_ONLY,
      options: [
        { label: "Sound on", value: false },
        { label: "Mute", value: true },
      ],
    },
    {
      key: "cinematicMode",
      label: "Cinematic mode",
      surfaces: SETTINGS_ONLY,
      options: [
        { label: "Off", value: "off" },
        { label: "Stills only", value: "stills_only" },
        { label: "Endpoint cinematics", value: "endpoint_cinematic" },
        { label: "Per-scene", value: "per_scene_legacy" },
        // Illustrated Book carries the guaranteed-still strategy (OQ7 distinct
        // value). `locked` drives the paywall route (RC5 — no lock glyph).
        { label: ILLUSTRATED_BOOK_LABEL, value: ILLUSTRATED_BOOK_STRATEGY, locked: illustratedLocked },
      ],
    },
    {
      key: "dialogBlocksEnabled",
      label: "Dialog blocks",
      surfaces: SETTINGS_ONLY,
      options: [
        { label: "On", value: true },
        { label: "Off", value: false },
      ],
    },
    {
      // "Experimental: Desk home" (the-desk R1.2). Opt-in for the diegetic
      // writer's-desk home; default OFF, settings-surface only. A plain boolean
      // group — the settings screen's default dispatch (`updateSettings({
      // [key]: value })`) handles it with no coupling; the `key` matches the
      // `deskHome` ReaderSettings field so the toggle writes it directly. The
      // "Experimental:" prefix in the label is the R1.2 clear experimental
      // marker (RC5: text only, no glyph).
      key: "deskHome",
      label: "Experimental: Desk home",
      surfaces: SETTINGS_ONLY,
      options: [
        { label: "On", value: true },
        { label: "Off", value: false },
      ],
    },
  ];

  return groups;
}
