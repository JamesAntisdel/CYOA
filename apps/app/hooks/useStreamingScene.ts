import { useEffect, useMemo, useState } from "react";

export type AmbientLoop = {
  id: string;
  uri: string;
  label: string;
  tags: string[];
  volume: number;
};

export type StreamingScene = {
  id: string;
  title: string;
  prose: string;
  media?: {
    status: "idle" | "queued" | "generating" | "ready" | "blocked" | "failed";
    kind: "image" | "video" | "audio";
    uri?: string;
    alt: string;
    durationMs?: number;
    ambient?: AmbientLoop;
  };
};

export function useStreamingScene(scene: StreamingScene, options?: { reducedMotion?: boolean }) {
  const [visibleCharacters, setVisibleCharacters] = useState(() =>
    options?.reducedMotion ? scene.prose.length : 0,
  );

  useEffect(() => {
    if (options?.reducedMotion) {
      setVisibleCharacters(scene.prose.length);
      return;
    }

    setVisibleCharacters(0);
    const step = Math.max(12, Math.ceil(scene.prose.length / 42));
    const interval = setInterval(() => {
      setVisibleCharacters((current) => {
        const next = Math.min(scene.prose.length, current + step);
        if (next >= scene.prose.length) {
          clearInterval(interval);
        }
        return next;
      });
    }, 28);

    return () => clearInterval(interval);
  }, [options?.reducedMotion, scene.id, scene.prose]);

  return useMemo(
    () => ({
      isStreaming: visibleCharacters < scene.prose.length,
      streamedProse: scene.prose.slice(0, visibleCharacters),
    }),
    [scene.prose, visibleCharacters],
  );
}
