import { useState } from "react";
import { Pressable, View } from "react-native";

import { Button, Stamp, Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";
import type { AgeSelection } from "../../hooks/useGuestSession";
import { useUnder13Block } from "../../hooks/useMatureOptIn";
import { Under13Block } from "./Under13Block";

type AgeGateProps = {
  /** When true, render the permanent under-13 block instead of the picker. */
  blocked?: boolean;
  blockedMessage?: string | null | undefined;
  disabled?: boolean;
  /**
   * Invoked when the user picks under-13. The host should call its useUnder13Block
   * setter so the block persists.
   */
  onUnder13?: () => void;
  onSubmit: (selection: AgeSelection) => void;
};

const AGE_OPTIONS: Array<{ label: string; value: AgeSelection; helper: string }> = [
  { label: "Under 13", value: "under_13", helper: "Cannot create a guest save." },
  { label: "13 to 17", value: "13-17", helper: "General-audience stories only." },
  { label: "18 or older", value: "18+", helper: "Mature controls available, off by default." },
];

export function AgeGate({
  blocked = false,
  blockedMessage,
  disabled = false,
  onSubmit,
  onUnder13,
}: AgeGateProps) {
  const { tokens } = useAppTheme();
  const { blocked: persistedUnder13, setUnder13Block } = useUnder13Block();
  const [selection, setSelection] = useState<AgeSelection | null>(null);

  if (blocked || persistedUnder13) {
    return <Under13Block />;
  }

  const handleSubmit = () => {
    if (!selection) return;
    if (selection === "under_13") {
      setUnder13Block();
      onUnder13?.();
      onSubmit(selection);
      return;
    }
    onSubmit(selection);
  };

  return (
    <Surface padded style={{ gap: tokens.spacing.md, maxWidth: 520, width: "100%" }}>
      <View style={{ gap: tokens.spacing.xs }}>
        <Stamp>Before the book opens</Stamp>
        <Text variant="title">Choose your age range.</Text>
        <Text muted variant="bodySmall">
          Select one option to continue. We only save the range, never a birthday.
        </Text>
      </View>

      <View accessibilityRole="radiogroup" style={{ gap: tokens.spacing.sm }}>
        {AGE_OPTIONS.map((option) => {
          const selected = selection === option.value;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled }}
              disabled={disabled}
              key={option.value}
              onPress={() => setSelection(option.value)}
              style={{
                alignItems: "center",
                backgroundColor: selected ? tokens.colors.surfaceMuted : tokens.colors.surface,
                borderColor: selected ? tokens.colors.border : tokens.colors.borderMuted,
                borderRadius: tokens.radii.sm,
                borderWidth: tokens.borderWidths.regular,
                flexDirection: "row",
                gap: tokens.spacing.sm,
                minHeight: 66,
                padding: tokens.spacing.md,
              }}
            >
              <View
                style={{
                  backgroundColor: selected ? tokens.colors.text : "transparent",
                  borderColor: tokens.colors.border,
                  borderRadius: 9,
                  borderWidth: tokens.borderWidths.regular,
                  height: 18,
                  width: 18,
                }}
              />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ fontWeight: "700" }}>{option.label}</Text>
                <Text muted variant="caption">
                  {option.helper}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {blockedMessage ? (
        <View
          style={{
            backgroundColor: tokens.colors.accentMuted,
            borderColor: tokens.colors.danger,
            borderRadius: tokens.radii.sm,
            borderWidth: tokens.borderWidths.hairline,
            padding: tokens.spacing.md,
          }}
        >
          <Text style={{ color: tokens.colors.danger }} variant="bodySmall">
            {blockedMessage}
          </Text>
        </View>
      ) : null}

      <Button
        accessibilityLabel="Continue"
        disabled={disabled || selection === null}
        onPress={handleSubmit}
        variant="primary"
      >
        Continue
      </Button>
    </Surface>
  );
}
