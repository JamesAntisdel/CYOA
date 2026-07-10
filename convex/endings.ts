import type { UnlockedEnding } from "@cyoa/engine";

export type EndingRecord = {
  accountId: string;
  storyId: string;
  endingId: string;
  firstSeen: number;
  mode: "story" | "hardcore";
  path: string[];
  /**
   * True when this ending was forced by the narrative-safety classifier (the
   * reader hit a safe-exit / safe-redirect terminal rather than a story-driven
   * death or success) — Requirement 11.4. Absent on ordinary story endings.
   * Persisted so the trophy crypt / endings map can render safety exits
   * distinctly and so operators can audit safe-ending rates.
   */
  safetyEnding?: boolean;
};

export type TrophyCryptEntry = {
  endingId: string;
  unlocked: boolean;
  firstSeen?: number;
  mode?: "story" | "hardcore";
};

export function endingRecordFromUnlock(
  accountId: string,
  unlock: UnlockedEnding,
  options?: { safetyEnding?: boolean },
): EndingRecord {
  return {
    accountId,
    storyId: unlock.storyId,
    endingId: unlock.endingId,
    firstSeen: unlock.firstSeenTurn,
    mode: unlock.mode,
    path: unlock.path,
    ...(options?.safetyEnding ? { safetyEnding: true } : {}),
  };
}

export function buildTrophyCrypt(
  allEndingIds: string[],
  unlocked: EndingRecord[],
): TrophyCryptEntry[] {
  const byId = new Map(unlocked.map((ending) => [ending.endingId, ending]));
  return allEndingIds.map((endingId) => {
    const record = byId.get(endingId);
    return record
      ? {
          endingId,
          unlocked: true,
          firstSeen: record.firstSeen,
          mode: record.mode,
        }
      : { endingId, unlocked: false };
  });
}

export function buildVisitedPathMap(records: EndingRecord[]): string[] {
  return [...new Set(records.flatMap((record) => record.path))];
}
