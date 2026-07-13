import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

import { getLocalStorage as getStorage, hydrateStorage } from "../lib/storage";
import { createId } from "../lib/ids";

import type { AgeBand } from "@cyoa/shared";

import { createRemoteGuestAccount, hasRemoteGameApi } from "../lib/gameApi";

export type AgeSelection = AgeBand | "under_13";

export type GuestSession = {
  accountId: string;
  kind: "guest";
  ageBand: AgeBand;
  createdAt: number;
  lastActiveAt: number;
};

type GuestSessionState =
  | { status: "loading"; session: null; blocked: false; error: null }
  | { status: "ready"; session: GuestSession | null; blocked: false; error: null }
  | { status: "blocked"; session: null; blocked: true; error: string }
  | { status: "error"; session: null; blocked: false; error: string };

const GUEST_SESSION_KEY = "cyoa.guestSession.v1";
const GUEST_TOKEN_KEY = "cyoa.guestToken.v1";

export function getGuestTokenHash(): string | null {
  return getStorage()?.getItem(GUEST_TOKEN_KEY) ?? null;
}

export function guestAuthArgs(): { guestTokenHash?: string } {
  const token = getGuestTokenHash();
  return token ? { guestTokenHash: token } : {};
}

export function useGuestSession() {
  const [state, setState] = useState<GuestSessionState>({
    status: "loading",
    session: null,
    blocked: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // NATIVE: storage.ts hydrates its synchronous cache from AsyncStorage /
      // expo-secure-store asynchronously at boot. Await it here so the
      // restored guest session (and its Convex accountId + guest token)
      // reflects on-disk state on a cold launch instead of reading an empty
      // cache and minting a throwaway identity. On web this resolves
      // immediately (localStorage is already synchronous).
      if (Platform.OS !== "web") {
        await hydrateStorage();
        if (cancelled) return;
      }

      const restored = readStoredSession();
      setState({ status: "ready", session: restored, blocked: false, error: null });

      if (!restored || !hasRemoteGameApi()) return;

      const remote = await createRemoteGuestAccount({
        ageSelection: restored.ageBand,
        guestTokenHash: getOrCreateGuestToken(),
      });
      if (cancelled || !remote) return;
      const session: GuestSession = {
        accountId: remote.account.accountId,
        kind: "guest",
        ageBand: remote.account.ageBand,
        createdAt: restored.createdAt,
        lastActiveAt: Date.now(),
      };
      writeStoredSession(session);
      // Avoid a redundant setState when the server-issued session is content-
      // equal to what we just restored from localStorage. Each setState
      // produces a new `state` object whose `session` reference differs even
      // when its fields match — downstream effects (notably `useTurn`'s
      // mount-effect, keyed on `guest.session`) then re-run, opening a
      // second SSE stream that races the first and pollutes the scene with
      // the deterministic-fallback premise echo. Only ignore identity
      // changes here; meaningful diffs (a new accountId, an age-band swap)
      // still flow through.
      setState((current) => {
        const prev = current.session;
        if (
          current.status === "ready" &&
          prev &&
          prev.accountId === session.accountId &&
          prev.ageBand === session.ageBand &&
          prev.kind === session.kind
        ) {
          return current;
        }
        return { status: "ready", session, blocked: false, error: null };
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const createGuestSession = useCallback(async (ageSelection: AgeSelection) => {
    if (ageSelection === "under_13") {
      clearStoredSession();
      setState({
        status: "blocked",
        session: null,
        blocked: true,
        error: "The story is only available for ages 13 and older.",
      });
      return null;
    }

    const now = Date.now();
    const existing = readStoredSession();
    // When remote is configured, REQUIRE a server-issued accountId — never
    // persist a local UUID fallback because every subsequent Convex call
    // will then fail v.id("accounts") validation, bricking the session.
    // If the remote call returns null (network blip, mid-restart, etc.),
    // surface an error and let the user retry rather than silently writing
    // a doomed accountId to localStorage.
    if (hasRemoteGameApi()) {
      const remote = await createRemoteGuestAccount({
        ageSelection,
        guestTokenHash: getOrCreateGuestToken(),
      });
      if (!remote) {
        setState({
          status: "error",
          session: null,
          blocked: false,
          error: "Could not reach the server. Try again in a moment.",
        });
        return null;
      }
      const session: GuestSession = {
        accountId: remote.account.accountId,
        kind: "guest",
        ageBand: remote.account.ageBand,
        createdAt: existing?.createdAt ?? now,
        lastActiveAt: now,
      };
      writeStoredSession(session);
      setState({ status: "ready", session, blocked: false, error: null });
      return session;
    }

    // Pure local-only mode (no Convex configured). Local UUID is fine here
    // because nothing will be sent to the server.
    const session: GuestSession = {
      accountId: existing?.accountId ?? createId("guest"),
      kind: "guest",
      ageBand: ageSelection,
      createdAt: existing?.createdAt ?? now,
      lastActiveAt: now,
    };
    writeStoredSession(session);
    setState({ status: "ready", session, blocked: false, error: null });
    return session;
  }, []);

  const restoreGuestSession = useCallback(() => {
    const restored = readStoredSession();
    setState({ status: "ready", session: restored, blocked: false, error: null });
    return restored;
  }, []);

  const clearGuestSession = useCallback(() => {
    clearStoredSession();
    setState({ status: "ready", session: null, blocked: false, error: null });
  }, []);

  return useMemo(
    () => ({
      ...state,
      createGuestSession,
      restoreGuestSession,
      clearGuestSession,
    }),
    [clearGuestSession, createGuestSession, restoreGuestSession, state],
  );
}

function readStoredSession(): GuestSession | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(GUEST_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GuestSession>;
    if (
      parsed.kind !== "guest" ||
      typeof parsed.accountId !== "string" ||
      (parsed.ageBand !== "13-17" && parsed.ageBand !== "18+") ||
      typeof parsed.createdAt !== "number" ||
      typeof parsed.lastActiveAt !== "number"
    ) {
      return null;
    }
    return {
      accountId: parsed.accountId,
      kind: "guest",
      ageBand: parsed.ageBand,
      createdAt: parsed.createdAt,
      lastActiveAt: parsed.lastActiveAt,
    };
  } catch {
    return null;
  }
}

function writeStoredSession(session: GuestSession): void {
  getStorage()?.setItem(GUEST_SESSION_KEY, JSON.stringify(session));
}

function clearStoredSession(): void {
  const storage = getStorage();
  storage?.removeItem(GUEST_SESSION_KEY);
  storage?.removeItem(GUEST_TOKEN_KEY);
}

function getOrCreateGuestToken(): string {
  const storage = getStorage();
  const existing = storage?.getItem(GUEST_TOKEN_KEY);
  if (existing) return existing;
  const token = createId("guest_token");
  storage?.setItem(GUEST_TOKEN_KEY, token);
  return token;
}


