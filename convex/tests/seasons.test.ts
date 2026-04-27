import { describe, expect, it } from "vitest";

import {
  buildAchievementUnlocks,
  buildLeaderboardEntries,
  getActiveSeason,
  rankLeaderboard,
  type SeasonRecord,
} from "../index";

const season: SeasonRecord & { _id: string } = {
  _id: "season",
  storyId: "story",
  title: "First Candle",
  startsAt: 10,
  endsAt: 20,
  status: "active",
  rules: {
    achievementIds: ["season.completed", "season.first_find", "season.rare_path"],
    leaderboardKinds: ["completion", "first_to_find", "rarest_path"],
  },
};

describe("seasons", () => {
  it("selects the active season by window", () => {
    expect(getActiveSeason([season], 15)?._id).toBe("season");
    expect(getActiveSeason([season], 25)).toBeNull();
  });

  it("builds season achievements without duplicates", () => {
    const unlocks = buildAchievementUnlocks({
      accountId: "acct",
      season,
      storyId: "story",
      endingId: "end",
      completed: true,
      firstFind: true,
      rarityPercent: 4,
      existingAchievementIds: ["season.completed"],
      now: 16,
    });

    expect(unlocks.map((unlock) => unlock.achievementId)).toEqual([
      "season.first_find",
      "season.rare_path",
    ]);
  });

  it("builds and ranks leaderboard entries", () => {
    const entries = buildLeaderboardEntries({
      accountId: "acct",
      season,
      storyId: "story",
      endingId: "end",
      completedAt: 16,
      rarityPercent: 7,
      existingFirstFindCount: 0,
    });

    expect(entries.map((entry) => entry.kind)).toEqual([
      "completion",
      "first_to_find",
      "rarest_path",
    ]);
    expect(rankLeaderboard(entries, "rarest_path")[0]?.rankValue).toBe(7);
  });
});
