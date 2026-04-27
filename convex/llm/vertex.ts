import { estimateTokenUsage } from "./deterministic";
import type { LlmProvider, ProviderGeneration, SceneGenerationRequest } from "./types";

export function createVertexProvider(available = true): LlmProvider {
  return {
    name: "vertex",
    role: "fallback",
    health: () => ({ provider: "vertex", available }),
    generate: async (request: SceneGenerationRequest): Promise<ProviderGeneration> => {
      const text = `${request.seed}\n\nAnother voice takes up the tale without changing the rules.`;
      return { provider: "vertex", text, tokenUsage: estimateTokenUsage(request.seed, text) };
    },
  };
}
