// Maps stable narrator voice ids (defined client-side in
// apps/app/hooks/useNarratorVoice.ts) to Google Cloud TTS voice names.
//
// Picks are Chirp 3 HD — Google's newest generation, dramatically more
// natural than Neural2 / WaveNet. Each pick honours the kicker + blurb
// in useNarratorVoice.ts:
//
//   voice.ash   - "low weather-cured"  -> en-US-Chirp3-HD-Iapetus (clear, grounded male)
//   voice.lark  - "bright, dry humor"  -> en-US-Chirp3-HD-Leda    (youthful, bright female)
//   voice.beren - "grave, unhurried"   -> en-GB-Chirp3-HD-Algieba (RP older male)
//   voice.vix   - "whisper and edge"   -> en-US-Chirp3-HD-Despina (smooth, intimate female)
//   voice.fen   - "mossy and patient"  -> en-US-Chirp3-HD-Charon  (informative male)
//   voice.mira  - "choir-trained"      -> en-US-Chirp3-HD-Zephyr  (bright, lifted female)
//
// Unknown ids fall back to voice.ash so the asset still resolves rather than
// failing the whole TTS request.

export type GoogleTtsVoice = {
  languageCode: string;
  name: string;
};

const VOICE_MAP: Record<string, GoogleTtsVoice> = {
  "voice.ash": { languageCode: "en-US", name: "en-US-Chirp3-HD-Iapetus" },
  "voice.lark": { languageCode: "en-US", name: "en-US-Chirp3-HD-Leda" },
  "voice.beren": { languageCode: "en-GB", name: "en-GB-Chirp3-HD-Algieba" },
  "voice.vix": { languageCode: "en-US", name: "en-US-Chirp3-HD-Despina" },
  "voice.fen": { languageCode: "en-US", name: "en-US-Chirp3-HD-Charon" },
  "voice.mira": { languageCode: "en-US", name: "en-US-Chirp3-HD-Zephyr" },
};

const DEFAULT_VOICE: GoogleTtsVoice = VOICE_MAP["voice.ash"]!;

export function mapVoiceIdToGoogleTts(voiceId: string): GoogleTtsVoice {
  return VOICE_MAP[voiceId] ?? DEFAULT_VOICE;
}

// Exposed for diagnostics and tests.
export function listKnownVoiceIds(): string[] {
  return Object.keys(VOICE_MAP);
}
