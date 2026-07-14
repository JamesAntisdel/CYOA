/**
 * Panel-2 Wave 2 — one-shot "bind this tale to your name" soft-signup ribbon
 * dismissal (panel-review-2: "The turn-3 soft signup prompt — a named
 * product.md target — does not exist"). Persists a single "dismissed" flag with
 * the exact guarded-localStorage discipline as the first-lock coach
 * (`components/choices/lockCoach.ts`) and the reader-layout override
 * (`ReaderScreen.tsx`): best-effort read/write that degrades to
 * "never persisted" on platforms without web storage.
 *
 * The copy lives here so the component and its drift-guard test share one
 * source of truth.
 */
export const SOFT_SIGNUP_DISMISSED_KEY = "cyoa.softSignupDismissed.v1";

/** The turn number at which the ribbon first appears for a guest reader. */
export const SOFT_SIGNUP_TURN = 3;

export const SOFT_SIGNUP_COPY =
  "This tale is written in vanishing ink — guest stories fade after seven days. Bind it to your name and it keeps.";

function webStorage(): Storage | undefined {
  if (typeof globalThis === "undefined") return undefined;
  return (globalThis as { localStorage?: Storage }).localStorage;
}

/** True once the ribbon has been dismissed (any prior session on this device). */
export function hasDismissedSoftSignup(): boolean {
  const storage = webStorage();
  if (!storage) return false;
  try {
    return storage.getItem(SOFT_SIGNUP_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Mark the ribbon dismissed so it never appears again. Best-effort. */
export function markSoftSignupDismissed(): void {
  const storage = webStorage();
  if (!storage) return;
  try {
    storage.setItem(SOFT_SIGNUP_DISMISSED_KEY, "1");
  } catch {
    /* ignore */
  }
}
