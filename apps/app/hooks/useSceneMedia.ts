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

    const nextDelay = (next: RemoteSceneMedia | null): number => {
      if (next) sawStatus = true;
      const inFlight = next && (next.status === "queued" || next.status === "generating");
      if (inFlight) {
        nullStreak = 0;
        return FAST_POLL_MS;
      }
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
      // Terminal state (ready / blocked / failed): keep subscribed but slow.
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
  }, [saveId, auth?.accountId, auth?.guestTokenHash]);

  return media;
}
