import { useEffect, useRef } from "react";
import { Animated, Easing, Image, Platform, View } from "react-native";

import { useAppTheme } from "../../theme";

type MediaPlateVideoProps = {
  uri: string;
  posterUri: string | undefined;
  alt: string;
  /** When true, video has reported `loadeddata` and is crossfading in. */
  playing: boolean;
  onLoaded: () => void;
  onFailed: () => void;
};

/**
 * State 4 — Veo cinematic playing.
 *
 * Image poster is kept mounted underneath so a Veo failure (or reduced-motion
 * fallback if we re-enter) can crossfade back to the still without flicker.
 * Lifted timing from canvas § 24B (`HCE.MediaPlayback`): 320ms crossfade.
 *
 * The plate never autoplays for reduced-motion users — the parent dispatcher
 * gates this component on `reduceMotion === false`.
 */
export function MediaPlateVideo({
  alt,
  onFailed,
  onLoaded,
  playing,
  posterUri,
  uri,
}: MediaPlateVideoProps) {
  const { tokens } = useAppTheme();
  const videoOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(videoOpacity, {
      toValue: playing ? 1 : 0,
      duration: 320,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [playing, videoOpacity]);

  return (
    <View
      accessibilityLabel={alt}
      style={{
        borderColor: tokens.colors.borderMuted,
        borderRadius: tokens.radii.sm,
        borderWidth: tokens.borderWidths.hairline,
        minHeight: 220,
        overflow: "hidden",
        position: "relative",
      }}
    >
      {posterUri ? (
        <Image
          accessibilityIgnoresInvertColors
          source={{ uri: posterUri }}
          style={{ height: "100%", position: "absolute", width: "100%" }}
        />
      ) : null}
      <Animated.View style={{ height: "100%", opacity: videoOpacity, width: "100%" }}>
        <VideoSurface alt={alt} onFailed={onFailed} onLoaded={onLoaded} uri={uri} />
      </Animated.View>
    </View>
  );
}

type VideoSurfaceProps = {
  uri: string;
  alt: string;
  onLoaded: () => void;
  onFailed: () => void;
};

/**
 * Platform-specific video host. On web we use the HTML <video> element with
 * loadeddata/error events. On native we don't ship `expo-av` here (Foundation
 * agent owns deps), so we fall back to immediate `onLoaded` so the crossfade
 * still completes and reduced-motion users on web are still respected upstream.
 */
function VideoSurface({ alt, onFailed, onLoaded, uri }: VideoSurfaceProps) {
  useEffect(() => {
    if (Platform.OS !== "web") {
      // Native poster-only path until a video stack ships here.
      onLoaded();
    }
    // Web path is event-driven below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  if (Platform.OS === "web") {
    return (
      <video
        aria-label={alt}
        autoPlay
        loop
        muted
        onError={() => onFailed()}
        onLoadedData={() => onLoaded()}
        playsInline
        src={uri}
        style={{ height: "100%", objectFit: "cover", width: "100%" }}
      />
    );
  }

  return null;
}
