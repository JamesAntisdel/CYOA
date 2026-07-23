import { useCallback, useMemo, useState } from "react";
import { useRouter } from "expo-router";

import { getLocalStorage as getStorage } from "../../lib/storage";
import { TextInput, View } from "react-native";

import { useAccountProfile } from "../../hooks/useAccountProfile";
import type { LibrarySave } from "../../hooks/useLibrary";
import type { RemoteKeepsake } from "../../lib/gameApi";
import type { ReadingMode } from "../../lib/readingMode";
import { isIllustratedBookUnlocked } from "../../lib/readerSettingsGroups";
import { canStartMode, type SaveMode } from "../../lib/storyEngagementW3";
import { ReadingModeChooser } from "../reading/ReadingModeChooser";
import { Button, Chip, Divider, Note, Stamp, Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";
import { HardcoreSelect } from "./HardcoreSelect";
import { KeepsakePicker } from "./KeepsakePicker";
import {
  NpcCastEditor,
  validateNpcCast,
  type SeedNpcDraft,
} from "./NpcCastEditor";
import { SeedPremiseInput } from "./SeedPremiseInput";
import { SEED_TONES, SeedToneSelector, type SeedTone } from "./SeedToneSelector";

export type SeedDraftMetadata = {
  title: string;
  premise: string;
  tone: SeedTone;
  /**
   * Reader-authored cast captured at seed time. Persisted to localStorage so
   * a refresh between editing and launching doesn't lose work; the source
   * of truth after launch is the save record on the server.
   */
  npcCast: SeedNpcDraft[];
  createdAt: number;
};

const SEED_DRAFT_KEY = "cyoa.seedDraft.v1";

const SEED_PREMISE_PRESETS = [
  // Broader-genre presets are listed first so the reader sees the full
  // surface (sci-fi, survival, modern, undersea) before the dark-fantasy
  // bias of the original three.
  {
    id: "freighter-alarm",
    label: "Freighter alarm",
    premise:
      "The decompression alarm wakes you on deck three. Through the porthole, the stars are in the wrong places.",
  },
  {
    id: "andes-crash",
    label: "Andes crash",
    premise:
      "Snow is climbing the fuselage. The radio gives one word and then nothing. The pilot has not moved.",
  },
  {
    id: "first-day-strange-campus",
    label: "First day, strange campus",
    premise:
      "The campus map you were given has a building that isn't there. Your roommate insists you've been here for weeks.",
  },
  {
    id: "submarine-third-bell",
    label: "Submarine, third bell",
    premise:
      "Three bells means a hull breach, and the captain is locked in the conning tower. You have the only key.",
  },
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
  /**
   * Create a real save through the existing useLibrary launch path. The
   * seed-flow passes the reader-authored title/premise/tone; the host
   * route binds the open-canvas starter id and persists the seed fields
   * on the save record so the backend uses them as the LLM premise.
   */
  onLaunchSeed: (input: {
    title: string;
    premise: string;
    tone: SeedTone;
    /**
     * Reader-authored cast (0–4 NPCs). Always defined; an empty array means
     * the reader chose to skip the optional cast and the backend should
     * fall back to its own NPC introduction cadence.
     */
    npcCast: SeedNpcDraft[];
    /** Story-engagement Wave 3 (R15): Story (default) or Hardcore. */
    mode: SaveMode;
    /** Story-engagement Wave 3 (R12.2): the single keepsake to carry, if any. */
    keepsakeId?: string;
    /**
     * Reading-modes cleanup — how this seeded tale reads (Branching vs Novel),
     * chosen at create time via the shared ReadingModeChooser. Always defined
     * ("branching" by default). The host forwards it to `createSave`'s
     * `options.readingMode`; the server re-gates Novel on entitlement.
     */
    readingMode: ReadingMode;
  }) => LibrarySave | null | Promise<LibrarySave | null>;
  /** Called after a successful local validation + save creation. */
  onSeedLaunched: (save: LibrarySave, draft: SeedDraftMetadata) => void;
  /**
   * Story-engagement Wave 3 (R12.2): the account's owned keepsakes for the
   * carry picker. Absent/empty → the picker hides. Server-projected via the
   * widened profile projection.
   */
  keepsakes?: RemoteKeepsake[] | null;
};

export function SeedStoryFlow({
  onLaunchSeed,
  onSeedLaunched,
  keepsakes,
}: SeedStoryFlowProps) {
  const { tokens } = useAppTheme();
  const router = useRouter();
  // Reading-modes cleanup — Novel is a Pro mode. Same pro-media gate the rest
  // of the app uses (dev-force flag OR active pro/unlimited) so a non-Pro
  // reader who taps Novel routes to the paywall instead of a silent downgrade.
  const { profile } = useAccountProfile();
  const novelUnlocked = isIllustratedBookUnlocked(profile);
  const [title, setTitle] = useState("");
  const [premise, setPremise] = useState("");
  const [tone, setTone] = useState<SeedTone | null>(null);
  const [npcCast, setNpcCast] = useState<SeedNpcDraft[]>([]);
  const [mode, setMode] = useState<SaveMode>("story");
  // Reading-modes cleanup — custom seeds gained a Branching/Novel choice too
  // (it was missing on this surface). Chosen at create; threaded into the
  // launch createSave via onLaunchSeed. Default: branching.
  const [readingMode, setReadingMode] = useState<ReadingMode>("branching");
  const [consented, setConsented] = useState(false);
  const [keepsakeId, setKeepsakeId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [safetyWarning, setSafetyWarning] = useState<string | null>(null);

  // Launch is gated on the base fields AND the Hardcore consent (R15.3 —
  // canStartMode returns false for hardcore until acknowledged).
  const canLaunch = useMemo(
    () =>
      Boolean(title.trim() && premise.trim().length >= 24 && tone) &&
      canStartMode(mode, consented),
    [premise, title, tone, mode, consented],
  );

  const handlePremiseChange = useCallback((next: string) => {
    setPremise(next);
    setSafetyWarning(null);
  }, []);

  const handleLaunch = useCallback(async () => {
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

    // Validate the optional cast before round-tripping. Server is still
    // authoritative (it runs the publishing-surface classifier on each
    // description and may reject one) but the local gate catches obvious
    // shape problems immediately.
    const castCheck = validateNpcCast(npcCast);
    if (!castCheck.ok) {
      setError("Each cast member needs a name and an 8+ character description.");
      return;
    }

    if (!canStartMode(mode, consented)) {
      setError("Acknowledge the Hardcore consent before launching.");
      return;
    }

    let save;
    try {
      save = await onLaunchSeed({
        title: trimmedTitle,
        premise: trimmedPremise,
        tone,
        npcCast,
        readingMode,
        mode,
        ...(keepsakeId ? { keepsakeId } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "seed_launch_failed";
      if (message === "guest_session_required") {
        setError("Start a session before launching a seed.");
      } else if (message === "seed_premise_blocked" || message.includes("seed_premise_blocked")) {
        // Server-side publishing-surface classifier rejected the premise.
        // Mirror the copy used by the local-advisory classifier above so
        // the reader gets the same actionable message regardless of which
        // gate fired.
        setSafetyWarning(
          "This premise crosses the safety policy. Please rework the opening before launching.",
        );
      } else if (message === "seed_npc_blocked" || message.includes("seed_npc_blocked")) {
        // Server-side publishing-surface classifier rejected one of the
        // authored NPC descriptions. Surface a friendly nudge without
        // pointing at a specific row — the backend doesn't tell us which
        // one and we don't want to drop the rest of the user's work.
        setError(
          "One of your cast members crosses the safety policy. Reword and try again.",
        );
      } else {
        setError(`Could not launch: ${message}`);
      }
      return;
    }
    if (!save) {
      setError("Could not launch the seed save. Try again in a moment.");
      return;
    }

    const draft: SeedDraftMetadata = {
      title: trimmedTitle,
      premise: trimmedPremise,
      tone,
      npcCast,
      createdAt: Date.now(),
    };
    persistSeedDraft(save.saveId, draft);
    onSeedLaunched(save, draft);
  }, [consented, keepsakeId, mode, npcCast, onLaunchSeed, onSeedLaunched, premise, readingMode, title, tone]);

  return (
    <View style={{ gap: tokens.spacing.lg }}>
      <View style={{ gap: tokens.spacing.sm }}>
        <Stamp>seed flow</Stamp>
        <Text variant="title">Seed an adventure</Text>
        <Text muted>Author a title, a tone, and an opening premise — the engine takes it from there.</Text>
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
            presets={SEED_PREMISE_PRESETS}
            value={premise}
            warning={safetyWarning}
          />

          <Divider />

          <NpcCastEditor onChange={setNpcCast} value={npcCast} />

          <Divider />

          {/* Reading-modes cleanup — the Branching/Novel choice was missing on
              custom-story creation; the shared chooser adds it here so seeded
              tales can launch as a linear Novel too. Threaded into the launch
              createSave via onLaunchSeed. */}
          <View style={{ gap: tokens.spacing.sm }}>
            <Text variant="subtitle">How this reads</Text>
            <ReadingModeChooser
              isPro={novelUnlocked}
              onChange={setReadingMode}
              onNovelLocked={() => router.push("/paywall?reason=pro_media")}
              value={readingMode}
            />
          </View>

          <Divider />

          {/* Story-engagement Wave 3: carry a keepsake (hidden when the account
              owns none) + choose Story / Hardcore mode with its consent gate. */}
          <KeepsakePicker keepsakes={keepsakes} onChange={setKeepsakeId} selectedId={keepsakeId} />

          <HardcoreSelect
            consented={consented}
            mode={mode}
            onConsentChange={setConsented}
            onModeChange={(next) => {
              setMode(next);
              // Reset consent whenever the reader flips modes so choosing
              // Hardcore always re-requires an explicit acknowledgment.
              if (next === "story") setConsented(false);
            }}
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
            onPress={() => {
              void handleLaunch();
            }}
            variant="primary"
          >
            Launch seeded tale
          </Button>
        </View>
      </Surface>
    </View>
  );
}

export const SEED_PRESETS = SEED_PREMISE_PRESETS;
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
      typeof parsed.createdAt !== "number" ||
      typeof parsed.tone !== "string"
    ) {
      return null;
    }
    // npcCast is optional in older drafts (predates the cast editor) —
    // normalize to [] so consumers don't have to guard the field.
    const npcCast: SeedNpcDraft[] = Array.isArray(parsed.npcCast)
      ? (parsed.npcCast.filter(
          (entry: unknown): entry is SeedNpcDraft =>
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as SeedNpcDraft).name === "string" &&
            typeof (entry as SeedNpcDraft).description === "string" &&
            typeof (entry as SeedNpcDraft).role === "string",
        ) as SeedNpcDraft[])
      : [];
    return {
      title: parsed.title,
      premise: parsed.premise,
      tone: parsed.tone as SeedTone,
      createdAt: parsed.createdAt,
      npcCast,
    };
  } catch {
    return null;
  }
}

