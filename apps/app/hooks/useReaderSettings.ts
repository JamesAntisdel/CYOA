import { useCallback, useEffect, useMemo, useState } from "react";

import { getLocalStorage as getStorage } from "../lib/storage";

export type ReaderThemePreference = "day" | "night" | "sepia" | "system";
export type HudMode = "full" | "quiet" | "hidden";
/**
 * Media-strategy the reader selects in /settings (omni-cinematics Req 1).
 * Persisted to `mediaPrefs.cinematicMode` and consumed by the Convex
 * media resolver, which composes it with entitlement + the per-modality
 * gates (Build Correction C4). The client value is the reader's request;
 * the server decides the *effective* strategy.
 *   off               No image or video jobs — text + narrator only.
 *   stills_only       Scene stills, no video.
 *   endpoint_cinematic Endpoint Omni cinematics (opening + ending).
 *   per_scene_legacy  The legacy per-turn Imagen→Veo chain.
 *   illustrated_book  Pro image-first reading mode with a GUARANTEED still
 *                     per scene (reading-modes R3, OQ7 = distinct strategy).
 *                     The resolver owns the still-guarantee; on credit
 *                     exhaustion the server emits an out-of-credits signal
 *                     and MediaPlate degrades to a stylized placeholder (never
 *                     a bare skeleton). Moves in LOCKSTEP with the server-side
 *                     `CinematicMode` / `MediaStrategy` unions (RM6).
 */
export type CinematicMode =
  | "off"
  | "stills_only"
  | "endpoint_cinematic"
  | "per_scene_legacy"
  | "illustrated_book";

export const CINEMATIC_MODES: readonly CinematicMode[] = [
  "off",
  "stills_only",
  "endpoint_cinematic",
  "per_scene_legacy",
  "illustrated_book",
] as const;
export type ReaderLayoutVariant =
  | "book"
  | "modernApp"
  | "graphicNovel"
  | "journal"
  | "mobile"
  | "illustratedBook"
  // open-book (OB1/R1.1): the desktop two-page spread. Auto-selected ≥1024
  // (see ReaderScreen `resolveActiveLayout`); the layout body lands in Wave 2.
  | "spread";

export const READER_LAYOUT_VARIANTS: readonly ReaderLayoutVariant[] = [
  "book",
  "modernApp",
  "graphicNovel",
  "journal",
  "mobile",
  "illustratedBook",
  "spread",
] as const;

export type ReaderSettings = {
  theme: ReaderThemePreference;
  fontScale: "compact" | "default" | "large";
  hudMode: HudMode;
  layout: ReaderLayoutVariant;
  muted: boolean;
  reduceMotion: boolean;
  /**
   * Show illustrations (image plate). Default true. Independent of the
   * server-side asset queue — flipping false just suppresses the visual
   * plate so toggling back on works without re-running the LLM.
   */
  imagesEnabled: boolean;
  /**
   * Play narrator TTS + ambient soundscape. Default true. When false,
   * neither the narrator audio element nor the AmbientSoundscape are
   * mounted, and the NarratorControl chrome is suppressed.
   */
  audioEnabled: boolean;
  /**
   * Play Veo cinematic in the lower slot. Default true. When false,
   * SceneCinematic short-circuits to null regardless of asset readiness.
   * Independent of the `reduceMotion` gate.
   */
  videoEnabled: boolean;
  /**
   * Media-strategy selector (omni-cinematics Req 1). Default
   * "endpoint_cinematic" — the north-star strategy; the server resolver
   * caps it by entitlement / the per-modality gates. Persisted through the
   * mediaPrefs path so it round-trips across devices as
   * `mediaPrefs.cinematicMode`.
   */
  cinematicMode: CinematicMode;
  /**
   * Narrator TTS playback speed. Default 1. Persists across scenes and
   * sessions. The reader UI exposes four discrete options (0.75, 1, 1.25,
   * 1.5); the value is clamped at the hook boundary to a safe range so
   * arbitrary localStorage tampering can't push the audio element into
   * a pitch-distorting extreme.
   */
  narratorPlaybackRate: number;
  /**
   * Render dialogue lines as distinct indented blocks (with an optional
   * speaker label) instead of inline within the prose flow. Default
   * true. Readers who prefer the original single-paragraph rendering
   * can flip this off in settings — the parser is bypassed entirely
   * when false so the visual is identical to the pre-feature behavior.
   */
  dialogBlocksEnabled: boolean;
  /**
   * "Candlelight Focus" immersion (phase-2 quick-win). When true, the reader
   * CHROME (top bar + story ribbon) fades to 0 after ~4s of no input while
   * actively reading; any input restores it instantly. The prose and choices
   * NEVER fade. Default TRUE: it is immersive and low-risk — any touch/scroll/
   * key restores the chrome, and every safety context (open sheet, chapter/
   * ending, candle gutter, soft-signup, streaming) keeps it lit. Reduced-motion
   * snaps instead of animating. Persisted; tolerant parse defaults a missing
   * field to enabled (only an explicit `=== false` turns it off).
   */
  focusMode: boolean;
  /**
   * "Experimental: Desk home" opt-in (the-desk R1.2). When true, the home
   * route renders the diegetic writer's desk instead of the card stack (behind
   * the R1 gate — combined with `EXPO_PUBLIC_DESK_HOME` via `resolveDeskEnabled`
   * in components/home/deskGate.ts; the branch itself lands in Wave 2). Default
   * FALSE — the desk is opt-in and the card home stays the default. Tolerant
   * parse: a missing field (every legacy blob) reads as OFF; only an explicit
   * `=== true` opts in.
   */
  deskHome: boolean;
};

export const NARRATOR_PLAYBACK_RATES: readonly number[] = [0.75, 1, 1.25, 1.5] as const;

export const READER_SETTINGS_KEY = "cyoa.readerSettings.v1";
export const READER_SETTINGS_CHANGED_EVENT = "cyoa.readerSettings.changed";

const defaultSettings: ReaderSettings = {
  theme: "system",
  fontScale: "default",
  hudMode: "full",
  layout: "book",
  muted: false,
  reduceMotion: false,
  imagesEnabled: true,
  audioEnabled: true,
  videoEnabled: true,
  cinematicMode: "endpoint_cinematic",
  narratorPlaybackRate: 1,
  dialogBlocksEnabled: true,
  focusMode: true,
  deskHome: false,
};

export function useReaderSettings() {
  const [settings, setSettings] = useState<ReaderSettings>(defaultSettings);

  useEffect(() => {
    setSettings(readSettings());
  }, []);

  const updateSettings = useCallback(
    (
      patch: Partial<ReaderSettings>,
      // Optional side-effect that receives the post-merge snapshot. Runs
      // inside the setState updater so callers (notably /settings'
      // syncMediaPrefs server echo) always see the latest merged state
      // — even when multiple toggles fire in the same animation frame.
      // Without this, the closed-over `settings` value in each handler
      // ignored sibling updates in flight, so two rapid toggles could
      // race and the server-side prefs ended up with one of the changes
      // dropped.
      onMerged?: (next: ReaderSettings) => void,
    ) => {
      setSettings((current) => {
        const next = { ...current, ...patch };
        writeSettings(next);
        if (onMerged) onMerged(next);
        return next;
      });
    },
    [],
  );

  const resetSettings = useCallback(() => {
    writeSettings(defaultSettings);
    setSettings(defaultSettings);
  }, []);

  return useMemo(
    () => ({
      settings,
      updateSettings,
      resetSettings,
    }),
    [resetSettings, settings, updateSettings],
  );
}

function readSettings(): ReaderSettings {
  const storage = getStorage();
  if (!storage) return defaultSettings;

  try {
    const raw = storage.getItem(READER_SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    return {
      theme: isTheme(parsed.theme) ? parsed.theme : defaultSettings.theme,
      fontScale: parsed.fontScale === "compact" || parsed.fontScale === "large" ? parsed.fontScale : "default",
      hudMode: parsed.hudMode === "quiet" || parsed.hudMode === "hidden" ? parsed.hudMode : "full",
      // NOTE: `layoutMode` ("Chrome: Book/Focus") is RETIRED (reader-chrome-
      // declutter P2/RC11 — it was consumed by nothing). Old persisted blobs
      // may still carry the key; the tolerant field-by-field parse simply drops
      // it (we never spread `parsed`), so legacy settings still load cleanly.
      layout: isLayoutVariant(parsed.layout) ? parsed.layout : defaultSettings.layout,
      muted: parsed.muted === true,
      reduceMotion: parsed.reduceMotion === true,
      // New media gates default to true, so a missing field reads as
      // "enabled". Only an explicit `=== false` flips the gate off.
      imagesEnabled: parsed.imagesEnabled !== false,
      audioEnabled: parsed.audioEnabled !== false,
      videoEnabled: parsed.videoEnabled !== false,
      // Unknown / missing → the endpoint-cinematic default.
      cinematicMode: isCinematicMode(parsed.cinematicMode)
        ? parsed.cinematicMode
        : defaultSettings.cinematicMode,
      // Coerce a stored numeric rate to one of the four allowed steps.
      // Anything missing or out-of-range falls back to the 1x default —
      // we never trust localStorage to deliver a sane float.
      narratorPlaybackRate: isAllowedRate(parsed.narratorPlaybackRate)
        ? (parsed.narratorPlaybackRate as number)
        : defaultSettings.narratorPlaybackRate,
      // Dialog blocks default to on; only an explicit `=== false` flips
      // them off so a missing field reads as enabled.
      dialogBlocksEnabled: parsed.dialogBlocksEnabled !== false,
      // Candlelight focus defaults to on; only an explicit `=== false` flips
      // it off so a missing field (legacy blobs) reads as enabled.
      focusMode: parsed.focusMode !== false,
      // Desk home is opt-in and defaults OFF; only an explicit `=== true` opts
      // in, so a missing field (every legacy blob) tolerantly reads as OFF.
      deskHome: parsed.deskHome === true,
    };
  } catch {
    return defaultSettings;
  }
}

function writeSettings(settings: ReaderSettings): void {
  getStorage()?.setItem(READER_SETTINGS_KEY, JSON.stringify(settings));
  dispatchSettingsChanged(settings);
}

function isTheme(value: unknown): value is ReaderThemePreference {
  return value === "day" || value === "night" || value === "sepia" || value === "system";
}

function isLayoutVariant(value: unknown): value is ReaderLayoutVariant {
  return (READER_LAYOUT_VARIANTS as readonly string[]).includes(value as string);
}

function isCinematicMode(value: unknown): value is CinematicMode {
  return (CINEMATIC_MODES as readonly string[]).includes(value as string);
}

function isAllowedRate(value: unknown): value is number {
  return typeof value === "number" && (NARRATOR_PLAYBACK_RATES as readonly number[]).includes(value);
}


function dispatchSettingsChanged(settings: ReaderSettings): void {
  if (typeof globalThis.dispatchEvent !== "function" || typeof globalThis.CustomEvent !== "function") return;
  globalThis.dispatchEvent(new CustomEvent(READER_SETTINGS_CHANGED_EVENT, { detail: settings }));
}
