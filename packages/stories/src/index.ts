import type { StarterStory, StoryMode, StorySummary } from "./metadata";
import { ashfall, boneCathedral, ironCourt } from "./stubs";
import { trainingRoom } from "./training-room";

export { type StarterStory, type StoryMode, type StorySummary } from "./metadata";
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

/**
 * Resolve the contract mode for a known starter story. Authored stories walk
 * the engine's node graph; llm-driven stories rely on the LLM proposing each
 * scene's prose + choices + effects under engine validation. Unknown ids
 * (creator seeds, custom stories) default to "authored" — they ship with a
 * full node graph and are written against the legacy contract.
 */
export function getStoryMode(storyId: string): StoryMode {
  return starters.find((item) => item.summary.id === storyId)?.summary.mode ?? "authored";
}
