import { convexHttp } from "./convexHttp";

export type RemoteUnlockedEnding = {
  storyId: string;
  endingId: string;
  firstSeen: number;
  mode: "story" | "hardcore";
  path: string[];
  safetyEnding: boolean;
  /**
   * Human ending title persisted server-side at unlock time. Optional
   * with a graceful client fallback — see `lib/endingLabels.ts` — so legacy
   * rows without it never render raw machine ids.
   */
  label?: string;
  /**
   * Last few reader choice labels leading into the ending (oldest→newest),
   * persisted server-side at unlock time. Optional; legacy rows fall back to
   * a prettified node-id `path` (see `preferredPathHint`).
   */
  pathLabels?: string[];
};

/**
 * Fetch the account's unlocked endings for the trophy crypt. Returns null when
 * the remote backend is unreachable so the screen can fall back gracefully.
 */
export async function listRemoteUnlockedEndings(input: {
  accountId: string;
  guestTokenHash?: string;
}): Promise<RemoteUnlockedEnding[] | null> {
  return convexHttp<RemoteUnlockedEnding[]>(
    "query",
    "endingsFunctions:listUnlockedEndings",
    input as unknown as Record<string, unknown>,
  );
}
