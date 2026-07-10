import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, View } from "react-native";

import type { StreamingScene } from "../../hooks/useStreamingScene";
import { useMediaPreferences } from "../../hooks/useMediaPreferences";
import { Text } from "../primitives";
import { useAppTheme } from "../../theme";

type SceneCinematicProps = {
  media: StreamingScene["media"];
  /**
   * Caller override for reduced-motion. When omitted, falls back to the
   * `useMediaPreferences()` value — matches the SceneMedia contract.
   */
  reducedMotion?: boolean;
  /**
   * User-facing toggle for the cinematic slot. When false, this component
   * returns null regardless of asset readiness — mirrors the
   * `reducedMotion` gate but is independent of it (a reader can keep
   * motion on for the rest of the app while still skipping Veo videos to
   * save bandwidth). Defaults to true.
   */
  videoEnabled?: boolean;
};

/**
 * SceneCinematic — the lower "cinematic" slot.
 *
 * Lives below the prose surface in each reading layout and owns the Veo
 * video lifecycle independently of the image plate above the prose. The
 * image plate (rendered by SceneMedia → MediaPlate) is the page's visual
 * anchor and never swaps; this slot only engages when a Veo asset is
 * available and the user has not asked for reduced motion.
 *
 * Visual states:
 *
 *   1. hidden     - no video media on the scene, not pending, OR
 *                   reduced-motion is on, OR a prior video failed.
 *   2. loading    - the Convex projection flags `videoPending` (Veo job
 *                   queued / generating). Renders a small "Cinematic
 *                   loading…" pip mirroring NarratorControl's style.
 *   3. playing    - a ready Veo asset is attached. Autoplay + loop on
 *                   web; native gracefully degrades to nothing (no
 *                   expo-av wired here).
 *
 * Failure is silent — the slot simply hides on `videoFailed` so the
 * image plate up top still anchors the page.
 */
export function SceneCinematic({ media, reducedMotion, videoEnabled = true }: SceneCinematicProps) {
  const preferences = useMediaPreferences();
  const resolvedReducedMotion = reducedMotion ?? preferences.reducedMotion;

  // Track local video-element failure separately from projection status. A
  // <video> element might fail to load even when the projection reports
  // `status: "ready"`; the hosted file could 404 or be CORS-blocked. When
  // that happens we hide the slot quietly per the spec.
  //
  // IMPORTANT: every hook below must be called unconditionally. The user-
  // facing `videoEnabled` toggle flips between renders (Settings → toggle →
  // re-render), so an early `if (!videoEnabled) return null` placed before
  // the hook calls would change the hook count between renders and trip
  // React error #300 ("Rendered fewer hooks than expected"). All the
  // null-returning gates live AFTER the hook calls instead.
  const [videoFailed, setVideoFailed] = useState(false);

  // Prefer the explicit `videoUri` field from the projection — that's the
  // ready Veo URL regardless of which kind ended up as primary. Falls
  // back to the legacy `uri` only when the projection's primary is video.
  // Defensive: require a non-empty string before treating the URI as
  // playable. Without the length check an asset row that landed with
  // status==="ready" but an empty `url` (mis-set by an upstream bug or
  // a half-populated projection) would mount `<video src="">` and trip
  // the browser's "Invalid URI" error on every render.
  const rawVideoUri =
    media?.videoUri ??
    (media?.kind === "video" && media.status === "ready" ? media.uri : undefined);
  const videoUri =
    typeof rawVideoUri === "string" && rawVideoUri.length > 0 ? rawVideoUri : undefined;
  useEffect(() => {
    setVideoFailed(false);
  }, [videoUri]);

  // User-facing video gate. Mirror the `reducedMotion` short-circuit
  // below — toggling off the slider stops the slot from rendering even
  // when a ready Veo asset is attached to the scene. Placed AFTER the
  // hook calls above so the hook count stays stable when the toggle
  // flips between renders.
  if (!videoEnabled) return null;

  // Reduced-motion users never see the cinematic slot at all.
  if (resolvedReducedMotion) return null;
  if (!media) return null;
  if (videoFailed) return null;

  // A ready video URI wins regardless of whether the projection's primary
  // is image or video. The split UI always has its own anchor up top.
  if (videoUri) {
    return (
      <CinematicVideo
        alt={media.alt}
        onFailed={() => setVideoFailed(true)}
        uri={videoUri}
      />
    );
  }

  // No ready video URI. If a Veo job is queued/generating, show the
  // loading pip; otherwise the slot stays hidden.
  if (media.videoPending === true) {
    return <CinematicLoadingPip />;
  }
  if (media.kind === "video" && (media.status === "queued" || media.status === "generating")) {
    return <CinematicLoadingPip />;
  }
  return null;
}

type CinematicVideoProps = {
  uri: string;
  alt: string;
  onFailed: () => void;
};

/**
 * Visible video surface. 16:9 to match the image plate's aspect ratio and
 * sit comfortably below the prose box. Autoplays muted + looped on web; on
 * native we render nothing (no `expo-av` dep is wired in this app yet) so
 * the slot is effectively a no-op until a native video stack ships.
 */
function CinematicVideo({ alt, onFailed, uri }: CinematicVideoProps) {
  const { tokens } = useAppTheme();
  const fade = useRef(new Animated.Value(0)).current;
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Native has no event-driven load signal here — treat as loaded
    // immediately so the fade still completes (the surface will simply
    // render nothing on native until a real player ships).
    if (Platform.OS !== "web") setLoaded(true);
  }, [uri]);

  useEffect(() => {
    // useNativeDriver isn't supported on react-native-web for opacity in
    // some versions and falls back to a JS driver that can stall at 0,
    // leaving the video invisible even though loadedData fired. Use the
    // JS driver explicitly on web so the fade reliably reaches 1.
    Animated.timing(fade, {
      toValue: loaded ? 1 : 0,
      duration: 320,
      easing: Easing.out(Easing.quad),
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [fade, loaded]);

  if (Platform.OS !== "web") {
    // Native: until expo-av lands here we don't render anything. The image
    // plate above the prose remains the visual anchor.
    return null;
  }

  return (
    <Animated.View
      accessibilityLabel={alt}
      style={{
        aspectRatio: 16 / 9,
        borderColor: tokens.colors.borderMuted,
        borderRadius: tokens.radii.sm,
        borderWidth: tokens.borderWidths.hairline,
        opacity: fade,
        overflow: "hidden",
        width: "100%",
      }}
    >
      <video
        aria-label={alt}
        autoPlay
        loop
        muted
        onError={(e) => {
          // Surface the underlying media error so triage doesn't require
          // a Network-tab dive. Browsers populate event.currentTarget.error
          // with the MediaError (.code, .message) when the load fails.
          const target = e.currentTarget as HTMLVideoElement;
          const err = target.error;
          // eslint-disable-next-line no-console
          console.warn(
            `[SceneCinematic] video load failed: code=${err?.code} message=${err?.message ?? "unknown"} src=${uri.slice(0, 80)}`,
          );
          onFailed();
        }}
        onLoadedData={() => setLoaded(true)}
        playsInline
        src={uri}
        style={{ height: "100%", objectFit: "cover", width: "100%" }}
      />
    </Animated.View>
  );
}

/**
 * Loading pip for the lower slot. Mirrors NarratorControl's pip pattern —
 * pill-shaped, pulsing accent dot, paired with a small "Cinematic
 * loading…" label so the affordance is screen-reader friendly. Lives in
 * a right-aligned row so it doesn't visually compete with the prose box
 * above.
 */
function CinematicLoadingPip() {
  const { tokens } = useAppTheme();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: tokens.spacing.sm,
        justifyContent: "flex-end",
      }}
    >
      <View
        accessibilityLabel="Cinematic loading"
        accessibilityRole="progressbar"
        style={{
          alignItems: "center",
          backgroundColor: tokens.colors.surface,
          borderColor: tokens.colors.accent,
          borderRadius: tokens.radii.pill,
          borderWidth: tokens.borderWidths.regular,
          flexDirection: "row",
          gap: tokens.spacing.xs,
          paddingHorizontal: tokens.spacing.sm,
          paddingVertical: tokens.spacing.xs,
        }}
      >
        <Animated.View
          style={{
            backgroundColor: tokens.colors.accent,
            borderRadius: tokens.radii.pill,
            height: 6,
            opacity: pulse,
            width: 6,
          }}
        />
        <Text muted variant="bodySmall">
          Cinematic loading…
        </Text>
      </View>
    </View>
  );
}
