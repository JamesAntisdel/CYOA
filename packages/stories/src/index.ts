import type { StarterStory, StoryMode, StorySummary } from "./metadata";
import { openCanvas, OPEN_STARTER_ID } from "./open";
import { ashfall, boneCathedral, ironCourt } from "./stubs";
import { trainingRoom } from "./training-room";

export { type StarterStory, type StoryMode, type StorySummary } from "./metadata";
export {
  lintStoryGates,
  type StoryLintCode,
  type StoryLintIssue,
  type StoryLintSeverity,
} from "./lint";
export {
  assertValidStory,
  validateStory,
  type StoryValidationIssue,
  type StoryValidationResult,
} from "./validate";
export { trainingRoom } from "./training-room";
export { openCanvas, OPEN_STARTER_ID } from "./open";

const starters = [
  trainingRoom,
  boneCathedral,
  ironCourt,
  ashfall,
] satisfies StarterStory[];

/**
 * Hidden starters are valid `StarterStory` definitions that the seed-flow
 * launch path consumes via known ids (e.g. `OPEN_STARTER_ID`) but that the
 * public discovery surfaces (home, library "Starters") must NOT render as
 * launchable cards. The open-canvas shell, in particular, has no seed of
 * its own — launching it without a reader-authored `seedPremise` produces
 * an empty story, so it must never appear in `listStarterStories()`.
 */
const hiddenStarters = [openCanvas] satisfies StarterStory[];

export function listStarterStories(): StorySummary[] {
  return starters.map((starter) => starter.summary);
}

/**
 * Non-throwing story lookup. Returns null for ids that don't correspond to a
 * bundled starter/hidden story — e.g. server-side creator seeds carrying an
 * `authored_seed:<id>` storyId, whose real definition lives only in Convex.
 * Callers that render from a remote scene (which already carries prose,
 * choices, and title) should prefer this + a generic shell fallback over
 * `getStory`, which throws and can crash a React render.
 */
export function tryGetStory(storyId: string): StarterStory["story"] | null {
  const starter =
    starters.find((item) => item.summary.id === storyId) ??
    hiddenStarters.find((item) => item.summary.id === storyId);
  return starter ? starter.story : null;
}

export function getStory(storyId: string): StarterStory["story"] {
  const story = tryGetStory(storyId);
  if (!story) throw new Error(`story_not_found:${storyId}`);
  return story;
}

export function listStarterStoryDefinitions(): StarterStory[] {
  return starters;
}

/**
 * Resolve the contract mode for a known starter story. Authored stories walk
 * the engine's node graph; llm-driven stories rely on the LLM proposing each
 * scene's prose + choices + effects under engine validation. Unknown ids
 * (creator seeds, custom stories) default to "authored" — they ship with a
 * full node graph and are written against the legacy contract. Hidden
 * starters (e.g. the open-canvas seed shell) are resolved alongside the
 * public list so the launch path still gets the right mode.
 */
export function getStoryMode(storyId: string): StoryMode {
  const match =
    starters.find((item) => item.summary.id === storyId) ??
    hiddenStarters.find((item) => item.summary.id === storyId);
  return match?.summary.mode ?? "authored";
}
