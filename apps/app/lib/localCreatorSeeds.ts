import type { Story } from "@cyoa/engine";

export type LocalCreatorSeed = {
  seedId: string;
  title: string;
  story: Story;
  status: "draft" | "published";
  updatedAt: number;
};

const CREATOR_SEEDS_KEY = "cyoa.creatorSeeds.v1";
const CREATOR_SAVE_PREFIX = "creator_seed_";

export function saveLocalCreatorSeed(seed: LocalCreatorSeed): void {
  const seeds = listLocalCreatorSeeds();
  const nextSeeds = [seed, ...seeds.filter((existing) => existing.seedId !== seed.seedId)]
    .sort((left, right) => right.updatedAt - left.updatedAt);
  getStorage()?.setItem(CREATOR_SEEDS_KEY, JSON.stringify(nextSeeds));
}

export function listLocalCreatorSeeds(): LocalCreatorSeed[] {
  const raw = getStorage()?.getItem(CREATOR_SEEDS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as LocalCreatorSeed[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLocalCreatorSeed);
  } catch {
    return [];
  }
}

export function creatorSeedSaveId(seedId: string): string {
  return `${CREATOR_SAVE_PREFIX}${seedId}`;
}

export function storyForCreatorSeedSave(saveId: string): Story | null {
  if (!saveId.startsWith(CREATOR_SAVE_PREFIX)) return null;
  const seedId = saveId.slice(CREATOR_SAVE_PREFIX.length);
  return listLocalCreatorSeeds().find((seed) => seed.seedId === seedId)?.story ?? null;
}

function isLocalCreatorSeed(value: Partial<LocalCreatorSeed>): value is LocalCreatorSeed {
  return (
    typeof value.seedId === "string" &&
    typeof value.title === "string" &&
    isStory(value.story) &&
    (value.status === "draft" || value.status === "published") &&
    typeof value.updatedAt === "number"
  );
}

function isStory(value: unknown): value is Story {
  if (!value || typeof value !== "object") return false;
  const story = value as Partial<Story>;
  return (
    typeof story.id === "string" &&
    typeof story.title === "string" &&
    typeof story.startNodeId === "string" &&
    Boolean(story.nodes && typeof story.nodes === "object") &&
    Boolean(story.endings && typeof story.endings === "object")
  );
}

function getStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof globalThis === "undefined") return null;
  return (globalThis as { localStorage?: Storage }).localStorage ?? null;
}
