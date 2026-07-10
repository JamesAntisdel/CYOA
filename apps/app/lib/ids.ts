/**
 * Generate a prefixed unique id, e.g. `createId("turn")` → "turn_<uuid>".
 * Uses crypto.randomUUID when available, falling back to a Math.random suffix
 * in environments that lack it. Previously copy-pasted as a private
 * `createId`/`createRequestId` in several hooks and lib modules.
 */
export function createId(prefix: string): string {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${random}`;
}
