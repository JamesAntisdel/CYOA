import { estimateTokenUsage } from "./deterministic";
import type { LlmProvider, ProviderGeneration, SceneGenerationRequest } from "./types";

export function createDeepSeekProvider(available = true): LlmProvider {
  return {
    name: "deepseek",
    role: "cost",
    health: () => ({ provider: "deepseek", available }),
    generate: async (request: SceneGenerationRequest): Promise<ProviderGeneration> => {
      const text = `${request.seed}\n\nThe page continues in a concise, low-risk passage.`;
      return { provider: "deepseek", text, tokenUsage: estimateTokenUsage(request.seed, text) };
    },
  };
}
