import type { StarterStory, StorySummary } from "./metadata";
import { ashfall, boneCathedral, ironCourt } from "./stubs";
import { trainingRoom } from "./training-room";

export { type StarterStory, type StorySummary } from "./metadata";
export { assertValidStory, validateStory, type StoryValidationResult } from "./validate";
export { trainingRoom } from "./training-room";

const starters = [trainingRoom, boneCathedral, ironCourt, ashfall] satisfies StarterStory[];

export function listStarterStories(): StorySummary[] {
  return starters.map((starter) => starter.summary);
}

export function getStory(storyId: string): StarterStory["story"] {
  const starter = starters.find((item) => item.summary.id === storyId);
  if (!starter) throw new Error(`story_not_found:${storyId}`);
  return starter.story;
}

export function listStarterStoryDefinitions(): StarterStory[] {
  return starters;
}
