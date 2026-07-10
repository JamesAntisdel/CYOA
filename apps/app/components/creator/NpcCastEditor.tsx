import { useCallback } from "react";
import { Pressable, TextInput, View, type ViewStyle } from "react-native";

import type { NpcRole } from "@cyoa/engine";

import { roleToneColors, ROLE_LABEL } from "../stats/NpcRoster.helpers";
import { Button, Divider, Note, Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";

/**
 * Reader-authored cast member captured during the Seed-an-Adventure flow.
 * Mirrors the subset of `NpcState` the backend needs to seed `initialNpcs`
 * — the engine fills in disposition/attributes/knownFacts/flags defaults
 * server-side. Description doubles as the prompt + portrait brief.
 */
export type SeedNpcDraft = {
  name: string;
  role: NpcRole;
  description: string;
};

export type NpcCastEditorProps = {
  value: SeedNpcDraft[];
  onChange: (next: SeedNpcDraft[]) => void;
  /** Hard cap on cast size. Defaults to 4. */
  maxNpcs?: number;
};

const DEFAULT_MAX_NPCS = 4;
const NAME_MAX = 40;
const DESCRIPTION_MIN = 8;
const DESCRIPTION_MAX = 200;
/**
 * Mirrors the server's publishing-surface allowlist regex for NPC names.
 * Keeping the same regex client-side lets us reject obvious bad chars
 * before the round-trip, but the backend remains authoritative.
 */
const NAME_ALLOWLIST = /^[\p{L}\p{N} '\-]{1,40}$/u;

const ROLE_ORDER: NpcRole[] = ["companion", "ally", "neutral", "rival", "antagonist"];

const HELPER_TEXT =
  "Authored cast members appear in the story from the start. The story may also introduce new characters as you read.";

export function NpcCastEditor({ value, onChange, maxNpcs = DEFAULT_MAX_NPCS }: NpcCastEditorProps) {
  const { tokens } = useAppTheme();
  const atCap = value.length >= maxNpcs;

  const handleAdd = useCallback(() => {
    if (value.length >= maxNpcs) return;
    onChange([...value, { name: "", role: "ally", description: "" }]);
  }, [maxNpcs, onChange, value]);

  const handleRemove = useCallback(
    (index: number) => {
      const next = value.slice();
      next.splice(index, 1);
      onChange(next);
    },
    [onChange, value],
  );

  const handlePatch = useCallback(
    (index: number, patch: Partial<SeedNpcDraft>) => {
      const next = value.slice();
      const current = next[index];
      if (!current) return;
      next[index] = { ...current, ...patch };
      onChange(next);
    },
    [onChange, value],
  );

  return (
    <Surface padded variant="muted">
      <View style={{ gap: tokens.spacing.md }}>
        <View style={{ gap: tokens.spacing.xs }}>
          <Text variant="subtitle">{`Optional cast (${value.length})`}</Text>
          <Text muted variant="bodySmall">
            {HELPER_TEXT}
          </Text>
        </View>

        {value.length === 0 ? null : (
          <View style={{ gap: tokens.spacing.md }}>
            {value.map((npc, index) => (
              <NpcCastRow
                key={`npc-row-${index}`}
                index={index}
                npc={npc}
                onPatch={(patch) => handlePatch(index, patch)}
                onRemove={() => handleRemove(index)}
              />
            ))}
          </View>
        )}

        {atCap ? (
          <Text muted variant="caption">
            {`Cast at capacity (${maxNpcs}).`}
          </Text>
        ) : (
          <Button accessibilityLabel="Add a character" onPress={handleAdd} variant="ghost">
            {value.length === 0 ? "Add a character" : "Add another character"}
          </Button>
        )}
      </View>
    </Surface>
  );
}

type NpcCastRowProps = {
  index: number;
  npc: SeedNpcDraft;
  onPatch: (patch: Partial<SeedNpcDraft>) => void;
  onRemove: () => void;
};

function NpcCastRow({ index, npc, onPatch, onRemove }: NpcCastRowProps) {
  const { tokens } = useAppTheme();
  const validation = validateSingleNpc(npc);
  const showError = validation.ok ? null : validation.reason;
  // First row reads "Character 1" — title-case sounds nicer than "NPC 1"
  // in author-facing copy.
  const rowLabel = `Character ${index + 1}`;

  return (
    <Surface padded>
      <View style={{ gap: tokens.spacing.sm }}>
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            justifyContent: "space-between",
          }}
        >
          <Text variant="subtitle">{rowLabel}</Text>
          <Pressable
            accessibilityLabel={`Remove ${rowLabel}`}
            accessibilityRole="button"
            onPress={onRemove}
            style={({ pressed }) => ({
              opacity: pressed ? 0.7 : 1,
              paddingHorizontal: tokens.spacing.sm,
              paddingVertical: tokens.spacing.xs,
            })}
          >
            <Text style={{ color: tokens.colors.accent, fontWeight: "600" }} variant="bodySmall">
              Remove
            </Text>
          </Pressable>
        </View>

        <View style={{ gap: tokens.spacing.xs }}>
          <Text muted variant="caption">
            Name
          </Text>
          <TextInput
            accessibilityLabel={`${rowLabel} name`}
            maxLength={NAME_MAX}
            onChangeText={(text) => onPatch({ name: text })}
            placeholder="A name"
            placeholderTextColor={tokens.colors.textFaint}
            style={{
              borderColor: tokens.colors.borderMuted,
              borderRadius: tokens.radii.sm,
              borderWidth: tokens.borderWidths.regular,
              color: tokens.colors.text,
              fontFamily: tokens.typography.families.body,
              fontSize: tokens.typography.body,
              minHeight: 44,
              paddingHorizontal: tokens.spacing.md,
            }}
            value={npc.name}
          />
        </View>

        <View style={{ gap: tokens.spacing.xs }}>
          <Text muted variant="caption">
            Role
          </Text>
          <RoleChipGroup
            onChange={(role) => onPatch({ role })}
            value={npc.role}
            ariaLabel={`${rowLabel} role`}
          />
        </View>

        <View style={{ gap: tokens.spacing.xs }}>
          <Text muted variant="caption">
            {`Description (${npc.description.length}/${DESCRIPTION_MAX})`}
          </Text>
          <TextInput
            accessibilityLabel={`${rowLabel} description`}
            maxLength={DESCRIPTION_MAX}
            multiline
            onChangeText={(text) => onPatch({ description: text })}
            placeholder="Who they are, how they speak, what they want."
            placeholderTextColor={tokens.colors.textFaint}
            style={{
              borderColor: tokens.colors.borderMuted,
              borderRadius: tokens.radii.sm,
              borderWidth: tokens.borderWidths.regular,
              color: tokens.colors.text,
              fontFamily: tokens.typography.families.body,
              fontSize: tokens.typography.body,
              minHeight: 88,
              padding: tokens.spacing.md,
              textAlignVertical: "top",
            }}
            value={npc.description}
          />
        </View>

        {showError ? (
          <>
            <Divider />
            <Note>{showError}</Note>
          </>
        ) : null}
      </View>
    </Surface>
  );
}

type RoleChipGroupProps = {
  value: NpcRole;
  onChange: (role: NpcRole) => void;
  ariaLabel: string;
};

function RoleChipGroup({ ariaLabel, onChange, value }: RoleChipGroupProps) {
  const { tokens } = useAppTheme();
  return (
    <View
      accessibilityLabel={ariaLabel}
      accessibilityRole="radiogroup"
      style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.xs }}
    >
      {ROLE_ORDER.map((role) => {
        const selected = role === value;
        const tone = roleToneColors(role, tokens.colors);
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            key={role}
            onPress={() => onChange(role)}
            style={({ pressed }) =>
              ({
                backgroundColor: selected ? tone.background : tokens.colors.surface,
                borderColor: selected ? tone.border : tokens.colors.borderMuted,
                borderRadius: tokens.radii.pill,
                borderWidth: tokens.borderWidths.regular,
                opacity: pressed ? 0.85 : 1,
                paddingHorizontal: tokens.spacing.md,
                paddingVertical: tokens.spacing.xs,
              }) satisfies ViewStyle
            }
          >
            <Text
              style={{
                color: selected ? tokens.colors.text : tokens.colors.text,
                fontWeight: selected ? "700" : "500",
              }}
              variant="caption"
            >
              {ROLE_LABEL[role]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export type NpcCastValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

const VALID_ROLES = new Set<NpcRole>(ROLE_ORDER);

function validateSingleNpc(npc: SeedNpcDraft): NpcCastValidationResult {
  const name = npc.name.trim();
  if (name.length === 0) return { ok: false, reason: "Name is required." };
  if (name.length > NAME_MAX) {
    return { ok: false, reason: `Name must be ${NAME_MAX} characters or fewer.` };
  }
  if (!NAME_ALLOWLIST.test(name)) {
    return {
      ok: false,
      reason: "Names can only use letters, numbers, spaces, apostrophes, and hyphens.",
    };
  }
  if (!VALID_ROLES.has(npc.role)) {
    return { ok: false, reason: "Pick a role for this character." };
  }
  const description = npc.description.trim();
  if (description.length < DESCRIPTION_MIN) {
    return {
      ok: false,
      reason: `Description must be at least ${DESCRIPTION_MIN} characters.`,
    };
  }
  if (description.length > DESCRIPTION_MAX) {
    return {
      ok: false,
      reason: `Description must be ${DESCRIPTION_MAX} characters or fewer.`,
    };
  }
  return { ok: true };
}

/**
 * Validate the full cast. Returns the first row-level failure so the seed
 * flow can present one actionable error. The seed-flow's `handleLaunch`
 * uses a single friendly summary message instead of surfacing the
 * per-row reason — that copy lives in `SeedStoryFlow`.
 */
export function validateNpcCast(draft: SeedNpcDraft[]): NpcCastValidationResult {
  if (draft.length === 0) return { ok: true };
  for (const npc of draft) {
    const result = validateSingleNpc(npc);
    if (!result.ok) return result;
  }
  return { ok: true };
}

/** Exposed for callers that only need to know whether the cast is launchable. */
export function isNpcCastValid(draft: SeedNpcDraft[]): boolean {
  return validateNpcCast(draft).ok;
}
