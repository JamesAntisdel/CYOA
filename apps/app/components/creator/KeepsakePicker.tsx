import { Pressable, View } from "react-native";

import type { RemoteKeepsake } from "../../lib/gameApi";
import {
  adaptKeepsakes,
  hasKeepsakes,
  KEEPSAKE_BADGE,
  selectedKeepsake,
  toggleKeepsakeSelection,
} from "../../lib/storyEngagementW3";
import { useAppTheme } from "../../theme";
import { Note, Stamp, Surface, Text } from "../primitives";

type KeepsakePickerProps = {
  /** The account's owned keepsakes (widened profile projection). */
  keepsakes: RemoteKeepsake[] | null | undefined;
  /** The currently carried keepsake id, or undefined for "carry nothing". */
  selectedId: string | undefined;
  /** Single-select (≤1) change handler — receives the next id or undefined. */
  onChange: (id: string | undefined) => void;
};

/**
 * KeepsakePicker (design §4.3, R12.2) — in the new-story flow, a single-select
 * (≤1) chip picker over the keepsakes the account has earned from past
 * endings. The chosen `keepsakeId` flows into `createSave` and is woven into
 * the opening as an inventory item. ABSENT entirely when the account owns no
 * keepsakes (nothing to carry yet).
 */
export function KeepsakePicker({ keepsakes, selectedId, onChange }: KeepsakePickerProps) {
  const { tokens } = useAppTheme();
  const owned = adaptKeepsakes(keepsakes);

  // Absent when the account owns none (R12.2 — nothing to offer).
  if (!hasKeepsakes(owned)) return null;

  const carried = selectedKeepsake(owned, selectedId);

  return (
    <Surface accessibilityLabel="Carry a keepsake" padded style={{ gap: tokens.spacing.md }} variant="muted">
      <View style={{ gap: tokens.spacing.xs }}>
        <Stamp>keepsake</Stamp>
        <Text variant="subtitle">Carry a keepsake?</Text>
        <Text muted variant="bodySmall">
          One echo of another life. It rides in your pack and may open a door.
        </Text>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
        {owned.map((keepsake) => {
          const active = keepsake.id === selectedId;
          return (
            <Pressable
              accessibilityLabel={`Keepsake: ${keepsake.label}. ${keepsake.description}`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              key={keepsake.id}
              onPress={() => onChange(toggleKeepsakeSelection(selectedId, keepsake.id))}
              style={({ pressed }) => ({
                backgroundColor: active ? tokens.colors.accentMuted : tokens.colors.surface,
                borderColor: active ? tokens.colors.accent : tokens.colors.border,
                borderRadius: tokens.radii.pill,
                borderWidth: tokens.borderWidths.regular,
                opacity: pressed ? 0.8 : 1,
                paddingHorizontal: tokens.spacing.md,
                paddingVertical: tokens.spacing.sm,
              })}
            >
              <Text
                style={{ fontWeight: active ? "700" : "400" }}
                tone={active ? "accent" : "default"}
                variant="bodySmall"
              >
                {`${active ? "❖ " : ""}${keepsake.label}`}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {carried ? (
        <Note>{`Carrying ${carried.label} — ${carried.description}`}</Note>
      ) : (
        <Text muted variant="caption">
          Tap a keepsake to carry it, or leave your pack empty.
        </Text>
      )}
    </Surface>
  );
}

/**
 * KeepsakeBadge (R12.2) — the small marker appended to a keepsake-tagged item
 * in the inventory list so the reader recognizes the echo they carried in.
 */
export function KeepsakeBadge() {
  const { tokens } = useAppTheme();
  return (
    <Text
      accessibilityLabel="Keepsake"
      style={{ color: tokens.colors.accent, fontFamily: tokens.typography.families.mono }}
      variant="caption"
    >
      {`  ${KEEPSAKE_BADGE}`}
    </Text>
  );
}
