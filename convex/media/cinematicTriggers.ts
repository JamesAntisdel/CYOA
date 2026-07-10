// Pure cinematic-trigger detection for the omni-cinematics pipeline.
//
// P1 + P2 scope. Triggers that fire:
//
//   - `ending`  — the highest-value trigger. Fires when a save reaches a
//                 terminal ending (death / success / safe). Detected next to
//                 the existing `recordEndingUnlock` sites in game.ts.
//   - `opening` — an establishing title sequence. Per C3 it fires AFTER the
//                 turn-1 protagonist/setting anchors land (NOT at save
//                 creation — a save-creation trigger would always be
//                 reference-less), and only once (dedupe handled at the
//                 queue site via the `by_save_kind` index).
//   - `chapter` — (P2, C1-compliant) a SERVER turn-number cadence stinger.
//                 Fires every `CHAPTER_CINEMATIC_TURNS` completed turns. This
//                 is explicitly NOT the client's `CHAPTER_TURNS = 4` notion
//                 (which is computed from localStorage and invisible to
//                 Convex); it is a pure `turnNumber % N` server cadence, capped
//                 per run (Req 8.2) via `MAX_CHAPTER_CINEMATICS_PER_RUN`.
//
// Deliberately NOT here (deferred):
//   - arc-beat triggers (C2 — Req 32 arc-beat state is unbuilt).
//
// Everything in this module is side-effect free so the read-loop / queue
// handlers can call it and the unit tests can pin the contract without a
// live Convex DB.

/**
 * SERVER chapter-cinematic cadence (P2, build-correction C1). A `chapter`
 * cinematic is eligible every this-many COMPLETED turns. Deliberately larger
 * than the client `CHAPTER_TURNS = 4` (useTurn.ts) so stingers stay rare/earned
 * — the client notion is a localStorage read Convex cannot see, so we use our
 * own server cadence instead of trying to mirror it.
 */
export const CHAPTER_CINEMATIC_TURNS = 6;

/**
 * Per-run cap on `chapter` cinematics (Req 8.2). At most this many chapter
 * stingers are produced across a single run, regardless of how many cadence
 * boundaries are crossed, so total video spend stays bounded.
 */
export const MAX_CHAPTER_CINEMATICS_PER_RUN = 2;

/** Minimal save shape the trigger predicates read. */
export type CinematicTriggerSave = {
  turnNumber?: number;
  anchorProtagonistAssetId?: string | undefined;
  anchorSettingAssetId?: string | undefined;
};

/** Terminal shape emitted by the engine / safety classifier at an ending. */
export type CinematicTerminal =
  | { kind?: string; endingId?: string }
  | null
  | undefined;

/**
 * Ending trigger (Req 2.4). Returns `"ending"` when the turn resolved to a
 * terminal the reader just reached, else `null`. Kind-agnostic on purpose:
 * death, success, and safety-forced safe exits all earn the movie of the
 * playthrough. The queue site decides Pro / strategy eligibility + dedupe.
 */
export function detectEndingCinematicTrigger(
  _save: CinematicTriggerSave,
  terminal: CinematicTerminal,
): "ending" | null {
  if (!terminal) return null;
  // A terminal with neither a kind nor an endingId is a malformed shape we
  // don't treat as a real ending (defensive — the engine always carries at
  // least one, but game.ts hands us `v.any()`-shaped data on some paths).
  if (!terminal.kind && !terminal.endingId) return null;
  return "ending";
}

/**
 * Opening trigger gate (Req 2.1 as corrected by C3). Returns true once the
 * turn-1 anchor(s) have landed — i.e. the save row carries at least one anchor
 * asset id (protagonist preferred; setting is a bonus reference). The reader is
 * already reading turn 1 by this point; the title sequence upgrades in behind
 * them.
 *
 * NOTE: the "…AND no opening cinematic yet" half of C3 is enforced at the
 * queue site (`queueEndpointCinematic`) via the `by_save_kind` dedupe — it
 * needs a DB read, so it can't live in this pure predicate. Keeping the gate
 * pure lets the anchor-settle reschedule loop test it directly.
 */
export function shouldFireOpeningCinematic(save: CinematicTriggerSave): boolean {
  return Boolean(save.anchorProtagonistAssetId || save.anchorSettingAssetId);
}

/**
 * Chapter trigger (P2, build-correction C1). Returns `"chapter"` when the
 * COMPLETED turn number lands on the server cadence boundary
 * (`turnNumber % CHAPTER_CINEMATIC_TURNS === 0`, turnNumber > 0), else `null`.
 *
 * NOTE: this is a pure `turnNumber` cadence, NOT the client `CHAPTER_TURNS`
 * localStorage notion (C1). The opening turn (turnNumber 0) never matches. The
 * queue site enforces the per-run cap (Req 8.2) + dedupe; this predicate only
 * decides cadence eligibility so it stays testable without a DB.
 */
export function detectChapterCinematicTrigger(
  save: { turnNumber?: number },
): "chapter" | null {
  const turn = save.turnNumber;
  if (typeof turn !== "number" || !Number.isFinite(turn) || turn <= 0) return null;
  if (turn % CHAPTER_CINEMATIC_TURNS !== 0) return null;
  return "chapter";
}

/** A cinematic asset row, as read back off the `by_save_kind` index. */
export type CinematicAssetLike = {
  kind?: string;
  status?: string;
  cinematicTrigger?: string | undefined;
  endingId?: string | undefined;
  sceneId?: string | undefined;
};

/**
 * Dedupe predicate (Req 2.5, C5). Given the save's existing cinematic assets,
 * decide whether a NON-failed cinematic already exists for this
 * `(trigger[, endingId])` key — in which case the queue site must skip.
 *
 * Keyed by `(saveId, trigger)` for openings and `(saveId, trigger, endingId)`
 * for endings. Per C5 cinematics are keyed to the SAVE, so a repeat playthrough
 * that reaches the same ending in a DIFFERENT save produces its own asset (that
 * save has no prior cinematic). `failed` rows never block a re-queue.
 */
export function cinematicAlreadyExists(
  existing: ReadonlyArray<CinematicAssetLike>,
  key: { trigger: "opening" | "ending"; endingId?: string | undefined },
): boolean {
  return existing.some((asset) => {
    if (asset.kind !== "cinematic") return false;
    if (asset.status === "failed") return false;
    if (asset.cinematicTrigger !== key.trigger) return false;
    if (key.trigger === "ending") {
      // Endings are keyed by endingId too so distinct endings in the same
      // save each get their own cinematic. Treat both-absent as a match so a
      // legacy row without an endingId still dedupes.
      return (asset.endingId ?? undefined) === (key.endingId ?? undefined);
    }
    return true;
  });
}

/**
 * Count the save's NON-failed `chapter` cinematics (Req 8.2 cap enforcement).
 * The queue site skips a new chapter stinger once this reaches
 * `MAX_CHAPTER_CINEMATICS_PER_RUN`, so the cadence can fire many times but only
 * the first K produce a cinematic.
 */
export function countChapterCinematics(
  existing: ReadonlyArray<CinematicAssetLike>,
): number {
  return existing.reduce((n, asset) => {
    if (asset.kind !== "cinematic") return n;
    if (asset.status === "failed") return n;
    if (asset.cinematicTrigger !== "chapter") return n;
    return n + 1;
  }, 0);
}

/**
 * Dedupe a chapter stinger by the SCENE it fires at. Chapters are keyed by
 * `(saveId, trigger, sceneId)` — distinct cadence boundaries are distinct
 * scenes, so this only blocks a double-fire at the SAME scene (e.g. a retried
 * turn re-running the completion path), not the next cadence boundary. Absent
 * `sceneId` never matches (nothing to dedupe against).
 */
export function chapterCinematicExistsForScene(
  existing: ReadonlyArray<CinematicAssetLike>,
  sceneId: string | undefined,
): boolean {
  if (!sceneId) return false;
  return existing.some((asset) => {
    if (asset.kind !== "cinematic") return false;
    if (asset.status === "failed") return false;
    if (asset.cinematicTrigger !== "chapter") return false;
    return asset.sceneId === sceneId;
  });
}
