import { useCallback, useEffect, useMemo, useReducer } from "react";

import type { StreamingScene } from "./useStreamingScene";

/**
 * MediaPlate upgrade pattern — task 28.
 *
 * Four reactive states driven off the Convex assets projection
 * (see convex/assets.ts -> SceneMediaProjection):
 *
 *   1. skeleton        Imagen job queued/generating, paper frame + candle ornament.
 *   2. image           Imagen plate ready; prose remains primary.
 *   3. videoBuffering  Veo asset has arrived but the <video> element is still loading.
 *   4. videoPlaying    Veo loop crossfaded in; image kept as poster.
 *
 * Reduced-motion preference stops the machine at `image` permanently.
 * Veo failure falls back to `image` (Requirement 27.5 — operator dashboard log).
 */

export type MediaPlateState =
  | "idle"
  | "skeleton"
  | "image"
  | "videoBuffering"
  | "videoPlaying";

export type SceneMedia = NonNullable<StreamingScene["media"]>;

export type MediaPlateModel = {
  /** Current rendered state. */
  state: MediaPlateState;
  /** Last known image URI (used as poster while video plates upgrade). */
  posterUri: string | undefined;
  /** Active video URI when video stack is engaged. */
  videoUri: string | undefined;
  /** Source media projection (kept for diagnostics + downstream alt text). */
  media: SceneMedia | undefined;
  /** True when Veo failed and the plate is sitting on the poster fallback. */
  videoFailed: boolean;
  /** True when Imagen failed/blocked and we cannot render an image. */
  imageUnavailable: boolean;
  /** Surface label for skeleton + failure microcopy. */
  label: string;
};

type Action =
  | { type: "media"; media: SceneMedia | undefined; reduceMotion: boolean }
  | { type: "videoLoaded" }
  | { type: "videoFailed" };

type ReducerState = {
  state: MediaPlateState;
  posterUri: string | undefined;
  videoUri: string | undefined;
  media: SceneMedia | undefined;
  videoFailed: boolean;
  imageUnavailable: boolean;
  reduceMotion: boolean;
};

const initialState: ReducerState = {
  state: "idle",
  posterUri: undefined,
  videoUri: undefined,
  media: undefined,
  videoFailed: false,
  imageUnavailable: false,
  reduceMotion: false,
};

/**
 * Pure transition. Exposed for unit tests; the hook drives this via useReducer.
 */
export function reduceMediaPlate(state: ReducerState, action: Action): ReducerState {
  switch (action.type) {
    case "media": {
      const { media, reduceMotion } = action;
      // No media at all -> idle slot, prose stays primary.
      if (!media || media.status === "idle") {
        // Audio-only ambient ride-along doesn't paint a plate.
        if (media?.kind === "audio") {
          return {
            ...state,
            media,
            reduceMotion,
            state: "idle",
          };
        }
        return { ...initialState, reduceMotion };
      }

      const isImage = media.kind === "image";
      const isVideo = media.kind === "video";

      // Imagen plate path.
      if (isImage) {
        if (media.status === "ready" && media.uri) {
          return {
            ...state,
            media,
            reduceMotion,
            state: "image",
            posterUri: media.uri,
            imageUnavailable: false,
          };
        }
        if (media.status === "failed" || media.status === "blocked") {
          // No image to fall back on. Skeleton frame with failure microcopy.
          return {
            ...state,
            media,
            reduceMotion,
            state: "skeleton",
            imageUnavailable: true,
          };
        }
        // queued / generating
        return {
          ...state,
          media,
          reduceMotion,
          state: "skeleton",
          imageUnavailable: false,
        };
      }

      // Veo upgrade path.
      if (isVideo) {
        // Reduced motion -> never engage video, stay on the most recent poster.
        if (reduceMotion) {
          return {
            ...state,
            media,
            reduceMotion,
            // If we have a poster, stay on image; otherwise show the skeleton.
            state: state.posterUri ? "image" : "skeleton",
            videoUri: undefined,
            videoFailed: false,
          };
        }

        if (media.status === "ready" && media.uri) {
          // If we still don't have a poster, the video URI doubles as the poster.
          const nextPoster = state.posterUri ?? media.uri;
          return {
            ...state,
            media,
            reduceMotion,
            state: state.videoFailed ? "image" : "videoBuffering",
            posterUri: nextPoster,
            videoUri: media.uri,
          };
        }
        if (media.status === "failed" || media.status === "blocked") {
          // Operator dashboard logging happens upstream; UI falls back to image.
          return {
            ...state,
            media,
            reduceMotion,
            state: state.posterUri ? "image" : "skeleton",
            videoFailed: true,
            videoUri: undefined,
          };
        }
        // queued / generating -> keep current visual (image if we have one, else skeleton).
        return {
          ...state,
          media,
          reduceMotion,
          state: state.posterUri ? "image" : "skeleton",
        };
      }

      return { ...state, media, reduceMotion };
    }

    case "videoLoaded": {
      if (state.state !== "videoBuffering" || state.reduceMotion) return state;
      return { ...state, state: "videoPlaying" };
    }

    case "videoFailed": {
      // Crossfade back to poster image (state 2) per requirement 27.5.
      return {
        ...state,
        state: state.posterUri ? "image" : "skeleton",
        videoUri: undefined,
        videoFailed: true,
      };
    }

    default:
      return state;
  }
}

export type UseMediaPlateInput = {
  media: SceneMedia | undefined;
  reduceMotion: boolean;
};

export type UseMediaPlateResult = MediaPlateModel & {
  onVideoLoaded: () => void;
  onVideoFailed: () => void;
};

export function useMediaPlate(input: UseMediaPlateInput): UseMediaPlateResult {
  const [state, dispatch] = useReducer(reduceMediaPlate, {
    ...initialState,
    reduceMotion: input.reduceMotion,
  });

  useEffect(() => {
    dispatch({ type: "media", media: input.media, reduceMotion: input.reduceMotion });
  }, [input.media, input.reduceMotion]);

  const onVideoLoaded = useCallback(() => dispatch({ type: "videoLoaded" }), []);
  const onVideoFailed = useCallback(() => dispatch({ type: "videoFailed" }), []);

  const label = useMemo(() => mediaLabel(state), [state]);

  return useMemo(
    () => ({
      state: state.state,
      posterUri: state.posterUri,
      videoUri: state.videoUri,
      media: state.media,
      videoFailed: state.videoFailed,
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
      state.videoFailed,
      state.videoUri,
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
  if (state.state === "videoBuffering") {
    return "Cinematic loading";
  }
  if (state.videoFailed) {
    return "Cinematic unavailable";
  }
  return state.media?.alt ?? "";
}
