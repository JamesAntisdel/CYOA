import { useCallback, useEffect, useMemo, useState } from "react";

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
    const restored = readStoredSession();
    setState({ status: "ready", session: restored, blocked: false, error: null });

    if (!restored || !hasRemoteGameApi()) return undefined;

    let cancelled = false;
    void createRemoteGuestAccount({
      ageSelection: restored.ageBand,
      guestTokenHash: getOrCreateGuestToken(),
    }).then((remote) => {
      if (cancelled || !remote) return;
      const session: GuestSession = {
        accountId: remote.account.accountId,
        kind: "guest",
        ageBand: remote.account.ageBand,
        createdAt: restored.createdAt,
        lastActiveAt: Date.now(),
      };
      writeStoredSession(session);
      setState({ status: "ready", session, blocked: false, error: null });
    });

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
          status: "ready",
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

function getStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  if (typeof globalThis === "undefined") return null;
  const maybeStorage = (globalThis as { localStorage?: Storage }).localStorage;
  return maybeStorage ?? null;
}

function createId(prefix: string): string {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${random}`;
}
