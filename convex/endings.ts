import type { UnlockedEnding } from "@cyoa/engine";

export type EndingRecord = {
  accountId: string;
  storyId: string;
  endingId: string;
  firstSeen: number;
  mode: "story" | "hardcore";
  path: string[];
};

export type TrophyCryptEntry = {
  endingId: string;
  unlocked: boolean;
  firstSeen?: number;
  mode?: "story" | "hardcore";
};

export function endingRecordFromUnlock(accountId: string, unlock: UnlockedEnding): EndingRecord {
  return {
    accountId,
    storyId: unlock.storyId,
    endingId: unlock.endingId,
    firstSeen: unlock.firstSeenTurn,
    mode: unlock.mode,
    path: unlock.path,
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
