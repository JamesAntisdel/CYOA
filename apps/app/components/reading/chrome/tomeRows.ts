// Pure render-model builder for the Tome menu (design §1, R2.1). No React /
// React Native imports — the only dependency is the `IconName` *type* (erased
// at transpile), so this module carries behavioral `.test.mjs` coverage.
//
// The Tome menu is the single quiet door behind which everything about *this
// tale* lives. `buildTomeRows` turns the reader's current state into the
// ordered row list the TomeSheet renders; the sheet owns presentation
// (backdrop/close/focus), this owns WHICH rows exist and in WHAT order.

import type { IconName } from "../../primitives/Icon";

/** One full-width Tome-menu row (design §1). */
export type TomeRow = {
  /** Stable id — used by React lists and the RC6 drift-guard. */
  key: string;
  /** Visible label AND accessibility label (kept 1:1). */
  label: string;
  /** Optional leading glyph from the 10-name icon font (RC5). */
  icon?: IconName;
  /** Row action. Navigating rows also close the sheet (TomeSheet's concern). */
  onPress: () => void;
  /**
   * Toggle state, present ONLY on the Auto-read row — drives the sheet's
   * on/off affix. Absent (never `undefined` inline) on plain action rows so
   * `exactOptionalPropertyTypes` stays happy.
   */
  selected?: boolean;
};

export type BuildTomeRowsInput = {
  /**
   * Auto-read session flag (SESSION state — never `useReaderSettings`, RC4).
   * Drives the Auto-read row's `selected`.
   */
  autoOn: boolean;
  /**
   * Terminal-scene guard. At an ending the Auto-read row is HIDDEN — auto is
   * meaningless at a terminal scene, and this mirrors the `hasEnding` halt
   * guard already blocking `useAutoNarrator` (design §4 / RC4).
   */
  hasEnding: boolean;
  /**
   * Read-as-book availability — the SAME rule as the ending-panel affordance
   * (R2.1). When false the row is omitted entirely.
   */
  readAsBookAvailable: boolean;
  onToggleAuto: () => void;
  onPathMap: () => void;
  onRunHistory: () => void;
  onReadAsBook: () => void;
  onReadingSettings: () => void;
  onFlagScene: () => void;
  onLeave: () => void;
};

/**
 * Build the ordered Tome-menu rows (design §3 mock order):
 *   Auto-read (hidden at a terminal scene) · Path map · Run history ·
 *   Read as book (hidden when unavailable) · Reading settings ·
 *   Flag this scene · Leave the tale.
 *
 * The Flag row carries the REPORT ACTION only — the AI disclosure stays a
 * persistent footer caption in ReaderScreen, it does NOT move into the sheet
 * (U3 / R2.5).
 */
export function buildTomeRows(input: BuildTomeRowsInput): TomeRow[] {
  const rows: TomeRow[] = [];

  // Auto-read — omitted at a terminal scene (auto is meaningless at an ending).
  if (!input.hasEnding) {
    rows.push({
      key: "auto",
      label: "Auto-read",
      onPress: input.onToggleAuto,
      selected: input.autoOn,
    });
  }

  rows.push({ key: "map", label: "Path map", onPress: input.onPathMap });
  rows.push({ key: "history", label: "Run history", onPress: input.onRunHistory });

  // Read as book — same availability rule as the ending-panel affordance.
  if (input.readAsBookAvailable) {
    rows.push({ key: "book", label: "Read as book", onPress: input.onReadAsBook });
  }

  rows.push({
    key: "settings",
    label: "Reading settings",
    onPress: input.onReadingSettings,
  });

  // Flag this scene — the report ACTION only (U3/R2.5); the disclosure is a
  // ReaderScreen footer caption, not a row here.
  rows.push({ key: "flag", label: "Flag this scene", onPress: input.onFlagScene });

  rows.push({ key: "leave", label: "Leave the tale", onPress: input.onLeave });

  return rows;
}
