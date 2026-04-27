import { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, AppState, Platform } from "react-native";

export type MediaPreferences = {
  muted: boolean;
  reducedMotion: boolean;
  appActive: boolean;
  nativeBackground: boolean;
  setMuted: (muted: boolean) => void;
};

export function useMediaPreferences(initialMuted = false): MediaPreferences {
  const [muted, setMuted] = useState(initialMuted);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion).catch(() => setReducedMotion(false));
    const reduceMotionSubscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion,
    );
    const appStateSubscription = AppState.addEventListener("change", setAppState);
    return () => {
      reduceMotionSubscription.remove();
      appStateSubscription.remove();
    };
  }, []);

  return useMemo(
    () => ({
      muted,
      reducedMotion,
      appActive: appState === "active",
      nativeBackground: Platform.OS !== "web" && appState !== "active",
      setMuted,
    }),
    [appState, muted, reducedMotion],
  );
}
