import { useEffect, useState } from "react";

import { getRemoteSceneMedia, hasRemoteGameApi, type RemoteSceneMedia } from "../lib/gameApi";

const FAST_POLL_MS = 1500;
const SLOW_POLL_MS = 60_000;
// After ~18s (12 polls at 1.5s) without any non-null status we assume the
// save has no remote assets at all — drop to a slow heartbeat so we don't
// hammer Convex for nothing.
const MAX_QUICK_POLLS = 12;
// First N polls stay at FAST_POLL_MS even on null; beyond that we
// exponentially back off until reaching SLOW_POLL_MS.
const QUICK_NULL_POLLS = 4;
// Image is ready but narrator hasn't arrived — keep polling fast for up
// to this many ticks (~60s at 1.5s/poll) before assuming TTS silently
// failed and falling back to SLOW_POLL_MS. Chirp 3 HD typically takes
// 10–15s on full scenes, so 40 polls gives a comfortable headroom.
const MAX_NARRATOR_WAIT_POLLS = 40;

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
 *   - Fast (1.5s) while the asset is queued or generating.
 *   - Fast for the first ~4 null polls (asset may not have inserted yet).
 *   - Exponential backoff (1.5s → 3s → 6s → 12s → 24s → SLOW_POLL_MS)
 *     when the status keeps coming back null, capped at SLOW_POLL_MS.
 *   - After MAX_QUICK_POLLS without ever seeing a status, drop to the
 *     slow interval permanently and log a one-line warn.
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
    // the image was already ready. Caps the fast-poll loop so a silent
    // TTS failure doesn't hammer Convex forever.
    let narratorWaitPolls = 0;
    let warnedNarratorWaitExhausted = false;

    const nextDelay = (next: RemoteSceneMedia | null): number => {
      if (next) sawStatus = true;
      const inFlight = next && (next.status === "queued" || next.status === "generating");
      if (inFlight) {
        nullStreak = 0;
        return FAST_POLL_MS;
      }
      // Narrator (TTS) generates AFTER the SSE stream completes, so its
      // arrival often lags the image by 10-15s with premium voices. Keep
      // polling fast while the visual is ready but the narrator hasn't
      // landed yet — otherwise we'd fall back to SLOW_POLL_MS and the
      // user waits up to a minute for audio to start. Cap at
      // MAX_NARRATOR_WAIT_POLLS so a silent TTS failure (key revoked,
      // API blocked, etc.) doesn't pin polling fast forever.
      if (next && next.status === "ready" && !next.narrator) {
        nullStreak = 0;
        narratorWaitPolls += 1;
        if (narratorWaitPolls > MAX_NARRATOR_WAIT_POLLS) {
          if (!warnedNarratorWaitExhausted) {
            warnedNarratorWaitExhausted = true;
            // eslint-disable-next-line no-console
            console.warn(
              `[useSceneMedia] narrator wait exhausted after ${MAX_NARRATOR_WAIT_POLLS} fast polls for save ${saveId}; backing off`,
            );
          }
          return SLOW_POLL_MS;
        }
        return FAST_POLL_MS;
      }
      // Reset narrator-wait counter whenever narrator arrives or status
      // transitions away from ready (e.g. a new scene starts queued).
      narratorWaitPolls = 0;
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
        setMedia(next);
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
