import { useCallback, useMemo, useState } from "react";
import { TextInput, View } from "react-native";

import type { StorySummary } from "@cyoa/stories";

import type { LibrarySave } from "../../hooks/useLibrary";
import { Button, Chip, Divider, Note, Stamp, Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";
import { SeedPremiseInput } from "./SeedPremiseInput";
import { SEED_TONES, SeedToneSelector, type SeedTone } from "./SeedToneSelector";

export type SeedDraftMetadata = {
  title: string;
  premise: string;
  tone: SeedTone;
  starterId: string;
  createdAt: number;
};

const SEED_DRAFT_KEY = "cyoa.seedDraft.v1";

const STARTER_PRESETS = [
  {
    id: "lamp-lighter",
    label: "Lamp-lighter",
    premise:
      "A lamp-lighter wakes inside a cathedral that has no door. The first candle is still warm.",
  },
  {
    id: "iron-court",
    label: "Iron court",
    premise:
      "A masked messenger is summoned at dusk. The court has a vacancy and the iron throne is colder than usual.",
  },
  {
    id: "after-the-ash",
    label: "After the ash",
    premise:
      "Ash fell for nine days. On the tenth, a stranger arrives at your door with a borrowed name.",
  },
];

/**
 * Local-advisory safety classifier for seed premises. Mirrors the server's
 * narrative safety taxonomy (self-harm, suicide, depressive hopelessness,
 * player-directed despair). This is an additional client-side gate — it
 * does NOT bypass the server contentPolicy check that runs whenever a real
 * seed is sent to the backend; it only prevents the local "launch starter"
 * action from creating a save when the premise visibly crosses the line.
 */
const LOCAL_SAFETY_PATTERNS: Array<[string, RegExp]> = [
  ["self_harm", /\b(self[- ]?harm|hurt myself|cut myself)\b/i],
  ["suicide", /\b(suicide|kill myself|end my life)\b/i],
  ["depressive_hopelessness", /\b(no hope|hopeless forever|nothing matters)\b/i],
  ["player_directed_despair", /\b(you are worthless|you deserve to suffer|your life is pointless)\b/i],
];

export type LocalSafetyResult =
  | { ok: true }
  | { ok: false; categories: string[] };

export function classifySeedPremiseLocally(premise: string): LocalSafetyResult {
  const hits = LOCAL_SAFETY_PATTERNS.filter(([, pattern]) => pattern.test(premise)).map(
    ([category]) => category,
  );
  if (hits.length === 0) return { ok: true };
  return { ok: false, categories: hits };
}

export type SeedStoryFlowProps = {
  /** Starter stories shown in the "pick where" step. */
  starters: StorySummary[];
  /** Create a real save through the existing useLibrary launch path. */
  onLaunchStarter: (starterId: string) => LibrarySave | null;
  /** Called after a successful local validation + save creation. */
  onSeedLaunched: (save: LibrarySave, draft: SeedDraftMetadata) => void;
};

export function SeedStoryFlow({
  onLaunchStarter,
  onSeedLaunched,
  starters,
}: SeedStoryFlowProps) {
  const { tokens } = useAppTheme();
  const [title, setTitle] = useState("");
  const [premise, setPremise] = useState("");
  const [tone, setTone] = useState<SeedTone | null>(null);
  const [starterId, setStarterId] = useState<string | null>(starters[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [safetyWarning, setSafetyWarning] = useState<string | null>(null);

  const canLaunch = useMemo(
    () => Boolean(title.trim() && premise.trim().length >= 24 && tone && starterId),
    [premise, starterId, title, tone],
  );

  const handlePremiseChange = useCallback((next: string) => {
    setPremise(next);
    setSafetyWarning(null);
  }, []);

  const handleLaunch = useCallback(() => {
    setError(null);
    setSafetyWarning(null);

    const trimmedTitle = title.trim();
    const trimmedPremise = premise.trim();
    if (!trimmedTitle) {
      setError("Give the seed a title before launching.");
      return;
    }
    if (trimmedPremise.length < 24) {
      setError("Premise must be at least 24 characters so the reader has something to start from.");
      return;
    }
    if (!tone) {
      setError("Pick a tone — the tone shapes the opening beat.");
      return;
    }
    if (!starterId) {
      setError("Pick where the seed launches from.");
      return;
    }

    const localCheck = classifySeedPremiseLocally(trimmedPremise);
    if (!localCheck.ok) {
      // Do NOT launch. We never bypass safety — the server-side policy
      // would also block this premise at publish time; this is a client-side
      // mirror so the user is not allowed to create a save in the first place.
      setSafetyWarning(
        "This premise crosses the safety policy. Please rework the opening before launching.",
      );
      return;
    }

    const save = onLaunchStarter(starterId);
    if (!save) {
      setError("Could not launch the seed save. Try a different starter.");
      return;
    }

    const draft: SeedDraftMetadata = {
      title: trimmedTitle,
      premise: trimmedPremise,
      tone,
      starterId,
      createdAt: Date.now(),
    };
    persistSeedDraft(save.saveId, draft);
    onSeedLaunched(save, draft);
  }, [onLaunchStarter, onSeedLaunched, premise, starterId, title, tone]);

  return (
    <View style={{ gap: tokens.spacing.lg }}>
      <View style={{ gap: tokens.spacing.sm }}>
        <Stamp>seed flow</Stamp>
        <Text variant="title">Seed an adventure</Text>
        <Text muted>Pick where the candle is lit, the tone, and the opening beat.</Text>
      </View>

      <Surface padded>
        <View style={{ gap: tokens.spacing.md }}>
          <View style={{ gap: tokens.spacing.sm }}>
            <Text variant="subtitle">Title</Text>
            <TextInput
              accessibilityLabel="Seed title"
              onChangeText={setTitle}
              placeholder="A working title"
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
              value={title}
            />
          </View>

          <Divider />

          <View style={{ gap: tokens.spacing.sm }}>
            <Text variant="subtitle">Pick where</Text>
            <Text muted variant="caption">
              The seed launches from the rules of an existing starter tale.
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.xs }}>
              {starters.map((starter) => {
                const selected = starter.id === starterId;
                return (
                  <Text
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={starter.id}
                    onPress={() => setStarterId(starter.id)}
                    style={{
                      backgroundColor: selected ? tokens.colors.accent : "transparent",
                      borderColor: tokens.colors.accent,
                      borderRadius: tokens.radii.pill,
                      borderWidth: tokens.borderWidths.regular,
                      color: selected ? tokens.colors.background : tokens.colors.accent,
                      fontWeight: "700",
                      paddingHorizontal: tokens.spacing.md,
                      paddingVertical: tokens.spacing.xs,
                    }}
                    variant="caption"
                  >
                    {starter.title}
                  </Text>
                );
              })}
            </View>
          </View>

          <Divider />

          <View style={{ gap: tokens.spacing.sm }}>
            <Text variant="subtitle">Tone</Text>
            <SeedToneSelector onChange={setTone} value={tone} />
          </View>

          <Divider />

          <SeedPremiseInput
            onChange={handlePremiseChange}
            onUsePreset={(next) => {
              setPremise(next);
              setSafetyWarning(null);
            }}
            presets={STARTER_PRESETS}
            value={premise}
            warning={safetyWarning}
          />

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
            <Chip>Validation required</Chip>
            <Chip>Safety gated</Chip>
            <Chip>Server-authoritative launch</Chip>
          </View>

          {error ? <Note>{error}</Note> : null}

          <Button
            accessibilityState={{ disabled: !canLaunch }}
            disabled={!canLaunch}
            onPress={handleLaunch}
            variant="primary"
          >
            Launch seeded tale
          </Button>
        </View>
      </Surface>
    </View>
  );
}

export const SEED_PRESETS = STARTER_PRESETS;
export const SEED_TONE_OPTIONS = SEED_TONES;

function persistSeedDraft(saveId: string, draft: SeedDraftMetadata): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(`${SEED_DRAFT_KEY}.${saveId}`, JSON.stringify(draft));
  } catch {
    // best-effort persistence; the save itself is the source of truth.
  }
}

export function readSeedDraft(saveId: string): SeedDraftMetadata | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(`${SEED_DRAFT_KEY}.${saveId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SeedDraftMetadata>;
    if (
      typeof parsed.title !== "string" ||
      typeof parsed.premise !== "string" ||
      typeof parsed.starterId !== "string" ||
      typeof parsed.createdAt !== "number" ||
      typeof parsed.tone !== "string"
    ) {
      return null;
    }
    return parsed as SeedDraftMetadata;
  } catch {
    return null;
  }
}

function getStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  if (typeof globalThis === "undefined") return null;
  return (globalThis as { localStorage?: Storage }).localStorage ?? null;
}
