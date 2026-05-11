import type { SceneGenerationRequest } from "../types";

export function buildScenePrompt(request: SceneGenerationRequest): string {
  const memory = request.memory.length > 0 ? request.memory.join("\n") : "No prior memory.";
  const choices = request.choices.map((choice) => `- ${choice.choiceId}: ${choice.label}`).join("\n");
  return [
    `Story: ${request.storyId}`,
    `Node: ${request.nodeId}`,
    `Seed: ${request.seed}`,
    `Scene length: ${lengthInstruction(request.sceneLength)}`,
    `Memory:\n${memory}`,
    `Available choices:\n${choices}`,
    "Write prose only. Do not mutate state, stats, inventory, flags, vitality, or currency.",
  ].join("\n\n");
}

function lengthInstruction(sceneLength: SceneGenerationRequest["sceneLength"]): string {
  switch (sceneLength) {
    case "brief":
      return "1-2 short paragraphs for tutorial, fallback, or transition beats.";
    case "rich":
      return "700-1000 words with layered sensory detail, pacing, and character/world texture.";
    case "chapter":
      return "1200-1800 words paced as a chapter section, while ending with the provided choices.";
    case "standard":
    default:
      return "3-5 readable paragraphs with concrete detail and momentum.";
  }
}
