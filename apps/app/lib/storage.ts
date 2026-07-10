/**
 * Safe localStorage accessor. Returns null in non-browser environments
 * (SSR / native shells without window.localStorage) so callers degrade to
 * in-memory / no-op behaviour instead of throwing. Previously copy-pasted as a
 * private `getStorage()` in ~10 hooks/components; consolidated here.
 *
 * Returns the widest surface (get/set/remove); callers needing only a subset
 * assign from it structurally.
 */
export function getLocalStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  if (typeof globalThis === "undefined") return null;
  return (globalThis as { localStorage?: Storage }).localStorage ?? null;
}
