import { convexHttp } from "./convexHttp";

export type RemoteUnlockedEnding = {
  storyId: string;
  endingId: string;
  firstSeen: number;
  mode: "story" | "hardcore";
  path: string[];
  safetyEnding: boolean;
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
