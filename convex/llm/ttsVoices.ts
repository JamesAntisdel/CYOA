// Maps stable narrator voice ids (defined client-side in
// apps/app/hooks/useNarratorVoice.ts) to Google Cloud TTS voice names.
//
// Choices skew toward Neural2 voices, which give the warmest prosody in
// the Google catalogue without paying the latency cost of Studio voices.
// Each pick honours the kicker + blurb in useNarratorVoice.ts:
//
//   voice.ash   - "low weather-cured"  -> en-US-Neural2-D (warm low male)
//   voice.lark  - "bright, dry humor"  -> en-US-Neural2-F (bright female)
//   voice.beren - "grave, unhurried"   -> en-GB-Neural2-B (RP grave male)
//   voice.vix   - "whisper and edge"   -> en-US-Neural2-C (cool female, lowered VolumeGainDb at the client)
//   voice.fen   - "mossy and patient"  -> en-GB-Neural2-D (relaxed mid male)
//   voice.mira  - "choir-trained"      -> en-US-Neural2-H (clear lift female)
//
// Unknown ids fall back to voice.ash so the asset still resolves rather than
// failing the whole TTS request.

export type GoogleTtsVoice = {
  languageCode: string;
  name: string;
};

const VOICE_MAP: Record<string, GoogleTtsVoice> = {
  "voice.ash": { languageCode: "en-US", name: "en-US-Neural2-D" },
  "voice.lark": { languageCode: "en-US", name: "en-US-Neural2-F" },
  "voice.beren": { languageCode: "en-GB", name: "en-GB-Neural2-B" },
  "voice.vix": { languageCode: "en-US", name: "en-US-Neural2-C" },
  "voice.fen": { languageCode: "en-GB", name: "en-GB-Neural2-D" },
  "voice.mira": { languageCode: "en-US", name: "en-US-Neural2-H" },
};

const DEFAULT_VOICE: GoogleTtsVoice = VOICE_MAP["voice.ash"]!;

export function mapVoiceIdToGoogleTts(voiceId: string): GoogleTtsVoice {
  return VOICE_MAP[voiceId] ?? DEFAULT_VOICE;
}

// Exposed for diagnostics and tests.
export function listKnownVoiceIds(): string[] {
  return Object.keys(VOICE_MAP);
}
