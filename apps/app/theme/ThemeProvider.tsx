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
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [fontScale, setFontScale] = useState<FontScale>("default");
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);

    return () => {
      mounted = false;
      subscription.remove();
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
