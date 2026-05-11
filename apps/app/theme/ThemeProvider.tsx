import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AccessibilityInfo, ColorSchemeName, useColorScheme } from "react-native";

import {
  READER_SETTINGS_CHANGED_EVENT,
  READER_SETTINGS_KEY,
  type ReaderSettings,
} from "../hooks/useReaderSettings";
import { FontScale, scaleTypography, ThemeMode, themeTokens, ThemeTokens } from "./tokens";

type ThemePreference = ThemeMode | "system";

type ThemeContextValue = {
  tokens: ThemeTokens;
  mode: ThemeMode;
  preference: ThemePreference;
  fontScale: FontScale;
  reduceMotion: boolean;
  setPreference: (preference: ThemePreference) => void;
  setFontScale: (fontScale: FontScale) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function AppThemeProvider({ children }: PropsWithChildren) {
  const colorScheme = useColorScheme();
  const storedSettings = readStoredThemeSettings();
  const [preference, setPreference] = useState<ThemePreference>(storedSettings.theme ?? "system");
  const [fontScale, setFontScale] = useState<FontScale>(storedSettings.fontScale ?? "default");
  const [readerReduceMotion, setReaderReduceMotion] = useState(storedSettings.reduceMotion ?? false);
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) {
        setSystemReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setSystemReduceMotion);

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const eventTarget = getEventTarget();
    if (!eventTarget) return undefined;

    const syncSettings = () => {
      const nextSettings = readStoredThemeSettings();
      if (nextSettings.theme) setPreference(nextSettings.theme);
      if (nextSettings.fontScale) setFontScale(nextSettings.fontScale);
      if (typeof nextSettings.reduceMotion === "boolean") {
        setReaderReduceMotion(nextSettings.reduceMotion);
      }
    };

    eventTarget.addEventListener(READER_SETTINGS_CHANGED_EVENT, syncSettings);
    eventTarget.addEventListener("storage", syncSettings);

    return () => {
      eventTarget.removeEventListener(READER_SETTINGS_CHANGED_EVENT, syncSettings);
      eventTarget.removeEventListener("storage", syncSettings);
    };
  }, []);

  const mode = useMemo(
    () => resolveMode(preference, colorScheme),
    [colorScheme, preference],
  );

  const tokens = useMemo(
    () => scaleTypography(themeTokens[mode], fontScale),
    [fontScale, mode],
  );

  const updatePreference = useCallback((nextPreference: ThemePreference) => {
    setPreference(nextPreference);
  }, []);

  const updateFontScale = useCallback((nextFontScale: FontScale) => {
    setFontScale(nextFontScale);
  }, []);

  const reduceMotion = systemReduceMotion || readerReduceMotion;

  const value = useMemo<ThemeContextValue>(
    () => ({
      tokens,
      mode,
      preference,
      fontScale,
      reduceMotion,
      setPreference: updatePreference,
      setFontScale: updateFontScale,
    }),
    [fontScale, mode, preference, reduceMotion, tokens, updateFontScale, updatePreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  const value = useContext(ThemeContext);

  if (!value) {
    throw new Error("useAppTheme must be used within AppThemeProvider");
  }

  return value;
}

function resolveMode(preference: ThemePreference, colorScheme: ColorSchemeName): ThemeMode {
  if (preference !== "system") {
    return preference;
  }

  return colorScheme === "dark" ? "night" : "day";
}

function readStoredThemeSettings(): Partial<Pick<ReaderSettings, "theme" | "fontScale" | "reduceMotion">> {
  const storage = getStorage();
  if (!storage) return {};

  try {
    const raw = storage.getItem(READER_SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    const settings: Partial<Pick<ReaderSettings, "theme" | "fontScale" | "reduceMotion">> = {};

    if (isThemePreference(parsed.theme)) settings.theme = parsed.theme;
    if (isFontScale(parsed.fontScale)) settings.fontScale = parsed.fontScale;
    if (typeof parsed.reduceMotion === "boolean") settings.reduceMotion = parsed.reduceMotion;

    return settings;
  } catch {
    return {};
  }
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "day" || value === "night" || value === "sepia" || value === "system";
}

function isFontScale(value: unknown): value is FontScale {
  return value === "compact" || value === "default" || value === "large";
}

function getStorage(): Pick<Storage, "getItem"> | null {
  if (typeof globalThis === "undefined") return null;
  return (globalThis as { localStorage?: Storage }).localStorage ?? null;
}

function getEventTarget(): Pick<EventTarget, "addEventListener" | "removeEventListener"> | null {
  if (
    typeof globalThis === "undefined" ||
    typeof globalThis.addEventListener !== "function" ||
    typeof globalThis.removeEventListener !== "function"
  ) {
    return null;
  }

  return globalThis;
}
