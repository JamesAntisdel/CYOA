import { useCallback, useEffect, useMemo, useState } from "react";

export type ReaderThemePreference = "day" | "night" | "sepia" | "system";
export type HudMode = "full" | "quiet" | "hidden";
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
   * Narrator TTS playback speed. Default 1. Persists across scenes and
   * sessions. The reader UI exposes four discrete options (0.75, 1, 1.25,
   * 1.5); the value is clamped at the hook boundary to a safe range so
   * arbitrary localStorage tampering can't push the audio element into
   * a pitch-distorting extreme.
   */
  narratorPlaybackRate: number;
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
  narratorPlaybackRate: 1,
};

export function useReaderSettings() {
  const [settings, setSettings] = useState<ReaderSettings>(defaultSettings);

  useEffect(() => {
    setSettings(readSettings());
  }, []);

  const updateSettings = useCallback((patch: Partial<ReaderSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      writeSettings(next);
      return next;
    });
  }, []);

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
      // Coerce a stored numeric rate to one of the four allowed steps.
      // Anything missing or out-of-range falls back to the 1x default —
      // we never trust localStorage to deliver a sane float.
      narratorPlaybackRate: isAllowedRate(parsed.narratorPlaybackRate)
        ? (parsed.narratorPlaybackRate as number)
        : defaultSettings.narratorPlaybackRate,
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

function isAllowedRate(value: unknown): value is number {
  return typeof value === "number" && (NARRATOR_PLAYBACK_RATES as readonly number[]).includes(value);
}

function getStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof globalThis === "undefined") return null;
  return (globalThis as { localStorage?: Storage }).localStorage ?? null;
}

function dispatchSettingsChanged(settings: ReaderSettings): void {
  if (typeof globalThis.dispatchEvent !== "function" || typeof globalThis.CustomEvent !== "function") return;
  globalThis.dispatchEvent(new CustomEvent(READER_SETTINGS_CHANGED_EVENT, { detail: settings }));
}
