import { useEffect, useState } from "react";

import { convexClient } from "../lib/convex";
import { guestAuthArgs } from "./useGuestSession";

// Polling cadence. Portraits move through queued → generating → ready in
// ~3-10s on Pro Imagen, so we poll fast until we hit a terminal state, then
// stop. Failure is also terminal (the UI shows the initials placeholder).
//
// Mirrors the polling strategy in `useSceneMedia.ts` but is simpler — NPC
// portraits don't have a "narrator lags the image" sub-state, and a save
// can have many NPCs in parallel so we want to drop to "subscribed but
// quiet" sooner once each is resolved.
const FAST_POLL_MS = 1500;
const SLOW_POLL_MS = 60_000;
// After this many consecutive null returns (no asset row at all) we assume
// the portrait was never queued (Free tier, malformed npc, etc) and stop.
const MAX_NULL_POLLS = 12;

type NpcPortraitResponse = {
  assetId: string;
  npcId: string;
  status: "queued" | "generating" | "ready" | "failed";
  url: string | null;
} | null;

/**
 * Resolve the displayable portrait URL for one NPC. Returns null while the
 * portrait is queued / generating / unavailable; returns the URL string once
 * the Imagen job finishes successfully.
 *
 * Polling matches the rest of the app — see `apps/app/lib/gameApi.ts` for
 * the rationale. The Convex anonymous local backend's WS handshake is
 * unreliable so all reads go through the HTTP `/api/query` endpoint. That
 * means this hook can't piggyback on Convex's React subscriptions; it
 * spins up its own `setTimeout` polling loop with fast→slow backoff.
 *
 * No-op (returns null forever) when:
 *   - no Convex backend is wired (local-only dev),
 *   - the caller hasn't yet resolved an accountId/saveId/npcId (guest
 *     session loading, no NPC roster yet), or
 *   - the portrait is in a permanent terminal state (failed, or never
 *     queued because the account isn't Pro).
 */
export function useNpcPortraitUrl(input: {
  accountId: string | null | undefined;
  saveId: string | null | undefined;
  npcId: string | null | undefined;
}): string | null {
  const { accountId, saveId, npcId } = input;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!convexClient || !accountId || !saveId || !npcId) {
      setUrl(null);
      return;
    }
    const baseUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
    if (!baseUrl) {
      setUrl(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let nullStreak = 0;
    let settled = false;

    const tick = async () => {
      try {
        const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/query`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            path: "media/npcMedia:getNpcPortraitUrl",
            args: {
              accountId,
              saveId,
              npcId,
              ...guestAuthArgs(),
            },
            format: "json",
          }),
          cache: "no-store",
          keepalive: false,
          credentials: "include",
        });
        if (cancelled) return;
        if (!res.ok) {
          timer = setTimeout(tick, SLOW_POLL_MS);
          return;
        }
        const data = (await res.json()) as { status?: string; value?: NpcPortraitResponse };
        if (cancelled) return;
        if (data.status !== "success") {
          timer = setTimeout(tick, SLOW_POLL_MS);
          return;
        }
        const value = data.value ?? null;
        if (!value) {
          nullStreak += 1;
          if (nullStreak >= MAX_NULL_POLLS) {
            // Give up — most likely never queued (Free tier / despawned).
            settled = true;
            return;
          }
          timer = setTimeout(tick, FAST_POLL_MS);
          return;
        }
        nullStreak = 0;
        if (value.status === "ready" && value.url) {
          setUrl(value.url);
          settled = true;
          return;
        }
        if (value.status === "failed") {
          // Terminal failure — UI falls back to initials placeholder.
          settled = true;
          return;
        }
        // queued / generating — keep polling fast.
        timer = setTimeout(tick, FAST_POLL_MS);
      } catch {
        if (cancelled) return;
        timer = setTimeout(tick, FAST_POLL_MS * 2);
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      void settled;
    };
  }, [accountId, saveId, npcId]);

  return url;
}
