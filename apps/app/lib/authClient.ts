import { authBaseUrl } from "./authConfig";
import { getErrorMessage, readJson } from "./authHttp";

type BetterAuthUser = {
  id: string;
  email: string;
  name?: string | null;
};

type BetterAuthSession = {
  id?: string;
  createdAt?: Date | string | number;
};

export type BetterAuthSessionData = {
  user: BetterAuthUser;
  session: BetterAuthSession;
};

type AuthResult<T> = Promise<{ data: T | null; error: { message?: string } | null }>;

const betterAuthListeners = new Set<() => void>();

export const authClient = {
  signUp: {
    email: (input: { email: string; password: string; name: string }): AuthResult<BetterAuthSessionData> =>
      authFetch("/sign-up/email", { method: "POST", body: input }),
  },
  signIn: {
    email: (input: { email: string; password: string }): AuthResult<BetterAuthSessionData> =>
      authFetch("/sign-in/email", { method: "POST", body: input }),
  },
  signOut: (): AuthResult<unknown> => authFetch("/sign-out", { method: "POST", body: {} }),
  getSession: (): AuthResult<BetterAuthSessionData> => authFetch("/get-session", { method: "GET" }),
  convex: {
    token: (): AuthResult<{ token: string }> => authFetch("/convex/token", { method: "GET" }),
  },
};

export function subscribeBetterAuthSession(listener: () => void): () => void {
  betterAuthListeners.add(listener);
  return () => {
    betterAuthListeners.delete(listener);
  };
}

export function notifyBetterAuthSessionChanged(): void {
  betterAuthListeners.forEach((listener) => listener());
}

async function authFetch<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: Record<string, unknown> },
): AuthResult<T> {
  try {
    const requestInit: RequestInit = {
      credentials: "include",
      method: init.method,
      ...(init.body ? { body: JSON.stringify(init.body), headers: { "content-type": "application/json" } } : {}),
    };
    const response = await fetch(`${authBaseUrl.replace(/\/+$/, "")}/api/auth${path}`, {
      ...requestInit,
    });
    const data = await readJson(response);
    if (!response.ok) {
      return { data: null, error: { message: getErrorMessage(data) ?? `auth_http_${response.status}` } };
    }
    return { data: data as T, error: null };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : "auth_request_failed" } };
  }
}

