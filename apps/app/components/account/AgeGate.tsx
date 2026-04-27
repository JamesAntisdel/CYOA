import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { AgeSelection } from "../../hooks/useGuestSession";

type AgeGateProps = {
  blockedMessage?: string | null;
  disabled?: boolean;
  onSubmit: (selection: AgeSelection) => void;
};

const AGE_OPTIONS: Array<{ label: string; value: AgeSelection; helper: string }> = [
  { label: "Under 13", value: "under_13", helper: "Cannot create a guest save." },
  { label: "13 to 17", value: "13-17", helper: "General-audience stories only." },
  { label: "18 or older", value: "18+", helper: "General-audience stories first." },
];

export function AgeGate({ blockedMessage, disabled = false, onSubmit }: AgeGateProps) {
  const [selection, setSelection] = useState<AgeSelection | null>(null);

  return (
    <View style={styles.panel}>
      <Text style={styles.eyebrow}>Before the book opens</Text>
      <Text style={styles.title}>Choose your age range.</Text>
      <Text style={styles.copy}>
        Select one option to continue. We only save the range, never a birthday.
      </Text>

      <View style={styles.optionList} accessibilityRole="radiogroup">
        {AGE_OPTIONS.map((option) => {
          const selected = selection === option.value;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled }}
              key={option.value}
              onPress={() => setSelection(option.value)}
              style={[styles.option, selected && styles.optionSelected]}
              disabled={disabled}
            >
              <View style={[styles.radio, selected && styles.radioSelected]} />
              <View style={styles.optionText}>
                <Text style={styles.optionLabel}>{option.label}</Text>
                <Text style={styles.optionHelper}>{option.helper}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {blockedMessage ? <Text style={styles.blocked}>{blockedMessage}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || selection === null }}
        disabled={disabled || selection === null}
        onPress={() => {
          if (selection) onSubmit(selection);
        }}
        style={[styles.primaryButton, (disabled || selection === null) && styles.buttonDisabled]}
      >
        <Text style={styles.primaryButtonText}>Continue</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: "100%",
    maxWidth: 520,
    borderColor: "#7b5a35",
    borderWidth: 1,
    backgroundColor: "#fff8ea",
    padding: 20,
    gap: 14,
  },
  eyebrow: {
    color: "#7b5a35",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  title: {
    color: "#24180f",
    fontSize: 28,
    fontWeight: "700",
  },
  copy: {
    color: "#594635",
    fontSize: 15,
    lineHeight: 21,
  },
  optionList: {
    gap: 10,
  },
  option: {
    alignItems: "center",
    borderColor: "#d5b98f",
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 66,
    padding: 12,
  },
  optionSelected: {
    backgroundColor: "#f1dfbc",
    borderColor: "#7b5a35",
  },
  radio: {
    borderColor: "#7b5a35",
    borderRadius: 9,
    borderWidth: 1,
    height: 18,
    width: 18,
  },
  radioSelected: {
    backgroundColor: "#7b5a35",
  },
  optionText: {
    flex: 1,
    gap: 3,
  },
  optionLabel: {
    color: "#24180f",
    fontSize: 16,
    fontWeight: "700",
  },
  optionHelper: {
    color: "#6e5a45",
    fontSize: 13,
  },
  blocked: {
    backgroundColor: "#f7d8d0",
    color: "#6d2017",
    fontSize: 14,
    lineHeight: 20,
    padding: 12,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#2d1d12",
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  primaryButtonText: {
    color: "#fff8ea",
    fontSize: 16,
    fontWeight: "700",
  },
});
