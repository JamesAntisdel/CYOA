import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleProp, View, ViewStyle } from "react-native";

import {
  NARRATOR_VOICES,
  type NarratorVoice,
  type UseNarratorVoiceResult,
} from "../../hooks/useNarratorVoice";
import { useAppTheme } from "../../theme";
import { Button } from "../primitives/Button";
import { Stamp } from "../primitives/Stamp";
import { Surface } from "../primitives/Surface";
import { Text } from "../primitives/Text";

type VoicePickerProps = {
  /** Controlled hook result from {@link useNarratorVoice}. */
  controller: UseNarratorVoiceResult;
  /** Heading copy. Defaults to the tale-cover wording. */
  title?: string;
  /** Optional subtitle / context line. */
  subtitle?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Narrator voice picker — used on the tale cover before the first paragraph
 * streams, and reachable from settings for mid-tale changes.
 *
 * Behavior:
 *  - Defaults to the last-used voice (per-account, via localStorage seed).
 *  - Sample auto-plays on hover (web). On native, hover is a no-op and users
 *    tap to preview by selecting the card.
 *  - Tap locks the choice for the active save. If the save already has a
 *    pinned voice, the controller stages a {@link UseNarratorVoiceResult.pendingChange}
 *    which must be confirmed explicitly via {@link ConfirmDialog}.
 */
export function VoicePicker({
  controller,
  style,
  subtitle = "Sample auto-plays on hover. Tap a voice to lock it for this tale.",
  title = "Choose your narrator",
}: VoicePickerProps) {
  const { tokens } = useAppTheme();
  const [hoverVoiceId, setHoverVoiceId] = useState<string | null>(null);
  const playerRef = useRef<{ stop: () => void } | null>(null);

  const stopSample = useCallback(() => {
    playerRef.current?.stop();
    playerRef.current = null;
  }, []);

  const playSample = useCallback(
    (voice: NarratorVoice) => {
      stopSample();
      if (!voice.sampleUri) return;
      if (Platform.OS !== "web") return;
      // Use the web Audio constructor (same pattern as AmbientSoundscape).
      const AudioCtor = (globalThis as { Audio?: typeof Audio }).Audio;
      if (!AudioCtor) return;
      try {
        const audio = new AudioCtor(voice.sampleUri);
        audio.volume = 0.85;
        void audio.play().catch(() => undefined);
        playerRef.current = {
          stop: () => {
            audio.pause();
            audio.src = "";
          },
        };
      } catch {
        // ignore — sample is best-effort
      }
    },
    [stopSample],
  );

  useEffect(() => () => stopSample(), [stopSample]);

  const handleHoverIn = (voice: NarratorVoice) => {
    setHoverVoiceId(voice.id);
    playSample(voice);
  };
  const handleHoverOut = (voice: NarratorVoice) => {
    setHoverVoiceId((current) => (current === voice.id ? null : current));
    stopSample();
  };

  return (
    <Surface
      padded
      style={[
        {
          gap: tokens.spacing.lg,
        },
        style,
      ]}
    >
      <View style={{ gap: tokens.spacing.sm }}>
        <Stamp>{controller.status === "pinned" ? "Change narrator" : "Pick narrator"}</Stamp>
        <Text variant="title">{title}</Text>
        <Text muted variant="bodySmall">
          {subtitle}
        </Text>
      </View>

      <View
        accessibilityRole="radiogroup"
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: tokens.spacing.md,
        }}
      >
        {NARRATOR_VOICES.map((voice) => {
          const isSelected = controller.voiceId === voice.id;
          const isHovered = hoverVoiceId === voice.id;
          return (
            <Pressable
              accessibilityLabel={`${voice.name} — ${voice.kicker}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              key={voice.id}
              onHoverIn={() => handleHoverIn(voice)}
              onHoverOut={() => handleHoverOut(voice)}
              onPress={() => controller.pickVoice(voice.id)}
              style={({ pressed }) => [
                {
                  backgroundColor: isSelected ? tokens.colors.accentMuted : tokens.colors.surface,
                  borderColor: isSelected || isHovered ? tokens.colors.accent : tokens.colors.border,
                  borderRadius: tokens.radii.sm,
                  borderWidth: tokens.borderWidths.regular,
                  flexBasis: 220,
                  flexGrow: 1,
                  gap: tokens.spacing.xs,
                  minHeight: 100,
                  opacity: pressed ? 0.82 : 1,
                  padding: tokens.spacing.md,
                } satisfies ViewStyle,
              ]}
            >
              <View
                style={{
                  alignItems: "center",
                  flexDirection: "row",
                  gap: tokens.spacing.sm,
                  justifyContent: "space-between",
                }}
              >
                <Text variant="subtitle">{voice.name}</Text>
                {isSelected ? <Stamp>Locked</Stamp> : null}
              </View>
              <Text muted variant="caption">
                {voice.kicker}
              </Text>
              <Text variant="bodySmall">{voice.blurb}</Text>
            </Pressable>
          );
        })}
      </View>

      {controller.pendingChange ? (
        <ConfirmDialog
          fromVoice={voiceById(controller.pendingChange.fromVoiceId)}
          toVoice={voiceById(controller.pendingChange.targetVoiceId)}
          onCancel={controller.cancelChange}
          onConfirm={controller.confirmChange}
        />
      ) : null}
    </Surface>
  );
}

function voiceById(id: string): NarratorVoice {
  return NARRATOR_VOICES.find((v) => v.id === id) ?? NARRATOR_VOICES[0]!;
}

type ConfirmDialogProps = {
  fromVoice: NarratorVoice;
  toVoice: NarratorVoice;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Mid-tale change confirmation. The new voice locks for the rest of the tale
 * and the current paragraph re-plays in the new voice (re-play wiring is the
 * reader's responsibility — this surface only emits the confirm intent).
 */
export function ConfirmDialog({ fromVoice, onCancel, onConfirm, toVoice }: ConfirmDialogProps) {
  const { tokens } = useAppTheme();

  return (
    <Surface
      accessibilityRole="alert"
      padded
      style={{
        backgroundColor: tokens.colors.surfaceMuted,
        gap: tokens.spacing.md,
      }}
      variant="muted"
    >
      <Stamp>Confirm</Stamp>
      <Text variant="subtitle">Switch narrator mid-tale?</Text>
      <Text muted variant="bodySmall">
        {fromVoice.name} hands the page to {toVoice.name}. The new voice locks for the rest of this
        tale and the current paragraph re-plays under their breath.
      </Text>
      <View
        style={{
          flexDirection: "row",
          gap: tokens.spacing.sm,
        }}
      >
        <Button onPress={onCancel} variant="ghost">
          Keep {fromVoice.name}
        </Button>
        <Button onPress={onConfirm} variant="primary">
          Switch to {toVoice.name}
        </Button>
      </View>
    </Surface>
  );
}
