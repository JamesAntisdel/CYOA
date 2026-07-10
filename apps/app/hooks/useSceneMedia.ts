import { useEffect, useState } from "react";

import { getRemoteSceneMedia, hasRemoteGameApi, type RemoteSceneMedia } from "../lib/gameApi";

const FAST_POLL_MS = 1500;
const SLOW_POLL_MS = 60_000;
// Exponential backoff ladder used while the asset is in a non-terminal
// state (queued / generating, OR image-ready-but-narrator-still-pending).
// Cheap first polls catch fast jobs (Imagen placeholder ~instant; live
// Imagen ~3-8s); the 5s cap matches the rough end of Veo's tail without
// hammering Convex if a job stalls. Index past the end clamps to the
// final entry so a stuck job never recovers a faster cadence.
//
// Concretely: 500ms → 1s → 2s → 4s → 5s, then every 5s after that.
const GENERATING_BACKOFF_MS = [500, 1000, 2000, 4000, 5000] as const;
// After ~18s (12 polls at 1.5s) without any non-null status we assume the
// save has no remote assets at all — drop to a slow heartbeat so we don't
// hammer Convex for nothing.
const MAX_QUICK_POLLS = 12;
// First N polls stay at FAST_POLL_MS even on null; beyond that we
// exponentially back off until reaching SLOW_POLL_MS.
const QUICK_NULL_POLLS = 4;
// Image is ready but narrator hasn't arrived — keep polling on the
// generating-backoff ladder for up to this many ticks before assuming TTS
// silently failed and falling back to SLOW_POLL_MS. Chirp 3 HD typically
// takes 10-15s on full scenes; at the capped 5s/poll near the tail of
// the backoff ladder, 40 polls gives well over a minute of headroom.
const MAX_NARRATOR_WAIT_POLLS = 40;

/**
 * Pick the next poll delay for a "still working" asset. `count` is the
 * number of consecutive in-flight polls so far (1 on the first such
 * tick). Clamps past the end of the ladder so a long-tail job stays at
 * the cap rather than wrapping back to fast.
 */
function generatingBackoff(count: number): number {
  if (count <= 0) return GENERATING_BACKOFF_MS[0];
  const idx = Math.min(count - 1, GENERATING_BACKOFF_MS.length - 1);
  // Non-null assertion is safe — idx is clamped into the array bounds
  // above. Cast also satisfies the readonly tuple → number widening.
  return GENERATING_BACKOFF_MS[idx] as number;
}

/**
 * Byte-identity check on the polled media projection. `getRemoteSceneMedia`
 * returns a fresh object every poll, so `setMedia(next)` would otherwise
 * churn a new reference into every consumer (ReaderScreen's
 * `projectionWithLiveMedia` spreads into a new projection → entire Layout
 * subtree re-renders, MediaPlate re-keys its image, fades restart).
 * Deep-equal short-circuits at the hook boundary so React skips the
 * re-render when the polled data hasn't actually changed.
 *
 * The shape is shallow — `kind`/`status`/`uri`/`videoUri`/`imageUri`/`alt`
 * are primitives; `narrator` is `{id, uri, voiceId}`; `ambient` is the
 * loop record. A primitive-key comparison handles every meaningful flip;
 * we don't need a full deep walk.
 */
function sceneMediaEqual(
  a: RemoteSceneMedia | null,
  b: RemoteSceneMedia | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.status !== b.status) return false;
  if (a.kind !== b.kind) return false;
  if (a.uri !== b.uri) return false;
  if (a.alt !== b.alt) return false;
  if (a.durationMs !== b.durationMs) return false;
  if (a.imageUri !== b.imageUri) return false;
  if (a.videoUri !== b.videoUri) return false;
  if (a.videoPending !== b.videoPending) return false;
  if (a.nodeId !== b.nodeId) return false;
  if ((a.narrator?.uri ?? null) !== (b.narrator?.uri ?? null)) return false;
  if ((a.narrator?.id ?? null) !== (b.narrator?.id ?? null)) return false;
  if ((a.narrator?.voiceId ?? null) !== (b.narrator?.voiceId ?? null)) return false;
  if ((a.ambient?.uri ?? null) !== (b.ambient?.uri ?? null)) return false;
  if ((a.ambient?.id ?? null) !== (b.ambient?.id ?? null)) return false;
  return true;
}

// Local-only demo / seed saves never have remote media. Duplicates the
// predicate from useTurn.ts to avoid an extra import surface.
function isLocalDemoSave(saveId: string): boolean {
  return (
    saveId === "safe-ending" ||
    saveId === "pro-media" ||
    saveId === "training-room-demo" ||
    saveId === "training-room" ||
    saveId.startsWith("creator_seed_")
  );
}

/**
 * Polls Convex for the media projection attached to a save's current
 * scene. Keeps polling while the asset is queued/generating; backs off
 * to "subscribe but slow" once the asset is ready/blocked/failed.
 *
 * Polling discipline:
 *   - Exponential backoff (500ms → 1s → 2s → 4s → 5s cap) while the
 *     asset is queued or generating, OR while it is ready-but-narrator-
 *     pending. The ladder catches fast jobs cheaply and tops out at a
 *     5s cap so a stuck job doesn't hammer Convex.
 *   - Fast (1.5s) for the first ~4 null polls (asset may not have
 *     inserted yet).
 *   - Exponential backoff (1.5s → 3s → 6s → 12s → 24s → SLOW_POLL_MS)
 *     when the status keeps coming back null, capped at SLOW_POLL_MS.
 *   - After MAX_QUICK_POLLS without ever seeing a status, drop to the
 *     slow interval permanently and log a one-line warn.
 *   - Terminal states (ready+narrator, blocked, failed) settle at
 *     SLOW_POLL_MS — kept subscribed in case the projection changes
 *     server-side, but at a cost-cheap heartbeat.
 *
 * Returns `null` when no remote backend is wired (local-only dev) or
 * when the save is a local demo / creator-seed, so the caller can fall
 * back to the in-projection media field.
 */
export function useSceneMedia(
  saveId: string | undefined,
  auth?: { accountId: string; guestTokenHash?: string | undefined },
  // Current scene id. When this changes mid-save (user picked a choice and
  // advanced), the polling state resets so the new scene's queued media
  // is picked up within FAST_POLL_MS instead of waiting up to SLOW_POLL_MS
  // for the previous scene's settled backoff to expire.
  sceneId?: string,
): RemoteSceneMedia | null {
  const [media, setMedia] = useState<RemoteSceneMedia | null>(null);

  useEffect(() => {
    if (!saveId || !hasRemoteGameApi()) {
      setMedia(null);
      return;
    }
    // Auth is now required server-side. Without an accountId we silently
    // skip — the caller is responsible for waiting on a guest session
    // before mounting this hook.
    if (!auth?.accountId) {
      setMedia(null);
      return;
    }
    // Short-circuit demo / seed saves — they never have remote assets, so
    // polling for them just spins the network for no benefit.
    if (isLocalDemoSave(saveId)) {
      setMedia(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Tracks consecutive null responses since we last saw a non-null
    // status. Used to gate fast→slow backoff.
    let nullStreak = 0;
    // Total polls since mount (capped by MAX_QUICK_POLLS).
    let pollCount = 0;
    let sawStatus = false;
    let warnedExhausted = false;
    // Tracks how many polls we've spent waiting on a narrator URL after
    // the image was already ready. Caps the generating-backoff loop so
    // a silent TTS failure doesn't hammer Convex forever.
    let narratorWaitPolls = 0;
    let warnedNarratorWaitExhausted = false;
    // Tracks consecutive in-flight (queued/generating OR ready-narrator-
    // pending) polls so generatingBackoff() can climb the ladder. Reset
    // whenever the status leaves those states.
    let inFlightStreak = 0;

    const nextDelay = (next: RemoteSceneMedia | null): number => {
      if (next) sawStatus = true;
      const inFlight = next && (next.status === "queued" || next.status === "generating");
      if (inFlight) {
        nullStreak = 0;
        inFlightStreak += 1;
        return generatingBackoff(inFlightStreak);
      }
      // Narrator (TTS) generates AFTER the SSE stream completes, so its
      // arrival often lags the image by 10-15s with premium voices. Keep
      // polling on the generating-backoff ladder while the visual is
      // ready but the narrator hasn't landed yet — otherwise we'd fall
      // back to SLOW_POLL_MS and the user waits up to a minute for audio
      // to start. Cap at MAX_NARRATOR_WAIT_POLLS so a silent TTS failure
      // (key revoked, API blocked, etc.) doesn't pin polling fast
      // forever.
      if (next && next.status === "ready" && !next.narrator) {
        nullStreak = 0;
        narratorWaitPolls += 1;
        inFlightStreak += 1;
        if (narratorWaitPolls > MAX_NARRATOR_WAIT_POLLS) {
          if (!warnedNarratorWaitExhausted) {
            warnedNarratorWaitExhausted = true;
            // eslint-disable-next-line no-console
            console.warn(
              `[useSceneMedia] narrator wait exhausted after ${MAX_NARRATOR_WAIT_POLLS} polls for save ${saveId}; backing off`,
            );
          }
          // Reset the streak when we abandon the fast ladder. If the asset
          // later flips back to generating (Veo re-queue, model retry),
          // generatingBackoff() should start at 500 ms again instead of
          // the 5 s cap that a stale streak would force.
          inFlightStreak = 0;
          return SLOW_POLL_MS;
        }
        return generatingBackoff(inFlightStreak);
      }
      // Reset narrator-wait + in-flight counters whenever narrator
      // arrives or status transitions away from ready (e.g. a new scene
      // starts queued — that resets via the saveId/sceneId dep).
      narratorWaitPolls = 0;
      inFlightStreak = 0;
      if (!next) {
        nullStreak += 1;
        if (pollCount >= MAX_QUICK_POLLS && !sawStatus) {
          if (!warnedExhausted) {
            warnedExhausted = true;
            // eslint-disable-next-line no-console
            console.warn(
              `[useSceneMedia] no remote media after ${MAX_QUICK_POLLS} polls for save ${saveId}; backing off to ${SLOW_POLL_MS}ms`,
            );
          }
          return SLOW_POLL_MS;
        }
        if (nullStreak <= QUICK_NULL_POLLS) return FAST_POLL_MS;
        const backoff = FAST_POLL_MS * 2 ** (nullStreak - QUICK_NULL_POLLS);
        return Math.min(backoff, SLOW_POLL_MS);
      }
      // Terminal state (ready / blocked / failed) AND narrator settled:
      // keep subscribed but slow.
      nullStreak = 0;
      return SLOW_POLL_MS;
    };

    const tick = async () => {
      try {
        const next = await getRemoteSceneMedia({
          saveId,
          accountId: auth.accountId,
          ...(auth.guestTokenHash ? { guestTokenHash: auth.guestTokenHash } : {}),
        });
        if (cancelled) return;
        // Skip the setState (and the cascade through ReaderScreen's
        // `projectionWithLiveMedia` merge) when the polled projection is
        // byte-identical to the last one. Without this, every ~500ms-5s
        // poll churned a fresh `liveMedia` reference and re-rendered the
        // entire Layout subtree — restarting MediaPlate fades and
        // re-keying images mid-scene.
        setMedia((prev) => (sceneMediaEqual(prev, next) ? prev : next));
        pollCount += 1;
        timer = setTimeout(tick, nextDelay(next));
      } catch {
        if (!cancelled) timer = setTimeout(tick, FAST_POLL_MS * 2);
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [saveId, auth?.accountId, auth?.guestTokenHash, sceneId]);

  return media;
}
