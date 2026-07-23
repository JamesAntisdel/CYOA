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
  /**
   * Deterministic-fallback sentinel mirrored from the server projection's
   * `isFallback`. When true the reader UI renders `<FallbackTurnPanel />`
   * (mounted by the layouts) in place of the prose surface + choices —
   * the deterministic placeholder text should NEVER be shown as if it
   * were a real scene. Optional / absent on every real-provider scene.
   */
  isFallback?: boolean;
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
    /** True while a Veo job is queued/generating in parallel with the image. */
    videoPending?: boolean;
    /** Ready image URI — anchored independently of the primary `uri`. */
    imageUri?: string;
    /** Ready video URI — drives the cinematic slot below the prose. */
    videoUri?: string;
    /**
     * Illustrated-Book credit-exhaustion signal. The server
     * (`queueSceneImage` mode-scoped fallback) sets this ONLY for the
     * `illustrated_book` strategy so the plate degrades to a stylized
     * PLACEHOLDER instead of a bare skeleton (reading-modes R3.4/R3.6). Every
     * other reader keeps the byte-identical delete-and-skeleton path and never
     * carries this field. `MediaPlate` reads it directly off the projection —
     * no defensive cast needed now that it is declared end-to-end.
     */
    outOfCredits?: boolean;
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
