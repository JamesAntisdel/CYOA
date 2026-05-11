import { useCallback, useEffect, useMemo, useState } from "react";

import { authClient, notifyBetterAuthSessionChanged, subscribeBetterAuthSession } from "../lib/authClient";
import { isConvexAuthConfigured } from "../lib/authConfig";
import {
  getAuthSession,
  signInWithEmail,
  signOut as clearAuthSession,
  signUpWithEmail,
  subscribeAuthSession,
  type AuthSession,
  type EmailAuthInput,
} from "../lib/localAuth";

type AuthState =
  | { status: "loading"; session: null }
  | { status: "ready"; session: AuthSession | null };

export function useAuthSession() {
  if (isConvexAuthConfigured()) {
    return useBetterAuthSession();
  }
  return useLocalAuthSession();
}

function useLocalAuthSession() {
  const [state, setState] = useState<AuthState>({ status: "loading", session: null });

  useEffect(() => {
    const refresh = () => {
      setState({ status: "ready", session: getAuthSession() });
    };
    refresh();
    return subscribeAuthSession(refresh);
  }, []);

  const signUp = useCallback((input: EmailAuthInput) => {
    const session = signUpWithEmail(input);
    setState({ status: "ready", session });
    return session;
  }, []);

  const signIn = useCallback((input: EmailAuthInput) => {
    const session = signInWithEmail(input);
    setState({ status: "ready", session });
    return session;
  }, []);

  const signOut = useCallback(() => {
    clearAuthSession();
    setState({ status: "ready", session: null });
  }, []);

  return useMemo(
    () => ({
      ...state,
      signUp,
      signIn,
      signOut,
    }),
    [signIn, signOut, signUp, state],
  );
}

function useBetterAuthSession() {
  const [state, setState] = useState<AuthState>({ status: "loading", session: null });

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void readBetterAuthSession().then((session) => {
        if (!cancelled) setState({ status: "ready", session });
      });
    };
    refresh();
    const unsubscribe = subscribeBetterAuthSession(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const signUp = useCallback(async (input: EmailAuthInput) => {
    const result = await authClient.signUp.email({
      email: input.email,
      name: input.name?.trim() || input.email.split("@")[0] || "Reader",
      password: input.password,
    });
    if (result.error) throw new Error(result.error.message ?? "sign_up_failed");
    const session = sessionFromBetterAuth(result.data, input);
    if (!session) throw new Error("session_unavailable");
    setState({ status: "ready", session });
    notifyBetterAuthSessionChanged();
    return session;
  }, []);

  const signIn = useCallback(async (input: EmailAuthInput) => {
    const result = await authClient.signIn.email({
      email: input.email,
      password: input.password,
    });
    if (result.error) throw new Error(result.error.message ?? "sign_in_failed");
    const session = sessionFromBetterAuth(result.data, input);
    if (!session) throw new Error("session_unavailable");
    setState({ status: "ready", session });
    notifyBetterAuthSessionChanged();
    return session;
  }, []);

  const signOut = useCallback(async () => {
    await authClient.signOut();
    setState({ status: "ready", session: null });
    notifyBetterAuthSessionChanged();
  }, []);

  return useMemo(
    () => ({
      ...state,
      signUp,
      signIn,
      signOut,
    }),
    [signIn, signOut, signUp, state],
  );
}

async function readBetterAuthSession(): Promise<AuthSession | null> {
  const result = await authClient.getSession();
  return sessionFromBetterAuth(result.data, undefined);
}

function sessionFromBetterAuth(data: unknown, input?: EmailAuthInput): AuthSession | null {
  const maybeData = data as {
    session?: { createdAt?: Date | string | number };
    user?: { id?: string; email?: string; name?: string | null };
  } | null;
  const user = maybeData?.user;
  if (!user?.id || !user.email) return null;

  return {
    userId: user.id,
    email: user.email,
    name: user.name?.trim() || input?.name?.trim() || user.email.split("@")[0] || "Reader",
    ageBand: input?.ageBand ?? "18+",
    signedInAt: normalizeSessionDate(maybeData?.session?.createdAt) ?? Date.now(),
  };
}

function normalizeSessionDate(value: Date | string | number | undefined): number | undefined {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}
