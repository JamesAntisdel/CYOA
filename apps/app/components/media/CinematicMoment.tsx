import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Platform, Pressable, View } from "react-native";

import type { RemoteCinematicView } from "../../lib/cinematicApi";
import { useNarratorPlayback } from "../../hooks/useNarratorPlayback";
import { Text } from "../primitives";
import { useAppTheme } from "../../theme";
import {
  resolveCinematicAudio,
  resolveCinematicMomentState,
  type CinematicMomentState,
} from "./cinematicMomentState";

export type CinematicMomentProps = {
  /** The cinematic to present. Null/undefined renders nothing. */
  cinematic: RemoteCinematicView | null | undefined;
  /**
   * Endpoint key still to fall back to while the cinematic is not yet
   * `ready` (Req 7.2). Also used as the poster when the cinematic itself
   * carries no `posterUrl`.
   */
  posterFallbackUri?: string;
  /** Reader reduced-motion preference — holds the poster, never autoplays. */
  reducedMotion: boolean;
  /** Reader mute preference — the video plays silent when true. */
  muted: boolean;
  /**
   * Reader's master audio toggle (settings.audioEnabled). When false the
   * cinematic plays silent even if it carries an Omni native track — parity
   * with the reader's narrator/ambient gate. Defaults to true so existing
   * callers keep their current (mute-only) behavior.
   */
  audioEnabled?: boolean;
  /**
   * Optional ending-prose narrator TTS to mix over the native soundscape at
   * a reduced duck (Req 6.2). Absent ⇒ the native track plays at full volume
   * with no mix; present ⇒ the native audio ducks (see `NATIVE_AUDIO_DUCK`)
   * while the narrator speaks. Additive: passing nothing is never an error.
   */
  narratorUri?: string;
  /** Base narrator volume in [0, 1]. Default 1. */
  narratorVolume?: number;
  /** Skip affordance. When provided a "Skip" control is shown. */
  onSkip?: () => void;
  /** Fired when the video plays to its end — callers use this to retire a
   * one-time moment so it isn't shown again. */
  onEnded?: () => void;
};

/**
 * CinematicMoment — the full-bleed endpoint cinematic surface (Req 7.1).
 *
 * Distinct from the inline `MediaPlate`: this is the "movie of your
 * playthrough" moment shown at an ending (and, later, an opening title
 * sequence). It runs the four-state loading pattern (Skeleton → poster
 * still → buffering → playing), falls back to a provided key still until
 * the cinematic lands, and upgrades in place when it does. Reduced-motion
 * holds the poster and never autoplays (Req 6.3 / 7.4). Native audio plays
 * through the `<video>` element and respects the reader's mute preference.
 *
 * Platform note: like `SceneCinematic` / `VeoCinematic`, real video
 * playback is web-only for now (no `expo-av` is wired). On native the
 * surface shows the poster/still with a "Cinematic ready" affordance
 * rather than a black no-op player.
 */
export function CinematicMoment({
  cinematic,
  posterFallbackUri,
  reducedMotion,
  muted,
  audioEnabled = true,
  narratorUri,
  narratorVolume = 1,
  onSkip,
  onEnded,
}: CinematicMomentProps) {
  const { tokens } = useAppTheme();

  // Playback intent + <video> readiness are local UI state. Every hook is
  // called unconditionally (the surface may flip between states across
  // polls / preference toggles) so the hook count stays stable.
  const [playRequested, setPlayRequested] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  // A fallback still stores the POSTER IMAGE in `url` (not a playable video),
  // so treat it as a still, never load it into <video>. A real cinematic's
  // `url` is the video.
  const isStillFallback = cinematic?.fallbackKind === "still";
  const rawUrl = cinematic?.url;
  const urlPresent = typeof rawUrl === "string" && rawUrl.length > 0;
  const posterUri =
    (isStillFallback && urlPresent ? rawUrl : undefined) ??
    cinematic?.posterUrl ??
    posterFallbackUri;
  const videoUri = !isStillFallback && urlPresent ? rawUrl : undefined;
  const canPlayVideo = Platform.OS === "web" && !videoFailed && Boolean(videoUri);

  // Reset transient playback state when the underlying asset changes so a
  // fresh cinematic (new ending row) starts back at its poster.
  useEffect(() => {
    setPlayRequested(false);
    setVideoReady(false);
    setVideoFailed(false);
  }, [videoUri]);

  const { state, canPlay } = resolveCinematicMomentState({
    status: cinematic?.status,
    hasVideo: canPlayVideo,
    hasStill: Boolean(posterUri),
    reducedMotion,
    playRequested,
    videoReady,
  });

  // --- Native audio + narrator mix (Req 6.2 / 6.3) --------------------------
  // The Omni native soundscape rides the <video> element's own audio track.
  // The pure resolver decides whether to emit it, whether to duck it, and
  // whether the ending-prose narrator may speak over it — all gated on the
  // reader's mute / audio-enabled prefs and the `playing` state (reduced-
  // motion holds a poster, never reaches `playing`, so it's always silent).
  const narratorEligible =
    resolveCinematicAudio({
      state,
      hasAudio: cinematic?.hasAudio === true,
      muted,
      audioEnabled,
      narratorPlaying: false,
    }).narratorActive;

  // Optional ending-prose narrator TTS, ducked over the native track. Reuses
  // the exact HTMLAudio/mute/volume discipline of `useNarratorPlayback` (the
  // scene narrator). It only speaks while the cinematic is actually playing;
  // absent `narratorUri` ⇒ this is an inert no-op (silent, never an error).
  const narrator = useNarratorPlayback({
    uri: narratorEligible ? narratorUri : undefined,
    paused: state !== "playing",
    muted: !narratorEligible,
    volume: narratorVolume,
  });

  // Final mix, now that we know whether the narrator is mid-sentence: the
  // native track ducks under a speaking narrator, is muted outright when the
  // reader disallows audio / the clip has no native track (silent playback,
  // the "no audio config" degrade path), else plays at full volume.
  const { nativeAudioActive, nativeVolume } = resolveCinematicAudio({
    state,
    hasAudio: cinematic?.hasAudio === true,
    muted,
    audioEnabled,
    narratorPlaying: narrator.isPlaying,
  });

  if (state === "hidden") return null;

  const alt = cinematic?.endingId
    ? `Cinematic for ${cinematic.endingId}`
    : "Cinematic moment";

  return (
    <View
      accessibilityLabel={alt}
      style={{
        aspectRatio: 16 / 9,
        backgroundColor: tokens.colors.text,
        borderColor: tokens.colors.border,
        borderRadius: tokens.radii.sm,
        borderWidth: tokens.borderWidths.regular,
        overflow: "hidden",
        position: "relative",
        width: "100%",
      }}
    >
      {state === "skeleton" ? (
        <CinematicSkeleton />
      ) : state === "failed" ? (
        <CinematicUnavailable />
      ) : (state === "playing" || state === "buffering") && videoUri ? (
        // The <video> MUST mount in `buffering` too, not just `playing`:
        // `buffering` only advances to `playing` when the element's `onCanPlay`
        // fires, which can't happen unless the element is mounted and loading.
        // Rendering the poster here instead would deadlock the play control
        // ("Loading cinematic…" forever).
        <CinematicVideo
          alt={alt}
          muted={!nativeAudioActive}
          volume={nativeVolume}
          uri={videoUri}
          onEnded={() => {
            setPlayRequested(false);
            onEnded?.();
          }}
          onFailed={() => setVideoFailed(true)}
          onReady={() => setVideoReady(true)}
        />
      ) : (
        <CinematicPoster alt={alt} uri={posterUri} reducedMotion={reducedMotion} />
      )}

      {/* Play control — only on a ready, at-rest poster with motion on. */}
      {state === "poster" && canPlay ? (
        <PlayControl
          onPress={() => {
            setVideoReady(false);
            setPlayRequested(true);
          }}
        />
      ) : null}

      {/* Buffering pip while the video loads after a play request. */}
      {state === "buffering" ? <StatusPip label="Loading cinematic…" /> : null}

      {/* Generating badge while the endpoint still holds the frame. */}
      {state === "poster" && !canPlay && isGenerating(cinematic?.status) ? (
        <StatusPip label="Cinematic generating…" />
      ) : null}

      {/* Reduced-motion note on a ready-but-held poster. */}
      {state === "poster" && reducedMotion && isReady(cinematic?.status) ? (
        <StatusPip label="Cinematic ready · motion reduced" />
      ) : null}

      {/* Controls row: replay (while playing) + skip. */}
      <ControlsRow>
        {state === "playing" ? (
          <ControlButton
            label="Replay"
            onPress={() => {
              setVideoReady(false);
              // Force a remount of the <video> so it restarts from 0.
              setPlayRequested(false);
              setTimeout(() => setPlayRequested(true), 0);
            }}
          />
        ) : null}
        {onSkip ? <ControlButton label="Skip" onPress={onSkip} /> : null}
      </ControlsRow>
    </View>
  );
}

function isGenerating(status: RemoteCinematicView["status"] | undefined): boolean {
  return status === "queued" || status === "generating";
}
function isReady(status: RemoteCinematicView["status"] | undefined): boolean {
  return status === "ready";
}

type PosterProps = { uri: string | undefined; alt: string; reducedMotion: boolean };

function CinematicPoster({ alt, reducedMotion, uri }: PosterProps) {
  const { tokens } = useAppTheme();
  const fade = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reducedMotion) {
      fade.setValue(1);
      return;
    }
    Animated.timing(fade, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.quad),
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [fade, reducedMotion, uri]);

  if (!uri || uri.length === 0) {
    // No still at all — a neutral filled frame so the surface still reads
    // as a cinematic plate rather than a broken image.
    return (
      <View
        accessibilityLabel={alt}
        style={{ backgroundColor: tokens.colors.overlay, height: "100%", width: "100%" }}
      />
    );
  }

  return (
    <Animated.View style={{ height: "100%", opacity: fade, width: "100%" }}>
      <Image
        accessibilityIgnoresInvertColors
        accessibilityLabel={alt}
        resizeMode="cover"
        source={{ uri }}
        style={{ height: "100%", width: "100%" }}
      />
    </Animated.View>
  );
}

type VideoProps = {
  uri: string;
  alt: string;
  /** Silence the native track entirely (muted / audio-off / no native audio). */
  muted: boolean;
  /** Native-track volume in [0, 1] — ducked below 1 while the narrator speaks. */
  volume: number;
  onReady: () => void;
  onEnded: () => void;
  onFailed: () => void;
};

/**
 * Web `<video>` surface. Autoplays once the reader has pressed play (this
 * component only mounts in the `playing` state, which requires a play
 * request), carrying Omni's native synchronized audio unless the reader has
 * muted / disabled audio. The `volume` prop ducks that native track while the
 * ending-prose narrator speaks over it (applied via ref so a volume change
 * never remounts the element mid-playback). Native degrades to nothing here —
 * the poster branch above stays on screen.
 */
function CinematicVideo({ alt, muted, onEnded, onFailed, onReady, uri, volume }: VideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Apply the duck volume in place. `muted` stays on the element attribute so
  // toggling mute is declarative; volume rides the ref so the browser keeps
  // the current playhead instead of restarting.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = videoRef.current;
    if (!el) return;
    const v = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
    el.volume = v;
  }, [volume]);

  if (Platform.OS !== "web") return null;

  return (
    <video
      ref={videoRef}
      aria-label={alt}
      autoPlay
      muted={muted}
      playsInline
      controls
      onCanPlay={onReady}
      onEnded={onEnded}
      onError={(e) => {
        const target = e.currentTarget as HTMLVideoElement;
        const err = target.error;
        // eslint-disable-next-line no-console
        console.warn(
          `[CinematicMoment] video load failed: code=${err?.code} message=${err?.message ?? "unknown"} src=${uri.slice(0, 80)}`,
        );
        onFailed();
      }}
      src={uri}
      style={{ height: "100%", objectFit: "cover", width: "100%" }}
    />
  );
}

/**
 * Non-alarming "couldn't render" notice for a failed/blocked cinematic with no
 * still to fall back on (e.g. the Omni safety filter rejected the prompt). The
 * reader gets feedback instead of an empty gap; the surrounding scene/ending
 * still carries the page.
 */
function CinematicUnavailable() {
  const { tokens } = useAppTheme();
  return (
    <View
      accessibilityLabel="Cinematic unavailable for this moment"
      style={{
        alignItems: "center",
        backgroundColor: tokens.colors.surfaceMuted,
        gap: tokens.spacing.xs,
        height: "100%",
        justifyContent: "center",
        paddingHorizontal: tokens.spacing.lg,
        width: "100%",
      }}
    >
      <Text muted style={{ fontSize: 22 }}>
        🎞️
      </Text>
      <Text muted variant="bodySmall" style={{ textAlign: "center" }}>
        This moment's cinematic couldn't be rendered.
      </Text>
      <Text muted variant="caption" style={{ textAlign: "center" }}>
        The story continues below.
      </Text>
    </View>
  );
}

function CinematicSkeleton() {
  const { tokens } = useAppTheme();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: Platform.OS !== "web",
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View
      accessibilityLabel="Cinematic loading"
      accessibilityRole="progressbar"
      style={{
        alignItems: "center",
        backgroundColor: tokens.colors.surfaceMuted,
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <Animated.View style={{ opacity: pulse }}>
        <Text muted variant="bodySmall">
          Cinematic loading…
        </Text>
      </Animated.View>
    </View>
  );
}

function PlayControl({ onPress }: { onPress: () => void }) {
  const { tokens } = useAppTheme();
  return (
    <View
      pointerEvents="box-none"
      style={{
        alignItems: "center",
        bottom: 0,
        justifyContent: "center",
        left: 0,
        position: "absolute",
        right: 0,
        top: 0,
      }}
    >
      <Pressable
        accessibilityLabel="Play cinematic"
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => ({
          alignItems: "center",
          backgroundColor: tokens.colors.accent,
          borderRadius: tokens.radii.pill,
          height: 64,
          justifyContent: "center",
          opacity: pressed ? 0.8 : 0.95,
          width: 64,
        })}
      >
        <Text style={{ color: tokens.colors.background, fontSize: 24, fontWeight: "800" }}>
          ▷
        </Text>
      </Pressable>
    </View>
  );
}

function StatusPip({ label }: { label: string }) {
  const { tokens } = useAppTheme();
  return (
    <View
      style={{
        left: tokens.spacing.sm,
        position: "absolute",
        top: tokens.spacing.sm,
      }}
    >
      <View
        style={{
          backgroundColor: tokens.colors.surface,
          borderColor: tokens.colors.border,
          borderRadius: tokens.radii.pill,
          borderWidth: tokens.borderWidths.hairline,
          paddingHorizontal: tokens.spacing.sm,
          paddingVertical: tokens.spacing.xs,
        }}
      >
        <Text muted variant="caption">
          {label}
        </Text>
      </View>
    </View>
  );
}

function ControlsRow({ children }: { children: React.ReactNode }) {
  const { tokens } = useAppTheme();
  return (
    <View
      style={{
        bottom: tokens.spacing.sm,
        flexDirection: "row",
        gap: tokens.spacing.sm,
        justifyContent: "flex-end",
        position: "absolute",
        right: tokens.spacing.sm,
      }}
    >
      {children}
    </View>
  );
}

function ControlButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { tokens } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: tokens.colors.surface,
        borderColor: tokens.colors.border,
        borderRadius: tokens.radii.pill,
        borderWidth: tokens.borderWidths.hairline,
        opacity: pressed ? 0.75 : 1,
        paddingHorizontal: tokens.spacing.md,
        paddingVertical: tokens.spacing.xs,
      })}
    >
      <Text style={{ fontWeight: "800" }} variant="bodySmall">
        {label}
      </Text>
    </Pressable>
  );
}
