import { StyleProp, View, ViewStyle } from "react-native";

import { useAppTheme } from "../../theme";
import { Stamp } from "../primitives/Stamp";
import { Surface } from "../primitives/Surface";
import { Text } from "../primitives/Text";

export type ContinuityStep = {
  kicker: string;
  title: string;
  body: string;
};

// Lifted from canvas § 24F (HCE.NarratorContinuity). Each step has a kicker
// stamp + headline + supporting paragraph, designed to be read in sequence on
// the tale cover and surfaced again in settings as a refresher.
export const NARRATOR_CONTINUITY_STEPS: ReadonlyArray<ContinuityStep> = [
  {
    kicker: "1 · Pick",
    title: "One choice per tale, on the cover.",
    body: "The picker shows on the cover before the first paragraph streams. Defaults to your last-used voice. Sample auto-plays on hover; tap to lock.",
  },
  {
    kicker: "2 · Save",
    title: "Pinned to the save, not the account.",
    body: "Each save pins its own voice id. Two parallel tales keep two voices — Ash for the Bone Cathedral, Lark for the Iron Court, no spillover.",
  },
  {
    kicker: "3 · Resume",
    title: "Weeks later, the same voice waits.",
    body: "Open the book after a month and the saved voice restores before the first paragraph queues for TTS. No prompt, no re-pick.",
  },
  {
    kicker: "4 · Change",
    title: "Mid-tale swaps require a confirm.",
    body: "Settings → Narrator → pick another → confirm. Once confirmed the new voice locks for the rest of the tale and the current paragraph re-plays under their breath.",
  },
] as const;

type NarratorContinuityProps = {
  /** Optional override for the heading copy. */
  title?: string;
  /** Optional override for the supporting line under the heading. */
  subtitle?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Four-step preview surface that explains how narrator voice continuity works
 * across the lifecycle of a save. Reachable from settings or the tale cover.
 */
export function NarratorContinuity({
  style,
  subtitle = "How the narrator follows your save across sessions, devices, and re-reads.",
  title = "Narrator continuity",
}: NarratorContinuityProps) {
  const { tokens } = useAppTheme();

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
      <View style={{ gap: tokens.spacing.xs }}>
        <Stamp>Continuity</Stamp>
        <Text variant="title">{title}</Text>
        <Text muted variant="bodySmall">
          {subtitle}
        </Text>
      </View>

      <View style={{ gap: tokens.spacing.md }}>
        {NARRATOR_CONTINUITY_STEPS.map((step) => (
          <View
            key={step.kicker}
            style={{
              borderColor: tokens.colors.borderMuted,
              borderLeftWidth: tokens.borderWidths.heavy,
              borderStyle: "solid",
              gap: tokens.spacing.xs,
              paddingLeft: tokens.spacing.md,
            }}
          >
            <Text
              style={{
                color: tokens.colors.accent,
                fontFamily: tokens.typography.families.mono,
                fontWeight: "700",
                letterSpacing: 0.5,
                textTransform: "uppercase",
              }}
              variant="caption"
            >
              {step.kicker}
            </Text>
            <Text variant="subtitle">{step.title}</Text>
            <Text muted variant="bodySmall">
              {step.body}
            </Text>
          </View>
        ))}
      </View>
    </Surface>
  );
}
