import { listStarterStoryDefinitions, validateStory } from "@cyoa/stories";
import { mutationGeneric } from "convex/server";

export const loadStarterStories = mutationGeneric({
  args: {},
  handler: async () => {
    const starters = listStarterStoryDefinitions();
    const validated = starters.map((starter) => {
      const validation = validateStory(starter.story);
      if (!validation.valid) {
        throw new Error(
          `starter_story_invalid:${starter.summary.id}:${validation.issues
            .map((issue) => `${issue.path} ${issue.message}`)
            .join(";")}`,
        );
      }
      return {
        storyId: starter.summary.id,
        title: starter.summary.title,
        version: starter.story.version,
        nodeCount: Object.keys(starter.story.nodes).length,
        endingCount: Object.keys(starter.story.endings).length,
      };
    });

    return {
      mode: "package_catalog",
      imported: 0,
      validated: validated.length,
      stories: validated,
    };
  },
});
