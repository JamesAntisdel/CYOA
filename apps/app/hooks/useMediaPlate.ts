import { useCallback, useEffect, useMemo, useReducer } from "react";

import type { StreamingScene } from "./useStreamingScene";

/**
 * MediaPlate state machine — task 28 (revised).
 *
 * The image plate above the prose is now the page's visual anchor and
 * never swaps to video. The Veo cinematic lives in a separate slot
 * (`SceneCinematic`) below the prose surface and owns its own lifecycle.
 * As a result, the image-plate state machine collapses from four states
 * to three:
 *
 *   1. idle      No visual media on the scene (audio-only ride-along).
 *   2. skeleton  Imagen job queued/generating, paper frame + candle ornament.
 *   3. image     Imagen plate ready; prose remains primary.
 *
 * Veo's `videoPending` / `videoFailed` no longer influence this slot —
 * the lower SceneCinematic slot consumes those signals directly. The
 * `onVideoLoaded` / `onVideoFailed` callbacks are kept on the result
 * shape for backwards compatibility but are now no-ops.
 *
 * Reduced-motion preference is irrelevant here — only the SceneCinematic
 * slot is gated on it.
 */

export type MediaPlateState = "idle" | "skeleton" | "image";

export type SceneMedia = NonNullable<StreamingScene["media"]>;

export type MediaPlateModel = {
  /** Current rendered state. */
  state: MediaPlateState;
  /** Last known image URI (used for the rendered <Image>). */
  posterUri: string | undefined;
  /** Source media projection (kept for diagnostics + downstream alt text). */
  media: SceneMedia | undefined;
  /** True when Imagen failed/blocked and we cannot render an image. */
  imageUnavailable: boolean;
  /** Surface label for skeleton + failure microcopy. */
  label: string;
};

type Action = { type: "media"; media: SceneMedia | undefined };

type ReducerState = {
  state: MediaPlateState;
  posterUri: string | undefined;
  media: SceneMedia | undefined;
  imageUnavailable: boolean;
};

const initialState: ReducerState = {
  state: "idle",
  posterUri: undefined,
  media: undefined,
  imageUnavailable: false,
};

/**
 * Pure transition. Exposed for unit tests; the hook drives this via useReducer.
 *
 * The reducer now collapses video media down to "did Imagen ever land?":
 *   - if yes -> stay on `image` with the prior poster as the anchor.
 *   - if no  -> show the skeleton frame.
 * The video stream itself is observed by SceneCinematic, not here.
 */
export function reduceMediaPlate(state: ReducerState, action: Action): ReducerState {
  switch (action.type) {
    case "media": {
      const { media } = action;
      // No media at all -> idle slot, prose stays primary.
      if (!media || media.status === "idle") {
        // Audio-only ambient ride-along doesn't paint a plate.
        if (media?.kind === "audio") {
          return { ...state, media, state: "idle" };
        }
        return initialState;
      }

      const isImage = media.kind === "image";
      const isVideo = media.kind === "video";
      // Prefer the explicit `imageUri` field when the projection provides
      // it — that's always the ready image regardless of whether video
      // has been ranked above as the primary kind. Fall back to the
      // legacy `uri` when the projection's primary IS the image.
      const projectedImageUri =
        media.imageUri ?? (isImage && media.status === "ready" ? media.uri : undefined);

      // Imagen plate path.
      if (isImage) {
        if (media.status === "ready" && projectedImageUri) {
          return {
            ...state,
            media,
            state: "image",
            posterUri: projectedImageUri,
            imageUnavailable: false,
          };
        }
        if (media.status === "failed" || media.status === "blocked") {
          // No image to fall back on. Skeleton frame with failure microcopy.
          return {
            ...state,
            media,
            state: "skeleton",
            imageUnavailable: true,
          };
        }
        // queued / generating
        return {
          ...state,
          media,
          state: "skeleton",
          imageUnavailable: false,
        };
      }

      // Video-kind media. Read the image URI directly from the projection
      // if available — that anchors the top plate even on fresh mounts
      // where there's no prior posterUri.
      if (isVideo) {
        const nextPoster = projectedImageUri ?? state.posterUri;
        return {
          ...state,
          media,
          state: nextPoster ? "image" : "skeleton",
          posterUri: nextPoster,
        };
      }

      return { ...state, media };
    }

    default:
      return state;
  }
}

export type UseMediaPlateInput = {
  media: SceneMedia | undefined;
  /**
   * Legacy flag — retained on the input shape so existing callers keep
   * compiling. The image slot no longer cares about reduced motion (only
   * the sibling SceneCinematic slot does), so this is effectively unused
   * by the reducer.
   */
  reduceMotion?: boolean;
};

export type UseMediaPlateResult = MediaPlateModel & {
  /**
   * Back-compat no-ops. Earlier revisions of this hook handed the video
   * lifecycle in here; the lifecycle now lives in SceneCinematic and
   * these callbacks are kept only so existing diff sites don't break.
   */
  onVideoLoaded: () => void;
  onVideoFailed: () => void;
};

export function useMediaPlate(input: UseMediaPlateInput): UseMediaPlateResult {
  const [state, dispatch] = useReducer(reduceMediaPlate, initialState);

  useEffect(() => {
    dispatch({ type: "media", media: input.media });
  }, [input.media]);

  const onVideoLoaded = useCallback(() => undefined, []);
  const onVideoFailed = useCallback(() => undefined, []);

  const label = useMemo(() => mediaLabel(state), [state]);

  return useMemo(
    () => ({
      state: state.state,
      posterUri: state.posterUri,
      media: state.media,
      imageUnavailable: state.imageUnavailable,
      label,
      onVideoLoaded,
      onVideoFailed,
    }),
    [
      label,
      onVideoFailed,
      onVideoLoaded,
      state.imageUnavailable,
      state.media,
      state.posterUri,
      state.state,
    ],
  );
}

function mediaLabel(state: ReducerState): string {
  if (state.imageUnavailable) {
    if (state.media?.status === "blocked") return "Illustration unavailable";
    return "Illustration could not be drawn";
  }
  if (state.state === "skeleton") {
    // Use the design-bundle microcopy verbatim.
    return "the scene is being drawn…";
  }
  return state.media?.alt ?? "";
}
