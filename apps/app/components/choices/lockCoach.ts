/**
 * First-lock coach (locked-UX polish): the very first time a reader ever sees
 * a locked choice, a one-shot inline line beneath the row explains that locked
 * pages are doors, not dead ends. Shown once EVER, persisted with the same
 * reader-settings localStorage discipline as `READER_LAYOUT_OVERRIDE_KEY` in
 * `ReaderScreen.tsx` — a guarded, best-effort read/write that degrades to
 * "never persisted" on platforms without web storage. No modal (tome voice,
 * inline only); the copy lives here so tests and the component share one
 * source of truth.
 */
export const LOCK_COACH_SEEN_KEY = "cyoa.lockCoachSeen.v1";

export const LOCK_COACH_COPY =
  "Locked pages can be opened — the story will show you how.";

function webStorage(): Storage | undefined {
  if (typeof globalThis === "undefined") return undefined;
  return (globalThis as { localStorage?: Storage }).localStorage;
}

/** True once the coach has been shown (any prior session on this device). */
export function hasSeenLockCoach(): boolean {
  const storage = webStorage();
  if (!storage) return false;
  try {
    return storage.getItem(LOCK_COACH_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** Mark the coach as shown so it never appears again. Best-effort. */
export function markLockCoachSeen(): void {
  const storage = webStorage();
  if (!storage) return;
  try {
    storage.setItem(LOCK_COACH_SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}
