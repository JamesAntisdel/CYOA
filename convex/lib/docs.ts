import type { AccountRecord } from "../account";

/**
 * Strip undefined-valued keys from a patch object. Convex's `db.patch` clears a
 * field when it's explicitly set to `undefined`; filtering those keys means an
 * omitted-value field is left unchanged instead. Previously copy-pasted in
 * game.ts, accountFunctions.ts, creatorFunctions.ts, and billingFunctions.ts.
 */
export function cleanDoc<T extends Record<string, unknown>>(doc: T): T {
  return Object.fromEntries(Object.entries(doc).filter(([, value]) => value !== undefined)) as T;
}

/**
 * Coerce a raw Convex account document into an AccountRecord (stringifies the
 * `_id`). Note: the media modules (sceneMedia.ts / npcMedia.ts) keep their own
 * field-normalizing variant intentionally; this is the plain pass-through used
 * by game.ts, accountFunctions.ts, and creatorFunctions.ts.
 */
export function accountFromDoc(doc: Record<string, unknown>): AccountRecord {
  return { ...doc, _id: String(doc._id) } as AccountRecord;
}
