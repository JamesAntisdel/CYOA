import { estimateTokenUsage } from "./deterministic";
import type { LlmProvider, ProviderGeneration, SceneGenerationRequest } from "./types";

export function createAnthropicProvider(available = true): LlmProvider {
  return {
    name: "anthropic",
    role: "quality",
    health: () => ({ provider: "anthropic", available }),
    generate: async (request: SceneGenerationRequest): Promise<ProviderGeneration> => {
      const text = `${request.seed}\n\nThe prose gathers carefully around the consequences already chosen.`;
      return { provider: "anthropic", text, tokenUsage: estimateTokenUsage(request.seed, text) };
    },
  };
}
