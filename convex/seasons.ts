import { AppError } from "./lib/errors";

export type SeasonStatus = "draft" | "active" | "ended";
export type LeaderboardKind = "first_to_find" | "rarest_path" | "completion";

export type SeasonRecord = {
  _id?: string;
  storyId: string;
  title: string;
  startsAt: number;
  endsAt: number;
  status: SeasonStatus;
  rules: {
    achievementIds?: string[];
    leaderboardKinds?: LeaderboardKind[];
  } & Record<string, unknown>;
};

export type AchievementRecord = {
  achievementId: string;
  accountId: string;
  seasonId?: string;
  storyId: string;
  endingId?: string;
  unlockedAt: number;
};

export type LeaderboardEntryRecord = {
  seasonId: string;
  accountId: string;
  storyId: string;
  endingId: string;
  kind: LeaderboardKind;
  rankValue: number;
  createdAt: number;
};

export function getActiveSeason(seasons: SeasonRecord[], now: number): SeasonRecord | null {
  const active = seasons
    .filter((season) => season.status === "active" && season.startsAt <= now && season.endsAt > now)
    .sort((a, b) => a.startsAt - b.startsAt);
  return active[0] ?? null;
}

export function assertSeasonWindow(season: SeasonRecord): void {
  if (season.endsAt <= season.startsAt) throw new AppError("invalid_season_window");
}

export function buildAchievementUnlocks(input: {
  accountId: string;
  season: SeasonRecord;
  storyId: string;
  endingId: string;
  completed: boolean;
  firstFind: boolean;
  rarityPercent?: number;
  now: number;
  existingAchievementIds?: string[];
}): AchievementRecord[] {
  if (input.season.storyId !== input.storyId) return [];
  const desired = new Set(input.season.rules.achievementIds ?? []);
  const existing = new Set(input.existingAchievementIds ?? []);
  const unlocks: AchievementRecord[] = [];
  const seasonId = input.season._id;

  const push = (achievementId: string) => {
    if (!desired.has(achievementId) || existing.has(achievementId)) return;
    unlocks.push({
      achievementId,
      accountId: input.accountId,
      ...(seasonId === undefined ? {} : { seasonId }),
      storyId: input.storyId,
      endingId: input.endingId,
      unlockedAt: input.now,
    });
  };

  if (input.completed) push("season.completed");
  if (input.firstFind) push("season.first_find");
  if ((input.rarityPercent ?? 100) <= 10) push("season.rare_path");
  return unlocks;
}

export function buildLeaderboardEntries(input: {
  accountId: string;
  season: SeasonRecord & { _id: string };
  storyId: string;
  endingId: string;
  completedAt: number;
  rarityPercent?: number;
  existingFirstFindCount: number;
}): LeaderboardEntryRecord[] {
  if (input.season.storyId !== input.storyId) return [];
  const kinds = new Set(input.season.rules.leaderboardKinds ?? []);
  const entries: LeaderboardEntryRecord[] = [];
  const common = {
    seasonId: input.season._id,
    accountId: input.accountId,
    storyId: input.storyId,
    endingId: input.endingId,
    createdAt: input.completedAt,
  };

  if (kinds.has("completion")) {
    entries.push({ ...common, kind: "completion", rankValue: input.completedAt });
  }
  if (kinds.has("first_to_find") && input.existingFirstFindCount === 0) {
    entries.push({ ...common, kind: "first_to_find", rankValue: input.completedAt });
  }
  if (kinds.has("rarest_path")) {
    entries.push({ ...common, kind: "rarest_path", rankValue: input.rarityPercent ?? 100 });
  }
  return entries;
}

export function rankLeaderboard(entries: LeaderboardEntryRecord[], kind: LeaderboardKind): LeaderboardEntryRecord[] {
  return entries
    .filter((entry) => entry.kind === kind)
    .sort((a, b) => a.rankValue - b.rankValue || a.createdAt - b.createdAt);
}
