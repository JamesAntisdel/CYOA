import { View } from "react-native";

import { useMediaPlate, type MediaPlateState, type SceneMedia } from "../../hooks/useMediaPlate";
import { Icon, Note, Stamp, Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";
import { MediaPlateImage } from "./MediaPlate.image";
import { MediaPlateSkeleton } from "./MediaPlate.skeleton";

export type MediaPlateProps = {
  media: SceneMedia | undefined;
  reducedMotion: boolean;
};

/**
 * Illustrated Book guaranteed-still signal (reading-modes R3.4, RM8). The
 * server (`queueSceneImage` mode-scoped fallback) emits `outOfCredits` on the
 * scene-media projection ONLY for the `illustrated_book` strategy — every
 * other reader keeps the byte-identical delete-and-skeleton path and never
 * carries this field. Reacting to it here is therefore mode-scoped by
 * construction. Read defensively (widened) until the projection type carries
 * it end-to-end (reported to the integrator / RM-MEDIA).
 */
type MediaWithOutOfCreditsSignal = SceneMedia & { outOfCredits?: boolean };

export type MediaPlateView = "idle" | "skeleton" | "image" | "placeholder";

/**
 * Pure plate-view decision. Exposed for unit tests; the component is a thin
 * view over this. Mirrors the reducer-plus-view split already used by
 * `reduceMediaPlate` so the Illustrated Book fallback is testable without a
 * React-Native render harness.
 *
 * The `outOfCredits` branch is the load-bearing R3.4/R3.6 rule: when the
 * server signals credit exhaustion for the guaranteed-still mode the plate
 * degrades to a stylized PLACEHOLDER — NEVER a bare skeleton and NEVER a
 * blocked turn. A real image still wins if one ever lands (image beats the
 * signal), and the signal is only ever present in `illustrated_book` mode, so
 * every other reader is untouched.
 */
export function resolveMediaPlateView(input: {
  state: MediaPlateState;
  outOfCredits: boolean;
  hasPoster: boolean;
}): MediaPlateView {
  // A ready still always wins — even in the guaranteed-still mode, if the
  // image landed we show it.
  if (input.state === "image" && input.hasPoster) return "image";
  // Guaranteed-still fallback: never hold at a bare skeleton in this mode.
  if (input.outOfCredits) return "placeholder";
  // Image state without a usable poster degrades to the skeleton frame
  // (unchanged legacy behavior for every non-illustrated reader).
  if (input.state === "image") return "skeleton";
  return input.state; // idle | skeleton
}

/**
 * MediaPlate dispatcher — task 28 (revised) + reading-modes R3.4.
 *
 * The image plate above the prose is the anchor: it never swaps to the video.
 * States:
 *
 *   1. idle        No visible plate (audio-only ride-along).
 *   2. skeleton    Paper frame + candle ornament while Imagen is queued.
 *   3. image       Imagen plate ready; prose stays primary.
 *   4. placeholder Illustrated Book only — credit-exhausted / gen-failed
 *                  guaranteed-still degrades to a stylized frame + a soft
 *                  "top up" nudge instead of a bare skeleton (R3.4/R3.6).
 *
 * Reduced-motion still falls through here — the lower SceneCinematic slot
 * enforces it for the video lifecycle.
 */
export function MediaPlate({ media, reducedMotion }: MediaPlateProps) {
  const plate = useMediaPlate({ media });
  const outOfCredits = (media as MediaWithOutOfCreditsSignal | undefined)?.outOfCredits === true;
  const hasPoster = Boolean(plate.posterUri && plate.posterUri.length > 0);
  const view = resolveMediaPlateView({ state: plate.state, outOfCredits, hasPoster });

  if (view === "idle") return null;

  if (view === "placeholder") {
    return <MediaPlatePlaceholder alt={plate.media?.alt} />;
  }

  if (view === "skeleton") {
    return (
      <MediaPlateSkeleton
        alt={plate.media?.alt}
        failed={plate.imageUnavailable}
        label={plate.label}
      />
    );
  }

  // view === "image". `resolveMediaPlateView` only returns "image" when a
  // poster is present, but keep the defensive fallback — an empty
  // <Image source={{uri:""}}> trips the browser's "Invalid URI" on web.
  if (!plate.posterUri || plate.posterUri.length === 0) {
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

type MediaPlatePlaceholderProps = {
  alt?: string | undefined;
};

/**
 * Illustrated Book credit-exhaustion placeholder (R3.4/R3.5). A STYLIZED
 * frame — not a bare skeleton — that keeps the illustrated page composed while
 * the reader is out of illustration credits, plus a soft top-up nudge. It is
 * never metered and never gates the turn: prose stays fully readable beneath
 * it and the reader can always choose (R3.6).
 */
export function MediaPlatePlaceholder({ alt }: MediaPlatePlaceholderProps) {
  const { tokens } = useAppTheme();
  const label = "This page is unillustrated for now.";

  return (
    <Surface
      accessibilityLabel={alt ?? label}
      accessibilityRole="image"
      padded
      style={{
        alignItems: "center",
        gap: tokens.spacing.sm,
        justifyContent: "center",
        minHeight: 220,
        backgroundColor: tokens.colors.surfaceMuted,
      }}
      variant="muted"
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{
          alignItems: "center",
          flexDirection: "row",
          gap: tokens.spacing.sm,
          justifyContent: "center",
        }}
      >
        <Icon color={tokens.colors.accent} name="candle" size={20} />
        <View
          style={{
            backgroundColor: tokens.colors.accent,
            height: tokens.borderWidths.regular,
            opacity: 0.6,
            width: 64,
          }}
        />
        <Icon color={tokens.colors.accent} name="candle" size={20} />
      </View>
      <Stamp accessibilityLabel="Out of illustration credits">TOP UP</Stamp>
      <Note style={{ textAlign: "center" }}>{label}</Note>
      <Text muted style={{ textAlign: "center" }} variant="caption">
        Out of illustration credits — top up to keep every scene illustrated.
        The story continues either way.
      </Text>
    </Surface>
  );
}
