import { useCallback, useEffect, useRef, useState } from "react";

import {
  getRemoteAdminSaveDetail,
  getRemoteAdminSaves,
  getRemoteAdminStories,
  getRemoteAdminUserDetail,
  getRemoteAdminUsers,
  promoteUserAdmin,
  type AdminSaveDetail,
  type AdminSaveListItem,
  type AdminStory,
  type AdminUserDetail,
  type AdminUserListItem,
} from "../lib/adminApi";
import { guestAuthArgs, useGuestSession } from "./useGuestSession";

/**
 * Data hooks for the admin content browser (product.md operator intent, Req 27).
 *
 * Each mirrors the dashboard's gate trick: the server refuses non-admins, so a
 * non-null result is itself proof of admin. `status` distinguishes the three
 * render states every board draws:
 *   - "loading"    — the first fetch is in flight (nothing to show yet),
 *   - "ready"      — authorized; `items` holds the (possibly empty) page,
 *   - "unavailable"— unreachable OR the caller isn't an admin; keep it closed.
 * A "ready" + empty `items` is the empty state; "unavailable" is the retry/gate.
 */
export type AdminContentStatus = "loading" | "ready" | "unavailable";

// --- Stories -------------------------------------------------------------

export function useAdminStories(): {
  status: AdminContentStatus;
  stories: AdminStory[];
  reload: () => void;
} {
  const guest = useGuestSession();
  const accountId = guest.session?.accountId ?? null;
  const [status, setStatus] = useState<AdminContentStatus>("loading");
  const [stories, setStories] = useState<AdminStory[]>([]);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!accountId) {
      setStatus("loading");
      return undefined;
    }
    let cancelled = false;
    setStatus("loading");
    void getRemoteAdminStories({ accountId, ...guestAuthArgs() }).then((result) => {
      if (cancelled) return;
      if (result === null) {
        setStatus("unavailable");
        return;
      }
      setStories(result);
      setStatus("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { status, stories, reload };
}

// --- Generic paged list --------------------------------------------------

type PagedFetcher<T> = (input: {
  accountId: string;
  guestTokenHash?: string;
  cursor?: string | null;
  limit?: number;
}) => Promise<{ page: T[]; cursor: string | null; isDone: boolean } | null>;

type PagedState<T> = {
  status: AdminContentStatus;
  items: T[];
  isDone: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  reload: () => void;
};

function usePagedList<T>(fetcher: PagedFetcher<T>): PagedState<T> {
  const guest = useGuestSession();
  const accountId = guest.session?.accountId ?? null;
  const [status, setStatus] = useState<AdminContentStatus>("loading");
  const [items, setItems] = useState<T[]>([]);
  const [isDone, setIsDone] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nonce, setNonce] = useState(0);
  const cursorRef = useRef<string | null>(null);

  // First page (and reload).
  useEffect(() => {
    if (!accountId) {
      setStatus("loading");
      return undefined;
    }
    let cancelled = false;
    setStatus("loading");
    cursorRef.current = null;
    void fetcher({ accountId, ...guestAuthArgs() }).then((result) => {
      if (cancelled) return;
      if (result === null) {
        setStatus("unavailable");
        return;
      }
      setItems(result.page);
      setIsDone(result.isDone);
      cursorRef.current = result.cursor;
      setStatus("ready");
    });
    return () => {
      cancelled = true;
    };
    // fetcher is a stable module function; accountId + nonce drive refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, nonce]);

  const loadMore = useCallback(() => {
    if (!accountId || isDone || loadingMore || cursorRef.current === null) return;
    setLoadingMore(true);
    void fetcher({ accountId, ...guestAuthArgs(), cursor: cursorRef.current }).then((result) => {
      setLoadingMore(false);
      if (result === null) return;
      setItems((prev) => [...prev, ...result.page]);
      setIsDone(result.isDone);
      cursorRef.current = result.cursor;
    });
  }, [accountId, isDone, loadingMore, fetcher]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { status, items, isDone, loadingMore, loadMore, reload };
}

// --- Saves ---------------------------------------------------------------

export function useAdminSaves(): PagedState<AdminSaveListItem> {
  return usePagedList<AdminSaveListItem>(getRemoteAdminSaves);
}

// --- Users (list + inline promote toggle) --------------------------------

export function useAdminUsers(): PagedState<AdminUserListItem> & {
  promote: (targetAccountId: string, isAdmin: boolean) => Promise<boolean>;
} {
  const guest = useGuestSession();
  const accountId = guest.session?.accountId ?? null;
  const base = usePagedList<AdminUserListItem>(getRemoteAdminUsers);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const promote = useCallback(
    async (targetAccountId: string, isAdmin: boolean): Promise<boolean> => {
      if (!accountId) return false;
      const result = await promoteUserAdmin({
        accountId,
        ...guestAuthArgs(),
        targetAccountId,
        isAdmin,
      });
      if (!result) return false;
      // Optimistically reflect the new claim without a full reload.
      setOverrides((prev) => ({ ...prev, [targetAccountId]: result.isAdmin }));
      return true;
    },
    [accountId],
  );

  // Apply local promote overrides over the fetched page.
  const items = base.items.map((user) =>
    user.accountId in overrides ? { ...user, isAdmin: overrides[user.accountId]! } : user,
  );

  return { ...base, items, promote };
}

// --- Drill-in detail -----------------------------------------------------

export function useAdminSaveDetail(saveId: string | null): {
  status: "idle" | "loading" | "ready" | "unavailable";
  detail: AdminSaveDetail | null;
} {
  const guest = useGuestSession();
  const accountId = guest.session?.accountId ?? null;
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [detail, setDetail] = useState<AdminSaveDetail | null>(null);

  useEffect(() => {
    if (!saveId || !accountId) {
      setStatus("idle");
      setDetail(null);
      return undefined;
    }
    let cancelled = false;
    setStatus("loading");
    void getRemoteAdminSaveDetail({ accountId, ...guestAuthArgs(), saveId }).then((result) => {
      if (cancelled) return;
      if (result === null) {
        setStatus("unavailable");
        setDetail(null);
        return;
      }
      setDetail(result);
      setStatus("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [saveId, accountId]);

  return { status, detail };
}

export function useAdminUserDetail(targetAccountId: string | null): {
  status: "idle" | "loading" | "ready" | "unavailable";
  detail: AdminUserDetail | null;
} {
  const guest = useGuestSession();
  const accountId = guest.session?.accountId ?? null;
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);

  useEffect(() => {
    if (!targetAccountId || !accountId) {
      setStatus("idle");
      setDetail(null);
      return undefined;
    }
    let cancelled = false;
    setStatus("loading");
    void getRemoteAdminUserDetail({ accountId, ...guestAuthArgs(), targetAccountId }).then(
      (result) => {
        if (cancelled) return;
        if (result === null) {
          setStatus("unavailable");
          setDetail(null);
          return;
        }
        setDetail(result);
        setStatus("ready");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [targetAccountId, accountId]);

  return { status, detail };
}
