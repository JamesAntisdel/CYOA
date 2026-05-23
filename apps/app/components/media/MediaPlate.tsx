import { useMediaPlate, type SceneMedia } from "../../hooks/useMediaPlate";
import { MediaPlateImage } from "./MediaPlate.image";
import { MediaPlateSkeleton } from "./MediaPlate.skeleton";

export type MediaPlateProps = {
  media: SceneMedia | undefined;
  reducedMotion: boolean;
};

/**
 * MediaPlate dispatcher — task 28 (revised).
 *
 * The image plate above the prose is now the anchor: it never swaps to
 * the video. The four-state machine collapses to three (skeleton →
 * image, plus an idle no-op slot). Veo lives in the sibling
 * `<SceneCinematic>` slot below the prose surface.
 *
 *   1. idle      No visible plate (audio-only ride-along).
 *   2. skeleton  Paper frame + candle ornament while Imagen is queued.
 *   3. image     Imagen plate ready; prose stays primary.
 *
 * Reduced-motion still falls through here — the lower SceneCinematic
 * slot enforces it for the video lifecycle.
 */
export function MediaPlate({ media, reducedMotion }: MediaPlateProps) {
  const plate = useMediaPlate({ media });

  if (plate.state === "idle") return null;

  if (plate.state === "skeleton") {
    return (
      <MediaPlateSkeleton
        alt={plate.media?.alt}
        failed={plate.imageUnavailable}
        label={plate.label}
      />
    );
  }

  if (plate.state === "image") {
    if (!plate.posterUri) {
      // Defensive — useMediaPlate guarantees a posterUri before entering
      // `image`, but if it ever lands here without one, fall back to the
      // skeleton frame.
      return <MediaPlateSkeleton label={plate.label} />;
    }
    return (
      <MediaPlateImage
        alt={plate.media?.alt ?? plate.label}
        reducedMotion={reducedMotion}
        uri={plate.posterUri}
      />
    );
  }

  return null;
}
