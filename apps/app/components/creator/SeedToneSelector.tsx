import { Pressable, View, type ViewStyle } from "react-native";

import { Text } from "../primitives";
import { useAppTheme } from "../../theme";
import { useBreakpoint } from "../../lib/responsive";

export type SeedTone =
  | "gothic-mystery"
  | "political-intrigue"
  | "survival"
  | "wonder"
  | "noir"
  | "folk-myth"
  | "sci-fi"
  | "thriller"
  | "adventure"
  | "comedy";

export type SeedToneOption = {
  id: SeedTone;
  label: string;
  description: string;
};

const TONES: SeedToneOption[] = [
  { id: "gothic-mystery", label: "Gothic mystery", description: "Quiet dread, relics, vows." },
  { id: "political-intrigue", label: "Political intrigue", description: "Masks, favors, locked rooms." },
  { id: "survival", label: "Survival", description: "Scarcity, weather, trust." },
  { id: "wonder", label: "Wonder", description: "Strange light, kind strangers." },
  { id: "noir", label: "Noir", description: "Smoke, debts, hard choices." },
  { id: "folk-myth", label: "Folk myth", description: "Old roads, older promises." },
  { id: "sci-fi", label: "Sci-fi", description: "Speculative tech, distant futures, alien worlds." },
  { id: "thriller", label: "Thriller", description: "Modern peril, fast pacing, mounting stakes." },
  { id: "adventure", label: "Adventure", description: "Bold exploration, set-piece challenges, momentum." },
  { id: "comedy", label: "Comedy", description: "Light tone, character voice, unexpected wins." },
];

export type SeedToneSelectorProps = {
  value: SeedTone | null;
  onChange: (tone: SeedTone) => void;
};

export function SeedToneSelector({ onChange, value }: SeedToneSelectorProps) {
  const { tokens } = useAppTheme();
  // Phone: pills stack one-per-row so each label + helper description can
  // breathe. On 375px viewport the 160px minWidth + 47% flexBasis used to
  // squeeze two cramped pills per row; full-width reads cleaner.
  const { isPhone } = useBreakpoint();

  return (
    <View
      accessibilityRole="radiogroup"
      style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}
    >
      {TONES.map((tone) => {
        const selected = tone.id === value;
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            key={tone.id}
            onPress={() => onChange(tone.id)}
            style={({ pressed }) => [
              {
                backgroundColor: selected ? tokens.colors.accentMuted : tokens.colors.surface,
                borderColor: selected ? tokens.colors.accent : tokens.colors.border,
                borderRadius: tokens.radii.sm,
                borderWidth: tokens.borderWidths.regular,
                flexBasis: isPhone ? "100%" : "47%",
                flexGrow: 1,
                gap: tokens.spacing.xs,
                minHeight: 60,
                minWidth: isPhone ? undefined : 160,
                opacity: pressed ? 0.85 : 1,
                padding: tokens.spacing.md,
              } satisfies ViewStyle,
            ]}
          >
            <Text style={{ fontWeight: "700" }}>{tone.label}</Text>
            <Text muted variant="caption">
              {tone.description}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const SEED_TONES = TONES;
