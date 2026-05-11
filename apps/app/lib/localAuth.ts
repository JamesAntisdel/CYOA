import type { AgeBand } from "@cyoa/shared";
import { emailAuthRequestSchema } from "@cyoa/shared";

export type AuthSession = {
  userId: string;
  email: string;
  name: string;
  ageBand: AgeBand;
  signedInAt: number;
};

export type EmailAuthInput = {
  email: string;
  password: string;
  name?: string;
  ageBand?: AgeBand;
};

const USERS_KEY = "cyoa.authUsers.v1";
const SESSION_KEY = "cyoa.authSession.v1";
const authListeners = new Set<() => void>();

type StoredUser = {
  userId: string;
  email: string;
  name: string;
  ageBand: AgeBand;
  passwordVerifier: string;
  createdAt: number;
};

type StoredUsers = Record<string, StoredUser>;

export function getAuthSession(): AuthSession | null {
  const raw = getStorage()?.getItem(SESSION_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (
      typeof parsed.userId !== "string" ||
      typeof parsed.email !== "string" ||
      typeof parsed.name !== "string" ||
      (parsed.ageBand !== "13-17" && parsed.ageBand !== "18+") ||
      typeof parsed.signedInAt !== "number"
    ) {
      return null;
    }
    return {
      userId: parsed.userId,
      email: parsed.email,
      name: parsed.name,
      ageBand: parsed.ageBand,
      signedInAt: parsed.signedInAt,
    };
  } catch {
    return null;
  }
}

export function signUpWithEmail(input: EmailAuthInput): AuthSession {
  const parsed = emailAuthRequestSchema.parse(input);
  if (!parsed.ageBand) throw new Error("age_band_required");

  const users = readUsers();
  if (users[parsed.email]) throw new Error("email_already_registered");

  const now = Date.now();
  const user: StoredUser = {
    userId: createId("user"),
    email: parsed.email,
    name: parsed.name ?? parsed.email.split("@")[0] ?? "Reader",
    ageBand: parsed.ageBand,
    passwordVerifier: createLocalPasswordVerifier(parsed.password),
    createdAt: now,
  };
  writeUsers({ ...users, [user.email]: user });
  return writeSession(user, now);
}

export function signInWithEmail(input: EmailAuthInput): AuthSession {
  const parsed = emailAuthRequestSchema.omit({ name: true, ageBand: true }).parse(input);
  const user = readUsers()[parsed.email];
  if (!user || user.passwordVerifier !== createLocalPasswordVerifier(parsed.password)) {
    throw new Error("invalid_email_or_password");
  }

  return writeSession(user, Date.now());
}

export function signOut(): void {
  getStorage()?.removeItem(SESSION_KEY);
  notifyAuthListeners();
}

export function clearLocalAuth(): void {
  const storage = getStorage();
  storage?.removeItem(SESSION_KEY);
  storage?.removeItem(USERS_KEY);
  notifyAuthListeners();
}

export function subscribeAuthSession(listener: () => void): () => void {
  authListeners.add(listener);
  return () => {
    authListeners.delete(listener);
  };
}

function writeSession(user: StoredUser, signedInAt: number): AuthSession {
  const session: AuthSession = {
    userId: user.userId,
    email: user.email,
    name: user.name,
    ageBand: user.ageBand,
    signedInAt,
  };
  getStorage()?.setItem(SESSION_KEY, JSON.stringify(session));
  notifyAuthListeners();
  return session;
}

function notifyAuthListeners(): void {
  authListeners.forEach((listener) => listener());
}

function readUsers(): StoredUsers {
  const raw = getStorage()?.getItem(USERS_KEY);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as StoredUsers;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, user]) => isStoredUser(user)),
    );
  } catch {
    return {};
  }
}

function writeUsers(users: StoredUsers): void {
  getStorage()?.setItem(USERS_KEY, JSON.stringify(users));
}

function isStoredUser(value: Partial<StoredUser>): value is StoredUser {
  return (
    typeof value.userId === "string" &&
    typeof value.email === "string" &&
    typeof value.name === "string" &&
    (value.ageBand === "13-17" || value.ageBand === "18+") &&
    typeof value.passwordVerifier === "string" &&
    typeof value.createdAt === "number"
  );
}

function createLocalPasswordVerifier(password: string): string {
  // Local development only. Real credentials must be handled by the server auth provider.
  return `local:${password}`;
}

function getStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  if (typeof globalThis === "undefined") return null;
  return (globalThis as { localStorage?: Storage }).localStorage ?? null;
}

function createId(prefix: string): string {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${random}`;
}
