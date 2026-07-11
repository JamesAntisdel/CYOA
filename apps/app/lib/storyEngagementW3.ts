/**
 * Story-engagement Wave 3 — pure client logic (design §4.3, §7 / R12, R14, R15).
 *
 * Like `storyEngagement.ts` (W1/W2), this module imports NOTHING from React
 * Native so every derivation is unit-testable under vitest
 * (`lib/__tests__/storyEngagementW3.test.ts`). It holds:
 *   - keepsake boundary adapters + the KeepsakePicker single-select model,
 *   - the What-Might-Have-Been card selection (terminal-only, UNREACHED),
 *   - the Librarian Rank display model,
 *   - the Hardcore consent gate + downgrade caveat copy,
 *   - keepsake-item detection for the inventory badge.
 *
 * Wire types come from `gameApi.ts` via `import type` (fully erased at compile
 * time — no convex runtime pulled into the test).
 */
import type {
  RemoteKeepsake,
  RemoteLibrarianRank,
  RemoteWhatMightHaveBeen,
} from "./gameApi";

// ---------------------------------------------------------------------------
// Keepsakes — boundary adapters + single-select picker model (R12.2).
// ---------------------------------------------------------------------------

/** Normalize the wire keepsakes (null-for-absent) into a concrete array. */
export function adaptKeepsakes(
  raw: RemoteKeepsake[] | null | undefined,
): RemoteKeepsake[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (k): k is RemoteKeepsake =>
      Boolean(k) && typeof k.id === "string" && typeof k.label === "string",
  );
}

/**
 * The KeepsakePicker is absent entirely when the account owns none (R12.2 —
 * "absent when the account owns none").
 */
export function hasKeepsakes(raw: RemoteKeepsake[] | null | undefined): boolean {
  return adaptKeepsakes(raw).length > 0;
}

/**
 * Single-select (≤1) toggle for the KeepsakePicker. Tapping the currently
 * selected keepsake DEselects it (carry nothing); tapping another REPLACES the
 * selection (never accumulates — exactly one keepsake may be carried). Returns
 * the next selected id, or `undefined` for "carry nothing".
 */
export function toggleKeepsakeSelection(
  current: string | undefined,
  tappedId: string,
): string | undefined {
  return current === tappedId ? undefined : tappedId;
}

/**
 * Resolve the keepsake object the reader chose to carry, if any — used to show
 * the "carrying <label>" confirmation and to thread `keepsakeId` into
 * createSave. Returns null when nothing is selected or the id is unknown.
 */
export function selectedKeepsake(
  keepsakes: RemoteKeepsake[] | null | undefined,
  selectedId: string | undefined,
): RemoteKeepsake | null {
  if (!selectedId) return null;
  return adaptKeepsakes(keepsakes).find((k) => k.id === selectedId) ?? null;
}

// ---------------------------------------------------------------------------
// Keepsake inventory badge (R12.2 — tagged item in the inventory list).
// ---------------------------------------------------------------------------

/** The tag the server stamps on a carried-keepsake inventory item. */
export const KEEPSAKE_TAG = "keepsake";

/** True when an inventory item is a carried keepsake (renders the badge). */
export function isKeepsakeItem(item: { tags?: string[] } | null | undefined): boolean {
  return Array.isArray(item?.tags) && item!.tags!.includes(KEEPSAKE_TAG);
}

/** Short badge glyph+word appended to a keepsake item chip. */
export const KEEPSAKE_BADGE = "❖ keepsake";

// ---------------------------------------------------------------------------
// What-Might-Have-Been (R14) — terminal-only UNREACHED candidate cards.
// ---------------------------------------------------------------------------

/** Max fogged candidate cards shown on the ending panel (design §4.3: 1–2). */
export const WHAT_MIGHT_HAVE_BEEN_MAX = 2;

/**
 * The fogged candidate cards for the ending panel. The server already projects
 * ONLY unreached candidates and ONLY post-terminal (BC10), so the client just:
 *   - gates on `terminal` (never render before the save is terminal — BC9/BC10),
 *   - caps to WHAT_MIGHT_HAVE_BEEN_MAX,
 *   - drops malformed entries (missing label).
 * Returns `[]` when not terminal or when the projection carries none — the
 * surface renders nothing (legacy / arc-less saves).
 */
export function whatMightHaveBeenCards(
  raw: RemoteWhatMightHaveBeen[] | null | undefined,
  opts: { terminal: boolean },
): RemoteWhatMightHaveBeen[] {
  if (!opts.terminal) return [];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (c): c is RemoteWhatMightHaveBeen =>
        Boolean(c) && typeof c.label === "string" && c.label.trim().length > 0,
    )
    .slice(0, WHAT_MIGHT_HAVE_BEEN_MAX)
    .map((c) => ({ label: c.label, hint: typeof c.hint === "string" ? c.hint : "" }));
}

/**
 * The fogged teaser line for one candidate card, e.g.
 * `Had you trusted the ferryman… — The Drowned Crown`. Never the full ending
 * prose — label + hint only (R14.1).
 */
export function whatMightHaveBeenTeaser(card: RemoteWhatMightHaveBeen): string {
  const hint = card.hint.trim();
  return hint.length > 0 ? `${hint} — ${card.label}` : card.label;
}

// ---------------------------------------------------------------------------
// Librarian Rank (R12.3) — display model only (server computes the tier).
// ---------------------------------------------------------------------------

/** Normalize the wire rank (null-for-absent) into an optional model. */
export function adaptLibrarianRank(
  raw: RemoteLibrarianRank | null | undefined,
): RemoteLibrarianRank | undefined {
  if (!raw || typeof raw.label !== "string") return undefined;
  return {
    tier: typeof raw.tier === "string" ? raw.tier : raw.label,
    label: raw.label,
    endings: Number.isFinite(raw.endings) ? Math.max(0, Math.floor(raw.endings)) : 0,
    beats: Number.isFinite(raw.beats) ? Math.max(0, Math.floor(raw.beats)) : 0,
    tales: Number.isFinite(raw.tales) ? Math.max(0, Math.floor(raw.tales)) : 0,
  };
}

/** The rank chip label shown on the profile, e.g. `Archivist`. */
export function librarianRankChipLabel(rank: RemoteLibrarianRank): string {
  return rank.label;
}

/**
 * The rank progress line under the chip, e.g.
 * `8 endings · 10 beats · 1 tale`. Pluralizes each unit.
 */
export function librarianRankProgressLine(rank: RemoteLibrarianRank): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  return [
    plural(rank.endings, "ending"),
    plural(rank.beats, "beat"),
    plural(rank.tales, "tale"),
  ].join(" · ");
}

// ---------------------------------------------------------------------------
// Hardcore mode (R15) — consent gate + downgrade caveat copy.
// ---------------------------------------------------------------------------

export type SaveMode = "story" | "hardcore";

/** The consent headline shown before a Hardcore run (R15.3). */
export const HARDCORE_CONSENT_TITLE = "This tome does not forgive";

/** The consent body — what Hardcore takes away (R15.1). */
export const HARDCORE_CONSENT_LINES: readonly string[] = [
  "No rewind. No second chances.",
  "Death is permanent — the save (and its art) is purged.",
  "The candle burns faster, and every check is one band harder.",
  "Some endings can only be unlocked here.",
] as const;

/**
 * The Hardcore consent gate: a Hardcore save may be started ONLY after the
 * reader explicitly acknowledges the consent screen. Story mode needs no gate.
 * Returns whether creation may proceed for the chosen mode.
 */
export function canStartMode(mode: SaveMode, consented: boolean): boolean {
  if (mode === "story") return true;
  return consented === true;
}

/** The purge acknowledgment shown on a Hardcore death screen (R15.1). */
export const HARDCORE_DEATH_PURGE_COPY =
  "The tome closes forever. This run and its art have been purged.";

/**
 * The caveat surfaced when a reader downgrades a save Hardcore → Story
 * mid-run (R15.2). Downgrade is allowed; upgrade is never offered mid-run.
 */
export const HARDCORE_DOWNGRADE_CAVEAT =
  "Downgrading to Story disables this save's hardcore-only ending unlocks. You cannot return to Hardcore for this tome.";

export type DowngradeModel = {
  /** Whether the downgrade control should be offered (only for hardcore saves). */
  canDowngrade: boolean;
  /** Whether an upgrade control should be offered — NEVER mid-run (R15.2). */
  canUpgrade: false;
  /** The caveat to display alongside the downgrade control. */
  caveat: string;
};

/**
 * The mode-management model for a save's settings surface. Only Hardcore saves
 * can be downgraded; Story saves show nothing. Upgrade is never offered
 * mid-run (matches steering product.md:27).
 */
export function buildDowngradeModel(mode: SaveMode): DowngradeModel {
  return {
    canDowngrade: mode === "hardcore",
    canUpgrade: false,
    caveat: HARDCORE_DOWNGRADE_CAVEAT,
  };
}
