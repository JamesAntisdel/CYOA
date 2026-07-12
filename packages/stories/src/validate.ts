import type { Choice, Story } from "@cyoa/engine";

import { lintStoryGates, type StoryLintSeverity } from "./lint";

export type StoryValidationIssue = {
  path: string;
  message: string;
  /**
   * Present on graph-lint issues (dead keys / unreachable gates from
   * lint.ts); absent on structural issues, which are always blocking. Only
   * lint "error"s make a story invalid — warnings and info ride along in
   * `issues` for surfacing without failing `valid`.
   */
  severity?: StoryLintSeverity;
};

export type StoryValidationResult = {
  valid: boolean;
  issues: StoryValidationIssue[];
};

/**
 * Treat a story as "llm-driven" when its only node is `start` and that node
 * carries no choices and no endingId. LLM-driven stories don't need the
 * authored-graph guarantees (referenced endings, declared death node) because
 * those checks are enforced at runtime against the LLM's proposed scene.
 */
function isLlmDrivenStory(story: Story): boolean {
  const nodeIds = Object.keys(story.nodes);
  if (nodeIds.length !== 1 || nodeIds[0] !== story.startNodeId) return false;
  const start = story.nodes[story.startNodeId];
  if (!start) return false;
  return start.choices.length === 0 && !start.endingId && !story.deathNodeId;
}

export function validateStory(story: Story): StoryValidationResult {
  const issues: StoryValidationIssue[] = [];

  if (!story.nodes[story.startNodeId]) {
    issues.push({ path: "startNodeId", message: "Start node does not exist" });
  }

  if (isLlmDrivenStory(story)) {
    return { valid: issues.length === 0, issues };
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

  // Req 22.2: a structurally-sound graph can still be unwinnable — a
  // `has_item` gate whose key no path grants soft-locks the story at play
  // time (the authored runtime matches item ids strictly). The gate lint is
  // safe to run alongside structural issues: it only walks edges whose
  // targets exist, so a broken graph under-reports rather than double-fires.
  for (const lintIssue of lintStoryGates(story)) {
    issues.push({
      path: lintIssue.path,
      message: lintIssue.message,
      severity: lintIssue.severity,
    });
  }

  const valid = issues.every(
    (issue) => issue.severity === "warning" || issue.severity === "info",
  );
  return { valid, issues };
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
