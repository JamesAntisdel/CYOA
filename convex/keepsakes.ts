// =============================================================================
// Keepsakes (Requirement 12, W3). Pure helpers for the "the tome remembers"
// loop: an ending mints a keepsake (either LLM-proposed or ending-derived),
// it persists on the `endings_unlocked` row (dedup by id, account-scoped), and
// a future run may carry exactly one back in as a tagged inventory item.
//
// These functions are pure (no ctx, no Date.now) so they unit-test cheaply and
// the server (recordEndingUnlock / createSave, in the reserved game.ts) calls
// them at the DB boundary. Text-policy (`evaluateTextPolicy`) is applied by the
// caller BEFORE persistence (R16.2); these only clamp length + reject empties.
// =============================================================================

import { slugify } from "@cyoa/engine";

/** A minted keepsake as it persists on `endings_unlocked.keepsake`. */
export type Keepsake = {
  id: string;
  label: string;
  description: string;
};

/** Analytics event name — fired when an ending grants a keepsake (R16.1). */
export const KEEPSAKE_GRANTED = "keepsake.granted";
/** Analytics event name — fired when a save carries a keepsake in (R16.1). */
export const KEEPSAKE_CARRIED = "keepsake.carried";

/** Clamps mirror the LLM schema (`llm.ts` keepsakeSchema): label ≤48, desc ≤160. */
const LABEL_MAX = 48;
const DESCRIPTION_MAX = 160;
const ID_MAX = 64;

function clampLen(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Ending-derived default keepsake (Requirement 12.1) — used when the terminal
 * scene proposal omits (or malforms) its own keepsake. `id` slugs the ending
 * id; `label` comes from the ending label; `description` prefers the ending
 * `hint`, else a themed fallback naming the label. Deterministic + total:
 * a blank ending label yields a stable "keepsake" fallback rather than an
 * empty keepsake.
 */
export function deriveDefaultKeepsake(ending: {
  id: string;
  label: string;
  hint?: string;
}): Keepsake {
  const slug = slugify(asTrimmedString(ending.id) || asTrimmedString(ending.label) || "keepsake");
  const id = slug.length > 0 ? clampLen(slug, ID_MAX) : "keepsake";
  const rawLabel = asTrimmedString(ending.label);
  const label = clampLen(rawLabel.length > 0 ? rawLabel : "A keepsake", LABEL_MAX);
  const hint = asTrimmedString(ending.hint);
  const description = clampLen(
    hint.length > 0 ? hint : `A token from "${label}" — an echo of another life.`,
    DESCRIPTION_MAX,
  );
  return { id, label, description };
}

/**
 * Validate + clamp a raw (LLM-proposed) keepsake into a canonical shape, or
 * return null when it cannot be salvaged (missing/blank id, label, or
 * description). Never throws. The id is sluggified so it matches the
 * ending-derived default id space for dedupe. Length clamps mirror the schema.
 */
export function validateKeepsake(raw: unknown): Keepsake | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const slug = slugify(asTrimmedString(obj.id));
  const label = asTrimmedString(obj.label);
  const description = asTrimmedString(obj.description);
  if (slug.length === 0 || label.length === 0 || description.length === 0) return null;
  return {
    id: clampLen(slug, ID_MAX),
    label: clampLen(label, LABEL_MAX),
    description: clampLen(description, DESCRIPTION_MAX),
  };
}

/**
 * Streak-milestone interval (days). Panel-2 Wave 3: a Daily streak mints a
 * keepsake every 7 unbroken days (7, 14, 21 …) — 7 is the headline reward, and
 * the recurring cadence keeps the loop rewarding for long-streak readers.
 */
export const STREAK_KEEPSAKE_INTERVAL = 7;

/**
 * The reward keepsake for reaching a Daily streak of `streakCount` days, or null
 * when `streakCount` is not a positive multiple of `STREAK_KEEPSAKE_INTERVAL`.
 * Pure + deterministic + reward-shaped: the id is unique per milestone so a
 * 7-day and a 14-day keepsake both persist (dedupe keys off id). The reward IS
 * gameplay — the keepsake is carriable into a future run like any other
 * ("story first"). All copy is all-ages. Length clamps mirror the schema.
 */
export function streakKeepsake(streakCount: number): Keepsake | null {
  if (!Number.isFinite(streakCount)) return null;
  const n = Math.floor(streakCount);
  if (n < STREAK_KEEPSAKE_INTERVAL || n % STREAK_KEEPSAKE_INTERVAL !== 0) return null;
  const weeks = n / STREAK_KEEPSAKE_INTERVAL;
  const id = clampLen(slugify(`daily-streak-${n}`) || `daily-streak-${n}`, ID_MAX);
  const label = clampLen(`${n}-Day Ember`, LABEL_MAX);
  const weekNote = weeks > 1 ? ` — ${weeks} weeks unbroken` : "";
  const description = clampLen(
    `A steady flame you kept lit ${n} days running${weekNote}. Carry it, and the dark keeps its distance a while longer.`,
    DESCRIPTION_MAX,
  );
  return { id, label, description };
}

/**
 * Dedupe a list of keepsakes by id (Requirement 12.1 — account-scoped, dedup by
 * id). First occurrence wins; input order is otherwise preserved. Skips
 * entries missing an id defensively.
 */
export function dedupeKeepsakes<T extends { id: string }>(list: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of list) {
    if (!item || typeof item.id !== "string" || item.id.length === 0) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
