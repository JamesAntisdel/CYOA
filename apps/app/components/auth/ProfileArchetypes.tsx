import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import type { ArchetypeTag } from "../../hooks/useAccountProfile";
import { useAppTheme } from "../../theme";
import { Button, Stamp, Surface, Text } from "../primitives";

type ProfileArchetypesProps = {
  archetypes: ArchetypeTag[];
  onToggleMute: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onRemove: (id: string) => void;
  onReset?: () => void;
};

export function ProfileArchetypes({
  archetypes,
  onToggleMute,
  onRename,
  onRemove,
  onReset,
}: ProfileArchetypesProps) {
  const { tokens } = useAppTheme();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");

  const beginEdit = (tag: ArchetypeTag) => {
    setEditingId(tag.id);
    setDraftLabel(tag.label);
  };

  const commitEdit = () => {
    if (!editingId) return;
    onRename(editingId, draftLabel);
    setEditingId(null);
    setDraftLabel("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftLabel("");
  };

  return (
    <Surface padded style={{ gap: tokens.spacing.lg, maxWidth: 640, width: "100%" }}>
      <View style={{ gap: tokens.spacing.xs }}>
        <Stamp>Profile</Stamp>
        <Text variant="title">Reader archetypes.</Text>
        <Text muted variant="bodySmall">
          The narrator notices patterns in your choices and turns them into archetype tags. Mute or rename
          any tag — we never display raw prose history.
        </Text>
      </View>

      {archetypes.length === 0 ? (
        <Text muted>
          No archetypes recorded yet. Keep reading; the narrator will notice your patterns.
        </Text>
      ) : (
        <View style={{ gap: tokens.spacing.sm }}>
          {archetypes.map((tag) => {
            const isEditing = editingId === tag.id;
            return (
              <View
                key={tag.id}
                style={{
                  alignItems: "center",
                  borderColor: tokens.colors.borderMuted,
                  borderRadius: tokens.radii.sm,
                  borderWidth: tokens.borderWidths.hairline,
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: tokens.spacing.sm,
                  paddingHorizontal: tokens.spacing.md,
                  paddingVertical: tokens.spacing.sm,
                }}
              >
                {isEditing ? (
                  <TextInput
                    accessibilityLabel={`Rename archetype ${tag.label}`}
                    autoFocus
                    onChangeText={setDraftLabel}
                    onSubmitEditing={commitEdit}
                    placeholder="Archetype name"
                    placeholderTextColor={tokens.colors.textFaint}
                    style={{
                      backgroundColor: tokens.colors.background,
                      borderColor: tokens.colors.border,
                      borderRadius: tokens.radii.xs,
                      borderWidth: tokens.borderWidths.hairline,
                      color: tokens.colors.text,
                      flex: 1,
                      fontSize: tokens.typography.body,
                      minHeight: 36,
                      minWidth: 160,
                      paddingHorizontal: tokens.spacing.sm,
                    }}
                    value={draftLabel}
                  />
                ) : (
                  <Pressable
                    accessibilityLabel={`Archetype ${tag.label}${tag.muted ? ", muted" : ""}`}
                    accessibilityRole="button"
                    onPress={() => onToggleMute(tag.id)}
                    style={{
                      alignSelf: "flex-start",
                      backgroundColor: tokens.colors.surface,
                      borderColor: tokens.colors.border,
                      borderRadius: tokens.radii.pill,
                      borderWidth: tokens.borderWidths.regular,
                      flex: 1,
                      minHeight: 28,
                      minWidth: 160,
                      paddingHorizontal: tokens.spacing.sm,
                      paddingVertical: tokens.spacing.xs,
                    }}
                  >
                    <Text
                      variant="caption"
                      style={{
                        color: tag.muted ? tokens.colors.textMuted : tokens.colors.text,
                        textDecorationLine: tag.muted ? "line-through" : "none",
                      }}
                    >
                      {tag.label}
                    </Text>
                  </Pressable>
                )}

                <View style={{ flexDirection: "row", gap: tokens.spacing.xs }}>
                  {isEditing ? (
                    <>
                      <Button accessibilityLabel="Save name" onPress={commitEdit} variant="primary">
                        Save
                      </Button>
                      <Button accessibilityLabel="Cancel rename" onPress={cancelEdit}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        accessibilityLabel={tag.muted ? `Unmute ${tag.label}` : `Mute ${tag.label}`}
                        onPress={() => onToggleMute(tag.id)}
                      >
                        {tag.muted ? "Unmute" : "Mute"}
                      </Button>
                      <Button accessibilityLabel={`Rename ${tag.label}`} onPress={() => beginEdit(tag)}>
                        Rename
                      </Button>
                      <Button accessibilityLabel={`Remove ${tag.label}`} onPress={() => onRemove(tag.id)}>
                        Remove
                      </Button>
                    </>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {onReset ? (
        <Button accessibilityLabel="Reset archetypes" onPress={onReset}>
          Reset archetypes
        </Button>
      ) : null}
    </Surface>
  );
}
