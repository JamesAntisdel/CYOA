import { useEffect, useMemo, useState } from "react";

import { guestAuthArgs } from "./useGuestSession";
import { hasRemoteGameApi } from "../lib/gameApi";
import {
  listRemoteSaveCinematics,
  pickEndingCinematic,
  type RemoteCinematicView,
} from "../lib/cinematicApi";

/**
 * useTrophyCinematics — aggregates ending cinematics across the reader's
 * terminal saves into a `Record<endingId, RemoteCinematicView>` for the
 * trophy crypt (omni-cinematics Req 7.3, Build Correction C5).
 *
 * Cinematics are per-SAVE (C5), so the crypt fans out over the reader's
 * finished runs and keeps the best (ready-first, then in-flight) cinematic
 * per `endingId`. This lets a "★ cinematic ready" affordance and inline
 * playback attach to each unlocked ending regardless of which save produced
 * the movie. Best-effort: any transport failure degrades to no cinematic for
 * that save (the trophy still renders from its unlock row).
 *
 * The fetch re-runs when the account or the set of terminal saves changes.
 * `terminalSaveIds` is collapsed to a stable join key so a fresh array
 * identity each render doesn't thrash the effect.
 */
export function useTrophyCinematics(
  accountId: string | undefined,
  terminalSaveIds: readonly string[],
): Record<string, RemoteCinematicView> {
  const [byEndingId, setByEndingId] = useState<Record<string, RemoteCinematicView>>({});

  // Stable dependency: the sorted, de-duplicated save id set. Sorting keeps
  // the key invariant to array ordering churn from upstream re-sorts.
  const saveIdKey = useMemo(
    () => Array.from(new Set(terminalSaveIds)).sort().join(","),
    [terminalSaveIds],
  );

  useEffect(() => {
    let cancelled = false;
    const saveIds = saveIdKey.length > 0 ? saveIdKey.split(",") : [];
    if (!accountId || !hasRemoteGameApi() || saveIds.length === 0) {
      setByEndingId({});
      return;
    }

    void Promise.all(
      saveIds.map((saveId) =>
        listRemoteSaveCinematics({ accountId, saveId, ...guestAuthArgs() }),
      ),
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, RemoteCinematicView> = {};
      for (const views of results) {
        for (const view of views ?? []) {
          if (view.cinematicTrigger !== "ending" || !view.endingId) continue;
          const existing = map[view.endingId];
          // Prefer a ready cinematic over an in-flight one so the crypt shows
          // the playable movie the moment any of the reader's saves lands it.
          if (!existing || (view.status === "ready" && existing.status !== "ready")) {
            const best = pickEndingCinematic([view], view.endingId);
            if (best) map[view.endingId] = best;
          }
        }
      }
      setByEndingId(map);
    });

    return () => {
      cancelled = true;
    };
  }, [accountId, saveIdKey]);

  return byEndingId;
}
