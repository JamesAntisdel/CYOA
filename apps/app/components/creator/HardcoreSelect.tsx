import { Pressable, View } from "react-native";

import {
  buildDowngradeModel,
  canStartMode,
  HARDCORE_CONSENT_LINES,
  HARDCORE_CONSENT_TITLE,
  HARDCORE_DEATH_PURGE_COPY,
  type SaveMode,
} from "../../lib/storyEngagementW3";
import { useAppTheme } from "../../theme";
import { Button, Note, Stamp, Surface, Text } from "../primitives";

type HardcoreSelectProps = {
  /** The currently chosen mode. */
  mode: SaveMode;
  /** Whether the reader has acknowledged the Hardcore consent screen. */
  consented: boolean;
  /** Change the mode (Story ⇄ Hardcore). Choosing Hardcore reveals consent. */
  onModeChange: (mode: SaveMode) => void;
  /** Toggle the consent acknowledgment. */
  onConsentChange: (consented: boolean) => void;
};

/**
 * HardcoreSelect (design §4.3, R15) — the Story / Hardcore mode picker at save
 * creation. Choosing Hardcore reveals a consent screen ("this tome does not
 * forgive") that MUST be acknowledged before a hardcore run can start
 * (`canStartMode`). The chosen `mode` flows into `createSave`.
 */
export function HardcoreSelect({
  mode,
  consented,
  onModeChange,
  onConsentChange,
}: HardcoreSelectProps) {
  const { tokens } = useAppTheme();

  return (
    <Surface accessibilityLabel="Difficulty" padded style={{ gap: tokens.spacing.md }}>
      <View style={{ gap: tokens.spacing.xs }}>
        <Stamp>difficulty</Stamp>
        <Text variant="subtitle">How should the tome treat you?</Text>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
        <ModeOption
          active={mode === "story"}
          description="Rewind, forgive, wander."
          label="Story"
          onPress={() => onModeChange("story")}
        />
        <ModeOption
          active={mode === "hardcore"}
          description="Permadeath. No rewind."
          label="Hardcore"
          onPress={() => onModeChange("hardcore")}
        />
      </View>

      {mode === "hardcore" ? (
        <HardcoreConsent consented={consented} onConsentChange={onConsentChange} />
      ) : null}
    </Surface>
  );
}

function ModeOption({
  active,
  description,
  label,
  onPress,
}: {
  active: boolean;
  description: string;
  label: string;
  onPress: () => void;
}) {
  const { tokens } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={`${label} mode. ${description}`}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: active ? tokens.colors.accentMuted : tokens.colors.surface,
        borderColor: active ? tokens.colors.accent : tokens.colors.border,
        borderRadius: tokens.radii.sm,
        borderWidth: tokens.borderWidths.regular,
        flexGrow: 1,
        gap: 2,
        minWidth: 140,
        opacity: pressed ? 0.8 : 1,
        padding: tokens.spacing.md,
      })}
    >
      <Text style={{ fontWeight: "700" }} tone={active ? "accent" : "default"}>
        {label}
      </Text>
      <Text muted variant="caption">
        {description}
      </Text>
    </Pressable>
  );
}

/**
 * The Hardcore consent screen (R15.3). Renders the "this tome does not forgive"
 * copy and an explicit acknowledgment toggle. Until it's checked,
 * `canStartMode("hardcore", consented)` is false and the host disables launch.
 */
export function HardcoreConsent({
  consented,
  onConsentChange,
}: {
  consented: boolean;
  onConsentChange: (consented: boolean) => void;
}) {
  const { tokens } = useAppTheme();
  return (
    <Surface
      accessibilityLabel="Hardcore consent"
      padded
      style={{ borderColor: tokens.colors.danger, gap: tokens.spacing.sm }}
      variant="muted"
    >
      <Text
        style={{
          color: tokens.colors.danger,
          fontFamily: tokens.typography.families.serif,
          fontStyle: "italic",
        }}
        variant="subtitle"
      >
        {HARDCORE_CONSENT_TITLE}
      </Text>
      <View style={{ gap: 2 }}>
        {HARDCORE_CONSENT_LINES.map((line) => (
          <Text key={line} muted variant="bodySmall">
            {`· ${line}`}
          </Text>
        ))}
      </View>
      <Pressable
        accessibilityLabel="I understand. Begin a Hardcore run."
        accessibilityRole="checkbox"
        accessibilityState={{ checked: consented }}
        onPress={() => onConsentChange(!consented)}
        style={({ pressed }) => ({
          alignItems: "center",
          flexDirection: "row",
          gap: tokens.spacing.sm,
          opacity: pressed ? 0.8 : 1,
          paddingVertical: tokens.spacing.xs,
        })}
      >
        <Text variant="body">{consented ? "☑" : "☐"}</Text>
        <Text style={{ flex: 1 }} variant="bodySmall">
          I understand this tome does not forgive.
        </Text>
      </Pressable>
    </Surface>
  );
}

/**
 * HardcoreDeathNotice (R15.1) — the purge acknowledgment surfaced on a Hardcore
 * death screen: the run and its generated assets are gone. Rendered by the
 * ending/death surface only for a hardcore save.
 */
export function HardcoreDeathNotice() {
  const { tokens } = useAppTheme();
  return (
    <Surface
      accessibilityLabel="Hardcore run purged"
      padded
      style={{ borderColor: tokens.colors.danger, gap: tokens.spacing.xs }}
      variant="muted"
    >
      <Text
        style={{
          color: tokens.colors.danger,
          fontFamily: tokens.typography.families.mono,
          fontWeight: "700",
          letterSpacing: 1,
          textTransform: "uppercase",
        }}
        variant="caption"
      >
        The tome closes
      </Text>
      <Text muted variant="bodySmall">
        {HARDCORE_DEATH_PURGE_COPY}
      </Text>
    </Surface>
  );
}

/**
 * HardcoreDowngrade (R15.2) — a per-save settings surface to downgrade a
 * Hardcore run to Story with the specced caveat (hardcore-only unlocks
 * disabled). Only offered for hardcore saves; mid-run upgrade is NEVER offered.
 */
export function HardcoreDowngrade({
  mode,
  onDowngrade,
}: {
  mode: SaveMode;
  onDowngrade: () => void;
}) {
  const { tokens } = useAppTheme();
  const model = buildDowngradeModel(mode);
  if (!model.canDowngrade) return null;

  return (
    <Surface accessibilityLabel="Downgrade difficulty" padded style={{ gap: tokens.spacing.sm }}>
      <Stamp>hardcore</Stamp>
      <Text variant="subtitle">Soften this tome?</Text>
      <Note>{model.caveat}</Note>
      <Button
        accessibilityLabel="Downgrade to Story mode"
        onPress={onDowngrade}
        variant="danger"
      >
        Downgrade to Story
      </Button>
    </Surface>
  );
}

/** Re-export so hosts can gate launch without importing the lib directly. */
export { canStartMode };
