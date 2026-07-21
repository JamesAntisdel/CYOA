import { useCallback, useEffect, useState } from "react";

import { guestAuthArgs } from "./useGuestSession";
import {
  getRemoteRunHistory,
  hasRemoteGameApi,
  type RemoteRunHistory,
} from "../lib/gameApi";

/**
 * Fetch state for a run's turn-history read-back. Extracted verbatim from
 * the `/read/[saveId]/history` archive route so the archive view and the
 * `/read/[saveId]/book` read-as-books view load history through ONE code
 * path and can never diverge (reading-modes R2.9).
 */
export type RunHistoryState =
  | { status: "loading" }
  | { status: "ready"; history: RemoteRunHistory }
  | { status: "empty" }
  | { status: "error"; message: string };

/**
 * `useRunHistory` — the shared load hook behind both the scene-archive
 * route and the read-as-books route.
 *
 * It is a READ-ONLY surface: it only ever calls `getRemoteRunHistory`
 * (`game:getRunHistory`, owner-authed + entitlement-free — reading-modes
 * RM9) and issues NO mutation. Rewind / trim-the-tail lives in the archive
 * route on top of `reload`, NOT in this hook, so the book route that
 * consumes the same hook stays write-free by construction.
 *
 * Signature mirrors the archive route's original inline logic exactly:
 *  - missing `saveId` → `error`
 *  - `accountId` not yet resolved → stays `loading` (no fetch)
 *  - no remote backend wired → `empty`
 *  - fetch failure / null → `error`
 *
 * `reload` re-runs the fetch (the archive route calls it after a rewind).
 */
export function useRunHistory(accountId: string | undefined, saveId: string) {
  const [state, setState] = useState<RunHistoryState>({ status: "loading" });

  const loadHistory = useCallback(async () => {
    if (!saveId) {
      setState({ status: "error", message: "Missing save id." });
      return;
    }
    if (!accountId) return;
    if (!hasRemoteGameApi()) {
      setState({ status: "empty" });
      return;
    }
    try {
      const history = await getRemoteRunHistory({
        accountId,
        saveId,
        ...guestAuthArgs(),
      });
      if (!history) {
        setState({
          status: "error",
          message: "Could not load this run’s history.",
        });
        return;
      }
      setState({ status: "ready", history });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error loading history.";
      setState({ status: "error", message });
    }
  }, [accountId, saveId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await loadHistory();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadHistory]);

  return { state, reload: loadHistory };
}
