import { useEffect, useRef, useState } from "react";

/**
 * Grace period for narrator-loading inference. The convex projection only
 * surfaces a `narrator` field once the Google Cloud TTS asset is `ready`,
 * so the client cannot directly observe "queued / generating" for narration.
 * Instead we infer loading: when a new scene appears and no narrator has
 * arrived yet, we keep the pip visible for up to this many ms — past that
 * we assume TTS is disabled or quietly failed.
 *
 * Chirp 3 HD voices take ~10-15s for a full-scene paragraph; we use 30s
 * as the ceiling so the pip stays through normal TTS latency without
 * leaving the indicator on indefinitely if narration silently fails.
 */
const NARRATOR_LOADING_GRACE_MS = 30000;

/**
 * useNarratorLoading — pure-client inference of "narrator clip is preparing"
 * for the read screen's loading pip.
 *
 * Inputs:
 *   - sceneId: identifies the current scene; loading resets when this changes.
 *   - narratorPresent: true once the SceneMediaProjection includes a narrator
 *     URI. When this flips true the loading window terminates immediately.
 *
 * Returns true between scene-appear and (narrator-arrive OR grace timeout).
 * Returns false otherwise.
 *
 * The hook does not poll Convex; it merely watches whichever projection
 * already lives upstream (useSceneMedia polling, in-memory tutorial scenes,
 * etc.) and lets the caller render a small visual cue without any backend
 * changes.
 */
export function useNarratorLoading(input: {
  sceneId: string | undefined;
  narratorPresent: boolean;
}): boolean {
  const { sceneId, narratorPresent } = input;
  const [loading, setLoading] = useState(false);
  // Track the scene id we last started a window for so we can detect
  // transitions without re-firing on unrelated re-renders.
  const watchedSceneId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!sceneId) {
      setLoading(false);
      watchedSceneId.current = undefined;
      return;
    }
    // Scene unchanged + narrator already present → nothing to do.
    if (watchedSceneId.current === sceneId && narratorPresent) {
      setLoading(false);
      return;
    }
    // Narrator already attached on first observation → no loading state.
    if (narratorPresent) {
      watchedSceneId.current = sceneId;
      setLoading(false);
      return;
    }
    // New scene without a narrator yet: open the grace window.
    if (watchedSceneId.current !== sceneId) {
      watchedSceneId.current = sceneId;
      setLoading(true);
      const timer = setTimeout(() => setLoading(false), NARRATOR_LOADING_GRACE_MS);
      return () => clearTimeout(timer);
    }
    // Same scene, narrator still absent → keep whatever the last decision
    // was (either inside the window or past it).
    return;
  }, [sceneId, narratorPresent]);

  return loading;
}
