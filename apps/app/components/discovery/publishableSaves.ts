import type { LibrarySave } from "../../hooks/useLibrary";

/**
 * Pure selection logic for the interim Discover surface: which of the
 * reader's own saves are worth offering a "Share this tale" CTA for while
 * the public archive query does not exist yet.
 *
 * Kept free of React / React Native imports so it runs under the co-located
 * vitest node config (see apps/app/vitest.config.ts). The LibrarySave import
 * above is type-only and erases at compile time.
 */

/** Cap the interim shelf so it stays a nudge, not a second library screen. */
export const PUBLISHABLE_SHELF_LIMIT = 6;

const TERMINAL_STATUSES: ReadonlySet<LibrarySave["status"]> = new Set([
  "dead",
  "ended",
  "ended_safely",
]);

/** A save that has reached some ending (death, authored end, or safe close). */
export function isCompletedSave(save: LibrarySave): boolean {
  return TERMINAL_STATUSES.has(save.status);
}

/**
 * Select the saves eligible for the publish CTA, best candidates first.
 *
 * - Saves with zero turns are dropped: the server rejects them with
 *   `tale_snapshot_empty`, so the CTA would only lead to an error.
 * - Completed runs sort ahead of in-progress ones (a finished tale is the
 *   natural thing to bind), and each group sorts newest-first.
 * - The result is capped so the shelf reads as a suggestion, not a backlog.
 */
export function selectPublishableSaves(
  saves: LibrarySave[],
  limit: number = PUBLISHABLE_SHELF_LIMIT,
): LibrarySave[] {
  return saves
    .filter((save) => save.turnNumber > 0)
    .sort((a, b) => {
      const aGroup = isCompletedSave(a) ? 0 : 1;
      const bGroup = isCompletedSave(b) ? 0 : 1;
      if (aGroup !== bGroup) return aGroup - bGroup;
      return b.updatedAt - a.updatedAt;
    })
    .slice(0, Math.max(0, limit));
}

/**
 * Book-voice chip label for a save's status on the interim shelf. Lowercase
 * phrasing matches the DiscoverCard chips ("fresh on the shelf", …).
 */
export function publishableStatusLabel(status: LibrarySave["status"]): string {
  switch (status) {
    case "dead":
      return "ended in death";
    case "ended":
      return "reached an ending";
    case "ended_safely":
      return "closed safely";
    case "active":
      return "still being written";
  }
}

/** Chip label for a save's length in turns. */
export function turnCountLabel(turnNumber: number): string {
  return turnNumber === 1 ? "1 turn" : `${turnNumber} turns`;
}
