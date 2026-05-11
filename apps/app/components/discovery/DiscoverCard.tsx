import { Pressable, View } from "react-native";

import { useAppTheme } from "../../theme";
import { Chip, Stamp, Surface, Text } from "../primitives";

export type DiscoverTone = "calm" | "tense" | "wry" | "lyrical" | "grim";
export type DiscoverLength = "short" | "medium" | "long";
export type DiscoverTier = "free" | "unlimited" | "pro";

export type DiscoverTale = {
  taleId: string;
  title: string;
  synopsis: string;
  tone: DiscoverTone;
  length: DiscoverLength;
  tier: DiscoverTier;
  /** Number of distinct accounts that have completed a run. May be 0 or undefined when not tracked. */
  completionCount?: number;
  /** Whether the tale contains mature flags. Renders a "mature" stamp. */
  isMature?: boolean;
};

type DiscoverCardProps = {
  tale: DiscoverTale;
  onOpen: (taleId: string) => void;
  onShare?: (taleId: string) => void;
};

function lengthLabel(length: DiscoverLength): string {
  switch (length) {
    case "short":
      return "a single sitting";
    case "medium":
      return "an evening";
    case "long":
      return "many evenings";
  }
}

function tierLabel(tier: DiscoverTier): string {
  switch (tier) {
    case "free":
      return "open shelf";
    case "unlimited":
      return "unlimited";
    case "pro":
      return "pro";
  }
}

/**
 * A single archived tale card on the discover shelf. Renders title, synopsis,
 * tone/length/tier/completion-count chips, and a quiet share affordance.
 */
export function DiscoverCard({ onOpen, onShare, tale }: DiscoverCardProps) {
  const { tokens } = useAppTheme();
  const showCompletions = typeof tale.completionCount === "number" && tale.completionCount > 0;

  return (
    <Surface
      style={{
        gap: tokens.spacing.md,
        padding: tokens.spacing.lg,
      }}
    >
      <Pressable
        accessibilityHint="Open this tale"
        accessibilityLabel={`Open ${tale.title}`}
        accessibilityRole="button"
        onPress={() => onOpen(tale.taleId)}
        style={{ gap: tokens.spacing.sm }}
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
          <Stamp>{tierLabel(tale.tier)}</Stamp>
          {tale.isMature ? <Stamp>mature</Stamp> : null}
        </View>
        <Text variant="subtitle">{tale.title}</Text>
        <Text muted variant="bodySmall">
          {tale.synopsis}
        </Text>
      </Pressable>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
        <Chip>{tale.tone}</Chip>
        <Chip>{lengthLabel(tale.length)}</Chip>
        {showCompletions ? (
          <Chip>{`${tale.completionCount ?? 0} have finished`}</Chip>
        ) : (
          <Chip>fresh on the shelf</Chip>
        )}
      </View>

      {onShare ? (
        <Pressable
          accessibilityHint="Share this tale"
          accessibilityLabel={`Share ${tale.title}`}
          accessibilityRole="button"
          onPress={() => onShare(tale.taleId)}
          style={{
            alignSelf: "flex-start",
            paddingVertical: tokens.spacing.xs,
          }}
        >
          <Text style={{ color: tokens.colors.accent, fontWeight: "700" }} variant="bodySmall">
            Share this tale
          </Text>
        </Pressable>
      ) : null}
    </Surface>
  );
}
