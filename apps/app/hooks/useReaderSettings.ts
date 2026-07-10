import { useCallback, useEffect, useMemo, useState } from "react";

import { getLocalStorage as getStorage } from "../lib/storage";

export type ReaderThemePreference = "day" | "night" | "sepia" | "system";
export type HudMode = "full" | "quiet" | "hidden";
/**
 * Media-strategy the reader selects in /settings (omni-cinematics Req 1).
 * Persisted to `mediaPrefs.cinematicMode` and consumed by the Convex
 * media resolver, which composes it with entitlement + the per-modality
 * gates (Build Correction C4). The client value is the reader's request;
 * the server decides the *effective* strategy.
 *   off               No image or video jobs — text + narrator only.
 *   stills_only       Scene stills, no video.
 *   endpoint_cinematic Endpoint Omni cinematics (opening + ending).
 *   per_scene_legacy  The legacy per-turn Imagen→Veo chain.
 */
export type CinematicMode =
  | "off"
  | "stills_only"
  | "endpoint_cinematic"
  | "per_scene_legacy";

export const CINEMATIC_MODES: readonly CinematicMode[] = [
  "off",
  "stills_only",
  "endpoint_cinematic",
  "per_scene_legacy",
] as const;
export type ReaderLayoutMode = "book" | "focus";
export type ReaderLayoutVariant =
  | "book"
  | "modernApp"
  | "graphicNovel"
  | "journal"
  | "mobile";

export const READER_LAYOUT_VARIANTS: readonly ReaderLayoutVariant[] = [
  "book",
  "modernApp",
  "graphicNovel",
  "journal",
  "mobile",
] as const;

export type ReaderSettings = {
  theme: ReaderThemePreference;
  fontScale: "compact" | "default" | "large";
  hudMode: HudMode;
  layoutMode: ReaderLayoutMode;
  layout: ReaderLayoutVariant;
  muted: boolean;
  reduceMotion: boolean;
  /**
   * Show illustrations (image plate). Default true. Independent of the
   * server-side asset queue — flipping false just suppresses the visual
   * plate so toggling back on works without re-running the LLM.
   */
  imagesEnabled: boolean;
  /**
   * Play narrator TTS + ambient soundscape. Default true. When false,
   * neither the narrator audio element nor the AmbientSoundscape are
   * mounted, and the NarratorControl chrome is suppressed.
   */
  audioEnabled: boolean;
  /**
   * Play Veo cinematic in the lower slot. Default true. When false,
   * SceneCinematic short-circuits to null regardless of asset readiness.
   * Independent of the `reduceMotion` gate.
   */
  videoEnabled: boolean;
  /**
   * Media-strategy selector (omni-cinematics Req 1). Default
   * "endpoint_cinematic" — the north-star strategy; the server resolver
   * caps it by entitlement / the per-modality gates. Persisted through the
   * mediaPrefs path so it round-trips across devices as
   * `mediaPrefs.cinematicMode`.
   */
  cinematicMode: CinematicMode;
  /**
   * Narrator TTS playback speed. Default 1. Persists across scenes and
   * sessions. The reader UI exposes four discrete options (0.75, 1, 1.25,
   * 1.5); the value is clamped at the hook boundary to a safe range so
   * arbitrary localStorage tampering can't push the audio element into
   * a pitch-distorting extreme.
   */
  narratorPlaybackRate: number;
  /**
   * Render dialogue lines as distinct indented blocks (with an optional
   * speaker label) instead of inline within the prose flow. Default
   * true. Readers who prefer the original single-paragraph rendering
   * can flip this off in settings — the parser is bypassed entirely
   * when false so the visual is identical to the pre-feature behavior.
   */
  dialogBlocksEnabled: boolean;
};

export const NARRATOR_PLAYBACK_RATES: readonly number[] = [0.75, 1, 1.25, 1.5] as const;

export const READER_SETTINGS_KEY = "cyoa.readerSettings.v1";
export const READER_SETTINGS_CHANGED_EVENT = "cyoa.readerSettings.changed";

const defaultSettings: ReaderSettings = {
  theme: "system",
  fontScale: "default",
  hudMode: "full",
  layoutMode: "book",
  layout: "book",
  muted: false,
  reduceMotion: false,
  imagesEnabled: true,
  audioEnabled: true,
  videoEnabled: true,
  cinematicMode: "endpoint_cinematic",
  narratorPlaybackRate: 1,
  dialogBlocksEnabled: true,
};

export function useReaderSettings() {
  const [settings, setSettings] = useState<ReaderSettings>(defaultSettings);

  useEffect(() => {
    setSettings(readSettings());
  }, []);

  const updateSettings = useCallback(
    (
      patch: Partial<ReaderSettings>,
      // Optional side-effect that receives the post-merge snapshot. Runs
      // inside the setState updater so callers (notably /settings'
      // syncMediaPrefs server echo) always see the latest merged state
      // — even when multiple toggles fire in the same animation frame.
      // Without this, the closed-over `settings` value in each handler
      // ignored sibling updates in flight, so two rapid toggles could
      // race and the server-side prefs ended up with one of the changes
      // dropped.
      onMerged?: (next: ReaderSettings) => void,
    ) => {
      setSettings((current) => {
        const next = { ...current, ...patch };
        writeSettings(next);
        if (onMerged) onMerged(next);
        return next;
      });
    },
    [],
  );

  const resetSettings = useCallback(() => {
    writeSettings(defaultSettings);
    setSettings(defaultSettings);
  }, []);

  return useMemo(
    () => ({
      settings,
      updateSettings,
      resetSettings,
    }),
    [resetSettings, settings, updateSettings],
  );
}

function readSettings(): ReaderSettings {
  const storage = getStorage();
  if (!storage) return defaultSettings;

  try {
    const raw = storage.getItem(READER_SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    return {
      theme: isTheme(parsed.theme) ? parsed.theme : defaultSettings.theme,
      fontScale: parsed.fontScale === "compact" || parsed.fontScale === "large" ? parsed.fontScale : "default",
      hudMode: parsed.hudMode === "quiet" || parsed.hudMode === "hidden" ? parsed.hudMode : "full",
      layoutMode: parsed.layoutMode === "focus" ? "focus" : "book",
      layout: isLayoutVariant(parsed.layout) ? parsed.layout : defaultSettings.layout,
      muted: parsed.muted === true,
      reduceMotion: parsed.reduceMotion === true,
      // New media gates default to true, so a missing field reads as
      // "enabled". Only an explicit `=== false` flips the gate off.
      imagesEnabled: parsed.imagesEnabled !== false,
      audioEnabled: parsed.audioEnabled !== false,
      videoEnabled: parsed.videoEnabled !== false,
      // Unknown / missing → the endpoint-cinematic default.
      cinematicMode: isCinematicMode(parsed.cinematicMode)
        ? parsed.cinematicMode
        : defaultSettings.cinematicMode,
      // Coerce a stored numeric rate to one of the four allowed steps.
      // Anything missing or out-of-range falls back to the 1x default —
      // we never trust localStorage to deliver a sane float.
      narratorPlaybackRate: isAllowedRate(parsed.narratorPlaybackRate)
        ? (parsed.narratorPlaybackRate as number)
        : defaultSettings.narratorPlaybackRate,
      // Dialog blocks default to on; only an explicit `=== false` flips
      // them off so a missing field reads as enabled.
      dialogBlocksEnabled: parsed.dialogBlocksEnabled !== false,
    };
  } catch {
    return defaultSettings;
  }
}

function writeSettings(settings: ReaderSettings): void {
  getStorage()?.setItem(READER_SETTINGS_KEY, JSON.stringify(settings));
  dispatchSettingsChanged(settings);
}

function isTheme(value: unknown): value is ReaderThemePreference {
  return value === "day" || value === "night" || value === "sepia" || value === "system";
}

function isLayoutVariant(value: unknown): value is ReaderLayoutVariant {
  return (READER_LAYOUT_VARIANTS as readonly string[]).includes(value as string);
}

function isCinematicMode(value: unknown): value is CinematicMode {
  return (CINEMATIC_MODES as readonly string[]).includes(value as string);
}

function isAllowedRate(value: unknown): value is number {
  return typeof value === "number" && (NARRATOR_PLAYBACK_RATES as readonly number[]).includes(value);
}


function dispatchSettingsChanged(settings: ReaderSettings): void {
  if (typeof globalThis.dispatchEvent !== "function" || typeof globalThis.CustomEvent !== "function") return;
  globalThis.dispatchEvent(new CustomEvent(READER_SETTINGS_CHANGED_EVENT, { detail: settings }));
}
