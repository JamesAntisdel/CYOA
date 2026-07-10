import { TextInput, View } from "react-native";

import { Note, Text } from "../primitives";
import { useAppTheme } from "../../theme";

export type SeedPremiseInputProps = {
  value: string;
  onChange: (value: string) => void;
  warning?: string | null;
  /** Optional starter-tale preset to suggest with a one-tap prefill. */
  presets?: Array<{ id: string; label: string; premise: string }>;
  onUsePreset?: (premise: string) => void;
};

export function SeedPremiseInput({
  onChange,
  onUsePreset,
  presets,
  value,
  warning,
}: SeedPremiseInputProps) {
  const { tokens } = useAppTheme();

  return (
    <View style={{ gap: tokens.spacing.sm }}>
      <Text variant="subtitle">Premise</Text>
      <TextInput
        accessibilityLabel="Adventure premise"
        multiline
        onChangeText={onChange}
        placeholder="A lamp-lighter wakes inside a cathedral that has no door..."
        placeholderTextColor={tokens.colors.textFaint}
        style={{
          borderColor: tokens.colors.borderMuted,
          borderRadius: tokens.radii.sm,
          borderWidth: tokens.borderWidths.regular,
          color: tokens.colors.text,
          fontFamily: tokens.typography.families.body,
          fontSize: tokens.typography.body,
          minHeight: 140,
          padding: tokens.spacing.md,
          textAlignVertical: "top",
        }}
        value={value}
      />
      {presets && presets.length > 0 ? (
        <View style={{ gap: tokens.spacing.xs }}>
          <Text muted variant="caption">
            Starter presets
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.xs }}>
            {presets.map((preset) => (
              <Text
                accessibilityRole="button"
                key={preset.id}
                onPress={() => onUsePreset?.(preset.premise)}
                style={{
                  borderColor: tokens.colors.borderMuted,
                  borderRadius: tokens.radii.pill,
                  borderWidth: tokens.borderWidths.regular,
                  color: tokens.colors.text,
                  fontWeight: "700",
                  paddingHorizontal: tokens.spacing.md,
                  paddingVertical: tokens.spacing.xs,
                }}
                variant="caption"
              >
                {preset.label}
              </Text>
            ))}
          </View>
        </View>
      ) : null}
      {warning ? <Note>{warning}</Note> : null}
    </View>
  );
}
