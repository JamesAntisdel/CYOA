import { useEffect } from "react";
import { Platform } from "react-native";

import type { AmbientLoop } from "../../hooks/useStreamingScene";

type AmbientSoundscapeProps = {
  loop?: AmbientLoop | undefined;
  muted: boolean;
  reducedMotion: boolean;
  appActive: boolean;
};

export function AmbientSoundscape({ appActive, loop, muted, reducedMotion }: AmbientSoundscapeProps) {
  useEffect(() => {
    if (Platform.OS !== "web" || !loop || muted || reducedMotion || !appActive) return;
    if (typeof Audio === "undefined") return;

    const audio = new Audio(loop.uri);
    audio.loop = true;
    audio.volume = loop.volume;
    void audio.play().catch(() => undefined);

    return () => {
      audio.pause();
      audio.src = "";
    };
  }, [appActive, loop, muted, reducedMotion]);

  return null;
}
