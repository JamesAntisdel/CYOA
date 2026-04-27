import type { Choice, Story } from "@cyoa/engine";

export type StoryValidationIssue = {
  path: string;
  message: string;
};

export type StoryValidationResult = {
  valid: boolean;
  issues: StoryValidationIssue[];
};

export function validateStory(story: Story): StoryValidationResult {
  const issues: StoryValidationIssue[] = [];

  if (!story.nodes[story.startNodeId]) {
    issues.push({ path: "startNodeId", message: "Start node does not exist" });
  }

  if (story.deathNodeId && !story.nodes[story.deathNodeId]) {
    issues.push({ path: "deathNodeId", message: "Death node does not exist" });
  }

  for (const [nodeId, node] of Object.entries(story.nodes)) {
    if (node.endingId && !story.endings[node.endingId]) {
      issues.push({
        path: `nodes.${nodeId}.endingId`,
        message: "Node ending id is not registered",
      });
    }

    for (const choice of node.choices) {
      validateChoice(story, nodeId, choice, issues);
    }
  }

  const endingNodeIds = new Set(
    Object.values(story.nodes)
      .map((node) => node.endingId)
      .filter((endingId): endingId is string => Boolean(endingId)),
  );
  for (const endingId of Object.keys(story.endings)) {
    if (!endingNodeIds.has(endingId)) {
      issues.push({
        path: `endings.${endingId}`,
        message: "Registered ending is not used by any node",
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

export function assertValidStory(story: Story): void {
  const result = validateStory(story);
  if (!result.valid) {
    throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
}

function validateChoice(
  story: Story,
  nodeId: string,
  choice: Choice,
  issues: StoryValidationIssue[],
): void {
  if (!story.nodes[choice.targetNodeId]) {
    issues.push({
      path: `nodes.${nodeId}.choices.${choice.id}.targetNodeId`,
      message: "Choice target node does not exist",
    });
  }
}
