import { useEffect } from "react";
import { Platform, View } from "react-native";

import { useMediaPlate, type SceneMedia } from "../../hooks/useMediaPlate";
import { MediaPlateImage } from "./MediaPlate.image";
import { MediaPlateSkeleton } from "./MediaPlate.skeleton";
import { MediaPlateVideo } from "./MediaPlate.video";

export type MediaPlateProps = {
  media: SceneMedia | undefined;
  reducedMotion: boolean;
};

/**
 * MediaPlate dispatcher — task 28.
 *
 * Subscribes to the Convex SceneMediaProjection (passed through useStreamingScene)
 * and dispatches one of four state components:
 *
 *   1. Skeleton (paper frame + candle ornament)
 *   2. Image   (Imagen plate, prose stays primary)
 *   3. Image + buffering pip (state 2 with Veo en route)
 *   4. Video   (Veo loop crossfaded over the image poster)
 *
 * Reduced-motion preference is honored at the hook level — the machine never
 * advances past state 2 when `reducedMotion` is true.
 *
 * Veo failure falls back to state 2 (image kept) per Requirement 27.5;
 * operator dashboard logging happens upstream in convex/media/veo.ts.
 */
export function MediaPlate({ media, reducedMotion }: MediaPlateProps) {
  const plate = useMediaPlate({ media, reduceMotion: reducedMotion });

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
      // Defensive — useMediaPlate guarantees a posterUri before entering `image`,
      // but if it ever lands here without one, fall back to the skeleton frame.
      return <MediaPlateSkeleton label={plate.label} />;
    }
    return (
      <MediaPlateImage
        alt={plate.media?.alt ?? plate.label}
        reducedMotion={reducedMotion}
        uri={plate.posterUri}
        videoFailed={plate.videoFailed}
      />
    );
  }

  if (plate.state === "videoBuffering") {
    // State 3 is "image with corner pip indicating Veo is en route".
    if (plate.posterUri) {
      return (
        <>
          <MediaPlateImage
            alt={plate.media?.alt ?? plate.label}
            reducedMotion={reducedMotion}
            uri={plate.posterUri}
            videoBuffering
          />
          {plate.videoUri ? (
            // Hidden surface that drives the loaded/failed callbacks; the
            // visible plate is still the image.
            <HiddenVideoLoader
              onFailed={plate.onVideoFailed}
              onLoaded={plate.onVideoLoaded}
              uri={plate.videoUri}
            />
          ) : null}
        </>
      );
    }
    // No poster yet — show skeleton while the video loads.
    return <MediaPlateSkeleton label={plate.label} />;
  }

  if (plate.state === "videoPlaying" && plate.videoUri) {
    return (
      <MediaPlateVideo
        alt={plate.media?.alt ?? plate.label}
        onFailed={plate.onVideoFailed}
        onLoaded={plate.onVideoLoaded}
        playing
        posterUri={plate.posterUri}
        uri={plate.videoUri}
      />
    );
  }

  return null;
}

/**
 * Mounts a tiny off-screen `<video>` during the buffering window so we can
 * hear `loadeddata` / `error` from the underlying element. The visible surface
 * is still the image plate. On native there is no preloader yet, so we fire
 * `onLoaded` immediately and let the next projection event drive the crossfade.
 */
function HiddenVideoLoader({
  onFailed,
  onLoaded,
  uri,
}: {
  uri: string;
  onLoaded: () => void;
  onFailed: () => void;
}) {
  useEffect(() => {
    if (Platform.OS !== "web") onLoaded();
  }, [onLoaded, uri]);

  if (Platform.OS !== "web") return null;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        height: 1,
        opacity: 0,
        position: "absolute",
        // Pull entirely off the layout grid; we only need the element mounted
        // so the browser starts the network request and we can hear events.
        right: -9999,
        top: -9999,
        width: 1,
      }}
    >
      <video
        muted
        onError={() => onFailed()}
        onLoadedData={() => onLoaded()}
        playsInline
        preload="auto"
        src={uri}
        style={{ height: 1, width: 1 }}
      />
    </View>
  );
}
