import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Seed voice catalogue. Provider-stable IDs that survive across releases and
// tales. Real TTS provider lookup happens server-side in a later wave — this
// list seeds the picker for visual-design wave 2.
export type NarratorVoice = {
  id: string;
  name: string;
  kicker: string;
  blurb: string;
  // Optional sample URI. In wave 2 we ship without bundled audio assets; the
  // picker treats `undefined` as "sample not yet available" and degrades to a
  // visual-only preview.
  sampleUri?: string | undefined;
};

export const NARRATOR_VOICES: ReadonlyArray<NarratorVoice> = [
  {
    id: "voice.ash",
    name: "Ash",
    kicker: "Hearth and warning",
    blurb: "A low, weather-cured voice that lingers on consonants.",
  },
  {
    id: "voice.lark",
    name: "Lark",
    kicker: "Wry and quick",
    blurb: "Bright cadence, dry humour, a smile in the margins.",
  },
  {
    id: "voice.beren",
    name: "Beren",
    kicker: "Old road, old grief",
    blurb: "Grave and unhurried — the long view from a stone bench.",
  },
  {
    id: "voice.vix",
    name: "Vix",
    kicker: "Whisper and edge",
    blurb: "Half-breath. Knows secrets you have not earned.",
  },
  {
    id: "voice.fen",
    name: "Fen",
    kicker: "Mossy and patient",
    blurb: "Quiet rivers under wide skies; rarely raised.",
  },
  {
    id: "voice.mira",
    name: "Mira",
    kicker: "Choir-trained",
    blurb: "Clear vowels, careful stress, lifts gentle lines into hymn.",
  },
] as const;

export const DEFAULT_VOICE_ID: string = NARRATOR_VOICES[0]!.id;
const LAST_USED_KEY = "cyoa.narratorVoice.lastUsed.v1";

function perSaveKey(saveId: string): string {
  return `cyoa.narratorVoice.${saveId}.v1`;
}

function getStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  if (typeof globalThis === "undefined") return null;
  return (globalThis as { localStorage?: Storage }).localStorage ?? null;
}

function isKnownVoiceId(id: string | null | undefined): id is string {
  if (!id) return false;
  return NARRATOR_VOICES.some((v) => v.id === id);
}

export function getNarratorVoice(voiceId: string): NarratorVoice {
  return NARRATOR_VOICES.find((v) => v.id === voiceId) ?? NARRATOR_VOICES[0]!;
}

function readPinned(saveId: string): string | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(perSaveKey(saveId));
    return isKnownVoiceId(raw) ? raw : null;
  } catch {
    return null;
  }
}

function readLastUsed(): string | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(LAST_USED_KEY);
    return isKnownVoiceId(raw) ? raw : null;
  } catch {
    return null;
  }
}

function writePinned(saveId: string, voiceId: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(perSaveKey(saveId), voiceId);
    storage.setItem(LAST_USED_KEY, voiceId);
  } catch {
    // ignore storage failures (quota / private mode)
  }
}

export type NarratorVoiceStatus = "fresh" | "pinned";

export type ChangeIntent = {
  targetVoiceId: string;
  fromVoiceId: string;
};

export type UseNarratorVoiceResult = {
  voiceId: string;
  voice: NarratorVoice;
  voices: ReadonlyArray<NarratorVoice>;
  status: NarratorVoiceStatus;
  pendingChange: ChangeIntent | null;
  /**
   * Lock the voice for this save.
   *
   * - When no voice is pinned yet (cover screen), this commits immediately.
   * - When a voice is already pinned (mid-tale), this stages a pending change
   *   that the caller must explicitly confirm via {@link confirmChange}.
   */
  pickVoice: (nextVoiceId: string) => void;
  confirmChange: () => void;
  cancelChange: () => void;
};

export function useNarratorVoice(saveId: string | null | undefined): UseNarratorVoiceResult {
  const [voiceId, setVoiceId] = useState<string>(DEFAULT_VOICE_ID);
  const [status, setStatus] = useState<NarratorVoiceStatus>("fresh");
  const [pendingChange, setPendingChange] = useState<ChangeIntent | null>(null);
  const hydratedSaveId = useRef<string | null>(null);

  // Hydrate from storage whenever the save id changes.
  useEffect(() => {
    if (!saveId) {
      hydratedSaveId.current = null;
      setVoiceId(DEFAULT_VOICE_ID);
      setStatus("fresh");
      setPendingChange(null);
      return;
    }
    if (hydratedSaveId.current === saveId) return;
    hydratedSaveId.current = saveId;

    const pinned = readPinned(saveId);
    if (pinned) {
      setVoiceId(pinned);
      setStatus("pinned");
      setPendingChange(null);
      return;
    }

    const lastUsed = readLastUsed();
    setVoiceId(lastUsed ?? DEFAULT_VOICE_ID);
    setStatus("fresh");
    setPendingChange(null);
  }, [saveId]);

  const pickVoice = useCallback(
    (nextVoiceId: string) => {
      if (!isKnownVoiceId(nextVoiceId)) return;
      if (!saveId) {
        setVoiceId(nextVoiceId);
        return;
      }
      if (status === "fresh") {
        writePinned(saveId, nextVoiceId);
        setVoiceId(nextVoiceId);
        setStatus("pinned");
        setPendingChange(null);
        return;
      }
      if (nextVoiceId === voiceId) {
        setPendingChange(null);
        return;
      }
      setPendingChange({ targetVoiceId: nextVoiceId, fromVoiceId: voiceId });
    },
    [saveId, status, voiceId],
  );

  const confirmChange = useCallback(() => {
    if (!pendingChange || !saveId) return;
    writePinned(saveId, pendingChange.targetVoiceId);
    setVoiceId(pendingChange.targetVoiceId);
    setStatus("pinned");
    setPendingChange(null);
  }, [pendingChange, saveId]);

  const cancelChange = useCallback(() => {
    setPendingChange(null);
  }, []);

  const voice = useMemo(() => getNarratorVoice(voiceId), [voiceId]);

  return useMemo<UseNarratorVoiceResult>(
    () => ({
      voiceId,
      voice,
      voices: NARRATOR_VOICES,
      status,
      pendingChange,
      pickVoice,
      confirmChange,
      cancelChange,
    }),
    [cancelChange, confirmChange, pendingChange, pickVoice, status, voice, voiceId],
  );
}

// Exposed for tests and other layers that need to seed pinned voices directly.
export const __internal = {
  perSaveKey,
  LAST_USED_KEY,
  readPinned,
  readLastUsed,
  writePinned,
};
