/**
 * Merge the live (polled) `useSceneMedia` projection into the reader
 * projection's `scene.media` slot — gated on a scene-identity match.
 *
 * Why the gate exists: `useSceneMedia` polls Convex by `saveId` only, and
 * `getSceneMedia` resolves "current scene" via `save.currentSceneId` on the
 * server. That field flips to scene N+1 the moment `beginStreamingChoice`
 * commits its mutation, while the client's `projection.scene` is still N
 * until `useTurn`'s SSE stream resolves and the canonical refetch lands.
 *
 * Merging unconditionally produced the "text doesn't match narration" bug:
 * on-screen prose stayed on N while the narrator clip — keyed to the
 * server's already-advanced current scene — played N+1's TTS.
 *
 * The fix: the server now returns the scene's `nodeId` alongside the media
 * projection, and this helper drops the merge whenever the polled media is
 * for a different scene than the reader is currently looking at. The
 * narrator (and any cinematic video) then stays silent for the brief
 * window until `useTurn` lands the canonical scene N+1 — at which point
 * `projection.scene.id` and `liveMedia.nodeId` agree again and the merge
 * resumes.
 *
 * Backwards compat: when the server projection lacks `nodeId` (stale
 * bundle, older deployment), the gate falls through to the previous
 * unconditional merge so reads don't break.
 */
export type MergeableSceneProjection<Media> = {
  scene: {
    id: string;
    media?: Media;
  } & Record<string, unknown>;
} & Record<string, unknown>;

export type MergeableLiveMedia = {
  nodeId?: string;
} & Record<string, unknown>;

export function liveMediaMatchesScene(
  liveMedia: MergeableLiveMedia | null | undefined,
  sceneId: string,
): boolean {
  if (!liveMedia) return true;
  if (!liveMedia.nodeId) return true; // backwards-compat
  return liveMedia.nodeId === sceneId;
}

export function mergeLiveMediaIntoProjection<
  Media extends MergeableLiveMedia,
  Projection extends MergeableSceneProjection<Media>,
>(projection: Projection, liveMedia: Media | null | undefined): Projection {
  if (!liveMedia) return projection;
  if (!liveMediaMatchesScene(liveMedia, projection.scene.id)) return projection;
  return {
    ...projection,
    scene: { ...projection.scene, media: liveMedia },
  };
}
