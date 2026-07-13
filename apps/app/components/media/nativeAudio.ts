/**
 * nativeAudio — thin native-only wrapper around `expo-audio` used by the
 * scene audio layers (music / ambient / veo / sfx) in `AudioMix`.
 *
 * The whole point of the native build is that these layers keep playing when
 * the screen locks or the app backgrounds — that requires an active audio
 * session configured with `shouldPlayInBackground`, which `setAudioModeAsync`
 * installs. Web is untouched: `AudioMix` keeps its HTMLAudio path and never
 * imports this module's native branch at runtime.
 *
 * `expo-audio` is required lazily (never statically imported) so the web
 * bundle/runtime never loads it — keeping the web export self-contained and
 * the web audio path on plain HTMLAudio.
 */
import { Platform } from "react-native";

let audioModeConfigured = false;

/**
 * Install the app-wide native audio session once. Idempotent; no-op on web.
 *
 * - `playsInSilentMode: true` — narration/ambience should still be audible
 *   when the iOS hardware mute switch is on (readers expect a "media" app to
 *   ignore the ringer switch).
 * - `shouldPlayInBackground: true` — the core native win: audio continues
 *   when the screen locks or the app backgrounds.
 * - `interruptionMode: "doNotMix"` — required for lock-screen / Control
 *   Center transport controls to bind (per expo-audio docs). Our own layers
 *   still mix with each other (they share the app's single audio session);
 *   this only governs interaction with OTHER apps' audio.
 */
export function configureNativeAudioMode(): void {
  if (Platform.OS === "web") return;
  if (audioModeConfigured) return;
  audioModeConfigured = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { setAudioModeAsync } = require("expo-audio");
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
      interruptionModeAndroid: "doNotMix",
    }).catch(() => undefined);
  } catch {
    // expo-audio unavailable (e.g. bare test env) — degrade to no audio.
  }
}

/**
 * Minimal structural view of the `expo-audio` AudioPlayer surface AudioMix
 * needs. Kept local so the module has no static expo-audio type dependency.
 */
export type NativeAudioPlayer = {
  volume: number;
  loop: boolean;
  play(): void;
  pause(): void;
  remove(): void;
};

/**
 * Create and start a native audio player for a single layer. Returns null on
 * web or when expo-audio is unavailable. The caller owns teardown via
 * `player.remove()`.
 */
export function createNativePlayer(
  uri: string,
  loop: boolean,
  volume: number,
): NativeAudioPlayer | null {
  if (Platform.OS === "web") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createAudioPlayer } = require("expo-audio");
    const player = createAudioPlayer({ uri }) as NativeAudioPlayer;
    player.loop = loop;
    player.volume = clamp01(volume);
    return player;
  } catch {
    return null;
  }
}

export function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
