import { convexHttp } from "./convexHttp";

/**
 * Client transport for the omni-cinematics feature. Mirrors the small
 * per-feature `*Api.ts` modules (see `endingsApi.ts`): a thin typed wrapper
 * over the canonical `convexHttp` transport that returns `null` on any
 * transport failure so callers degrade gracefully to the legacy still.
 *
 * The server query (`media/cinematicFunctions:getSaveCinematics`) is built by the
 * media-pipeline agent. The view shape below is coded defensively — every
 * field except `assetId`/`cinematicTrigger`/`status` is optional so a
 * partially-populated projection (URL not yet hosted, no poster frame,
 * audio track absent) never trips a runtime error on the client.
 */

export type CinematicStatus =
  | "queued"
  | "generating"
  | "ready"
  | "failed"
  | "blocked";

/**
 * Endpoint that produced a cinematic. The server now also emits `"chapter"`
 * (a turn-number cadence stinger); the client widens the union so those
 * rows round-trip through `listRemoteSaveCinematics` without being dropped
 * at the boundary. Only `"ending"` triggers surface in the trophy crypt /
 * ending screen (`pickEndingCinematic`); `"opening"`/`"chapter"` are carried
 * for the reader/opening-title surfaces and ignored elsewhere.
 */
export type CinematicTrigger = "opening" | "ending" | "chapter";

/**
 * One cinematic view for a save. Keyed to the SAVE (Build Correction C5):
 * ending cinematics are `assets` rows carrying `saveId`, and a repeat
 * playthrough of the same ending produces a distinct row, so a save may
 * carry several ending cinematics over its lifetime.
 */
export type RemoteCinematicView = {
  assetId: string;
  cinematicTrigger: CinematicTrigger;
  /** Present on ending cinematics — links back to the unlocked ending. */
  endingId?: string;
  /** Hosted video URL. Absent until `status === "ready"`. */
  url?: string;
  status: CinematicStatus;
  /** Whether the cinematic carries Omni native synchronized audio. */
  hasAudio?: boolean;
  /** Poster still (first frame / key beat) shown before playback. */
  posterUrl?: string;
  /**
   * When the Omni job fell back (safety block, timeout, download failure) the
   * server marks the asset ready with a STILL and sets this to "still" — so
   * `url` is an image, NOT a playable video. The reader surface uses this to
   * render the still as a poster (no play control) rather than mis-loading it
   * into a `<video>`. Absent ⇒ a real generated cinematic.
   */
  fallbackKind?: string;
};

/**
 * Fetch the cinematics attached to a single save. Returns `null` when the
 * remote backend is unreachable so the reader / trophy-crypt surfaces can
 * fall back to the existing endpoint still.
 */
// The server query returns `{ cinematics: ServerCinematicView[] }` with a
// `trigger` field and null-for-absent (not undefined). Adapt it here — the API
// boundary — to the client's optional-field `RemoteCinematicView` so every
// consumer (CinematicMoment, endings screen, pickEndingCinematic) stays
// unchanged. convexHttp does not validate the response shape, so this mapping
// is what actually reconciles the client↔server contract at runtime.
type ServerCinematicView = {
  assetId: string;
  status: CinematicStatus;
  trigger: CinematicTrigger | null;
  endingId: string | null;
  url: string | null;
  hasAudio: boolean;
  fallbackKind: string | null;
};

export async function listRemoteSaveCinematics(input: {
  accountId: string;
  saveId: string;
  guestTokenHash?: string;
}): Promise<RemoteCinematicView[] | null> {
  const result = await convexHttp<{ cinematics: ServerCinematicView[] }>(
    "query",
    // Registered path includes the `media/` dir (the function lives in
    // convex/media/cinematicFunctions.ts) — without it the deployment returns
    // "Could not find public function" and no cinematic ever reaches the client.
    "media/cinematicFunctions:getSaveCinematics",
    input as unknown as Record<string, unknown>,
  );
  if (!result || !Array.isArray(result.cinematics)) return null;
  return result.cinematics
    // Only cinematics with a known trigger are renderable here.
    .filter((v): v is ServerCinematicView & { trigger: CinematicTrigger } => v.trigger !== null)
    .map((v) => ({
      assetId: v.assetId,
      cinematicTrigger: v.trigger,
      status: v.status,
      ...(v.endingId ? { endingId: v.endingId } : {}),
      ...(v.url ? { url: v.url } : {}),
      hasAudio: v.hasAudio === true,
      ...(v.fallbackKind ? { fallbackKind: v.fallbackKind } : {}),
    }));
}

/**
 * Pick the ending cinematic worth surfacing from a save's cinematic list.
 * Prefers a ready cinematic, then an in-flight (queued/generating) one so
 * the reader sees the four-state loading pattern upgrade in place. Ignores
 * failed/blocked rows and non-ending triggers. Optionally narrows to a
 * specific `endingId` when the caller knows which ending fired.
 */
export function pickEndingCinematic(
  views: readonly RemoteCinematicView[] | null | undefined,
  endingId?: string,
): RemoteCinematicView | null {
  if (!views || views.length === 0) return null;
  const endings = views.filter(
    (v) =>
      v.cinematicTrigger === "ending" &&
      (endingId === undefined || v.endingId === undefined || v.endingId === endingId),
  );
  if (endings.length === 0) return null;
  const ready = endings.find((v) => v.status === "ready" && Boolean(v.url));
  if (ready) return ready;
  const inFlight = endings.find(
    (v) => v.status === "queued" || v.status === "generating",
  );
  return inFlight ?? null;
}

/**
 * Pick the single cinematic worth surfacing for a given trigger (opening title
 * or chapter stinger). Prefers a ready one, then an in-flight one (so the
 * four-state loader upgrades in place), then a failed/blocked one LAST so the
 * reader surface can show the failure/still-fallback state instead of silence.
 */
function pickByTrigger(
  views: readonly RemoteCinematicView[] | null | undefined,
  trigger: CinematicTrigger,
): RemoteCinematicView | null {
  if (!views || views.length === 0) return null;
  const matches = views.filter((v) => v.cinematicTrigger === trigger);
  if (matches.length === 0) return null;
  return (
    matches.find((v) => v.status === "ready" && Boolean(v.url)) ??
    matches.find((v) => v.status === "queued" || v.status === "generating") ??
    matches.find((v) => v.status === "failed" || v.status === "blocked") ??
    null
  );
}

/** The opening title cinematic for a save, if any. */
export function pickOpeningCinematic(
  views: readonly RemoteCinematicView[] | null | undefined,
): RemoteCinematicView | null {
  return pickByTrigger(views, "opening");
}

/** The most recent chapter-stinger cinematic for a save, if any. */
export function pickChapterCinematic(
  views: readonly RemoteCinematicView[] | null | undefined,
): RemoteCinematicView | null {
  return pickByTrigger(views, "chapter");
}

/** Whether a cinematic ended in a fallback still (safety block / timeout). */
export function isCinematicFallback(
  view: RemoteCinematicView | null | undefined,
): boolean {
  return Boolean(view?.fallbackKind) || view?.status === "failed" || view?.status === "blocked";
}

/**
 * Whether a cinematic is still being produced — used to decide whether the
 * client should keep polling for an in-place upgrade.
 */
export function isCinematicInFlight(
  view: RemoteCinematicView | null | undefined,
): boolean {
  return view?.status === "queued" || view?.status === "generating";
}
