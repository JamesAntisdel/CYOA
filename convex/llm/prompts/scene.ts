import type { SceneGenerationRequest } from "../types";

export function buildScenePrompt(request: SceneGenerationRequest): string {
  const memory = request.memory.length > 0 ? request.memory.join("\n") : "No prior memory.";
  const choices = request.choices.map((choice) => `- ${choice.choiceId}: ${choice.label}`).join("\n");
  return [
    `Story: ${request.storyId}`,
    `Node: ${request.nodeId}`,
    `Seed: ${request.seed}`,
    `Memory:\n${memory}`,
    `Available choices:\n${choices}`,
    "Write prose only. Do not mutate state, stats, inventory, flags, vitality, or currency.",
  ].join("\n\n");
}
