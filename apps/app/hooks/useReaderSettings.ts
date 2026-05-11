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
};

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

function getStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof globalThis === "undefined") return null;
  return (globalThis as { localStorage?: Storage }).localStorage ?? null;
}

function dispatchSettingsChanged(settings: ReaderSettings): void {
  if (typeof globalThis.dispatchEvent !== "function" || typeof globalThis.CustomEvent !== "function") return;
  globalThis.dispatchEvent(new CustomEvent(READER_SETTINGS_CHANGED_EVENT, { detail: settings }));
}
