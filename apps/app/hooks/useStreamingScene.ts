import { useEffect, useMemo, useState } from "react";
import type { ImageSourcePropType } from "react-native";

export type AmbientLoop = {
  id: string;
  uri: string;
  label: string;
  tags: string[];
  volume: number;
};

/**
 * Narrator TTS asset attached to a scene's media projection. Backend
 * generates this asynchronously from the save's pinned `voiceId` via
 * Google Cloud TTS; until the asset is `ready` the field is absent and
 * AudioMix simply does not play a narrator layer.
 *
 * Shape mirrors the convex SceneMediaProjection.narrator contract — keep
 * keys in sync with `convex/assets.ts` (`{ id; uri; voiceId }`).
 */
export type NarratorClip = {
  id: string;
  uri: string;
  voiceId: string;
};

export type StreamingScene = {
  id: string;
  title: string;
  prose: string;
  revealMode?: "typewriter" | "instant";
  media?: {
    status: "idle" | "queued" | "generating" | "ready" | "blocked" | "failed";
    kind: "image" | "video" | "audio";
    uri?: string;
    source?: ImageSourcePropType;
    alt: string;
    durationMs?: number;
    ambient?: AmbientLoop;
    /**
     * Narrator TTS clip surfaced from the convex SceneMediaProjection.
     * When present, SceneMedia routes it into AudioMix's narrator slot
     * (priority-1 audio layer; never ducked).
     */
    narrator?: NarratorClip;
  };
};

export function useStreamingScene(scene: StreamingScene, options?: { reducedMotion?: boolean }) {
  const [visibleCharacters, setVisibleCharacters] = useState(() =>
    options?.reducedMotion || scene.revealMode === "instant" ? scene.prose.length : 0,
  );

  useEffect(() => {
    if (options?.reducedMotion || scene.revealMode === "instant") {
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
  }, [options?.reducedMotion, scene.id, scene.prose, scene.revealMode]);

  return useMemo(
    () => ({
      isStreaming: visibleCharacters < scene.prose.length,
      streamedProse: scene.prose.slice(0, visibleCharacters),
    }),
    [scene.prose, visibleCharacters],
  );
}
