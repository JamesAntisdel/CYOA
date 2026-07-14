/**
 * Safe storage accessor.
 *
 * WEB: returns the real `window.localStorage` (synchronous), exactly as
 * before — the live web/tunnel target is unchanged.
 *
 * NATIVE (iOS/Android, Platform.OS !== "web"): `localStorage` does not exist,
 * so the historical implementation returned `null` and every guest-identity /
 * settings read silently degraded to in-memory no-ops — the guest session
 * (and its Convex accountId) vanished on every cold launch.
 *
 * This module now backs native with a SYNCHRONOUS in-memory cache that is
 * hydrated once at boot from `@react-native-async-storage/async-storage`
 * (and, for keys in {@link SECURE_KEYS}, from `expo-secure-store`). The ~10
 * existing call sites assume a synchronous `getItem/setItem/removeItem`
 * surface; the cache preserves that contract:
 *   - `getItem` reads the cache synchronously.
 *   - `setItem` / `removeItem` update the cache synchronously AND write
 *     through to the persistent store asynchronously (fire-and-forget).
 *
 * Callers that run before hydration completes (only the very first frames of
 * a cold launch) should await {@link hydrateStorage} first — `useGuestSession`
 * does this so the restored session reflects on-disk state. Everything after
 * boot reads a warm cache.
 *
 * Returns the widest surface (get/set/remove); callers needing only a subset
 * assign from it structurally.
 */
import { Platform } from "react-native";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Keys that must live in the device keychain / keystore (expo-secure-store)
 * rather than AsyncStorage. The guest token is a bearer credential for the
 * guest's Convex account, so it belongs in secure storage on native. On web
 * it stays in localStorage (there is no secure-store equivalent, and the
 * web contract is unchanged).
 *
 * SecureStore keys must match /^[A-Za-z0-9._-]+$/ — the guest-token key
 * ("cyoa.guestToken.v1") already satisfies this, so it is used verbatim.
 */
export const SECURE_KEYS: ReadonlySet<string> = new Set<string>(["cyoa.guestToken.v1"]);

const isWeb = Platform.OS === "web";

// ---------------------------------------------------------------------------
// Native in-memory cache (unused on web)
// ---------------------------------------------------------------------------
const nativeCache = new Map<string, string>();
let hydrated = isWeb; // web needs no hydration
let hydrationPromise: Promise<void> | null = null;

// Lazily require the native modules so the web bundle/runtime never touches
// them (keeps the web export self-contained and avoids web-shim edge cases in
// expo-secure-store).
function asyncStorage(): {
  getAllKeys: () => Promise<readonly string[]>;
  multiGet: (keys: readonly string[]) => Promise<readonly [string, string | null][]>;
  setItem: (k: string, v: string) => Promise<void>;
  removeItem: (k: string) => Promise<void>;
} {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("@react-native-async-storage/async-storage").default;
}

function secureStore(): {
  getItemAsync: (k: string) => Promise<string | null>;
  setItemAsync: (k: string, v: string) => Promise<void>;
  deleteItemAsync: (k: string) => Promise<void>;
} {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("expo-secure-store");
}

async function doHydrate(): Promise<void> {
  try {
    const AS = asyncStorage();
    const keys = await AS.getAllKeys();
    const plainKeys = keys.filter((k) => !SECURE_KEYS.has(k));
    if (plainKeys.length > 0) {
      const entries = await AS.multiGet(plainKeys);
      for (const [k, v] of entries) {
        // Don't clobber a value a synchronous write set after hydration began.
        if (v != null && !nativeCache.has(k)) nativeCache.set(k, v);
      }
    }
  } catch {
    // AsyncStorage unavailable (e.g. bare test env) — leave cache empty.
  }
  try {
    const SS = secureStore();
    for (const k of SECURE_KEYS) {
      try {
        const v = await SS.getItemAsync(k);
        if (v != null && !nativeCache.has(k)) nativeCache.set(k, v);
      } catch {
        // ignore per-key secure-store failures
      }
    }
  } catch {
    // expo-secure-store unavailable — ignore.
  }
  hydrated = true;
}

/**
 * Idempotent boot hydration for native. Resolves immediately on web (there is
 * nothing to hydrate — localStorage is already synchronous). Safe to call
 * multiple times; the underlying read runs once.
 */
export function hydrateStorage(): Promise<void> {
  if (isWeb || hydrated) return Promise.resolve();
  if (!hydrationPromise) hydrationPromise = doHydrate();
  return hydrationPromise;
}

/** Whether the native cache has finished its one-time boot hydration. */
export function isStorageHydrated(): boolean {
  return hydrated;
}

function writeThrough(key: string, value: string): void {
  if (SECURE_KEYS.has(key)) {
    try {
      void secureStore().setItemAsync(key, value).catch(() => undefined);
    } catch {
      // ignore
    }
    return;
  }
  try {
    void asyncStorage().setItem(key, value).catch(() => undefined);
  } catch {
    // ignore
  }
}

function removeThrough(key: string): void {
  if (SECURE_KEYS.has(key)) {
    try {
      void secureStore().deleteItemAsync(key).catch(() => undefined);
    } catch {
      // ignore
    }
    return;
  }
  try {
    void asyncStorage().removeItem(key).catch(() => undefined);
  } catch {
    // ignore
  }
}

const nativeStorage: StorageLike = {
  getItem(key: string): string | null {
    return nativeCache.has(key) ? (nativeCache.get(key) as string) : null;
  },
  setItem(key: string, value: string): void {
    nativeCache.set(key, value);
    writeThrough(key, value);
  },
  removeItem(key: string): void {
    nativeCache.delete(key);
    removeThrough(key);
  },
};

export function getLocalStorage(): StorageLike | null {
  if (isWeb) {
    if (typeof globalThis === "undefined") return null;
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  }
  // Native: the synchronous cache always exists; it is empty until
  // hydration completes but never throws.
  return nativeStorage;
}

// Kick off hydration at module load (app boot) on native so the cache is
// warm by the time React mounts. `useGuestSession` also awaits this before
// its first read to be robust against the (tiny) boot race.
if (!isWeb) {
  void hydrateStorage();
}
