import type { LlmProvider, ProviderGeneration, SceneGenerationRequest } from "./types";

export function createDeterministicProvider(): LlmProvider {
  return {
    name: "deterministic",
    role: "deterministic",
    health: () => ({ provider: "deterministic", available: true }),
    generate: async (request: SceneGenerationRequest): Promise<ProviderGeneration> => {
      const choices = request.choices.map((choice) => choice.label).join(", ");
      const text = `The candle gutters, but the page holds steady. ${request.seed} Choices remain: ${choices}.`;
      return {
        provider: "deterministic",
        text,
        tokenUsage: estimateTokenUsage(request.seed, text),
      };
    },
  };
}

export function estimateTokenUsage(input: string, output: string): { input: number; output: number } {
  return {
    input: Math.ceil(input.length / 4),
    output: Math.ceil(output.length / 4),
  };
}
