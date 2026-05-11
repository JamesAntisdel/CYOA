import { evaluateTextPolicy } from "../contentPolicy";
import { createAnthropicProvider } from "./anthropic";
import { createDeepSeekProvider } from "./deepseek";
import { createDeterministicProvider } from "./deterministic";
import { parseSceneOutput } from "./parse";
import { chooseProvider, orderedProviders, providerEligible } from "./providerPolicy";
import type { LlmProvider, ParsedScene, ProviderGeneration, ProviderHealth, SceneGenerationRequest, TokenChunk } from "./types";
import { createVertexProvider } from "./vertex";

export type RouterResult = {
  generation: ProviderGeneration;
  parsed: ParsedScene;
  safetyAction: string;
};

export class LlmRouter {
  constructor(private readonly providers: LlmProvider[] = defaultProviders()) {}

  getProviderHealth(): ProviderHealth[] {
    return this.providers.map((provider) => provider.health());
  }

  choose(request: SceneGenerationRequest): LlmProvider {
    return chooseProvider(this.providers, request);
  }

  async generateScene(request: SceneGenerationRequest): Promise<RouterResult> {
    const candidates = orderedProviders(this.providers, request);
    let lastError: unknown;

    for (const provider of candidates) {
      try {
        const generation = await provider.generate(request);
        const parsed = parseSceneOutput(generation.text);
        const policy = evaluateTextPolicy({
          text: parsed.prose,
          context: request.contentContext,
        });
        const safetyAction = lastError && provider.name === "deterministic" ? "fallback" : policy.action;
        if (policy.action === "block" || policy.action === "safe_end") {
          return this.generateDeterministicFallback(request, policy.action);
        }
        return {
          generation,
          parsed,
          safetyAction,
        };
      } catch (error) {
        lastError = error;
      }
    }

    if (!lastError) throw new Error("llm_provider_missing");
    return this.generateDeterministicFallback(request, "fallback");
  }

  private async generateDeterministicFallback(request: SceneGenerationRequest, safetyAction: string): Promise<RouterResult> {
    const fallback = this.providers.find((candidate) => candidate.name === "deterministic");
    if (!fallback) throw new Error("deterministic_provider_missing");
    const safeGeneration = await fallback.generate(request);
    return {
      generation: safeGeneration,
      parsed: parseSceneOutput(safeGeneration.text),
      safetyAction,
    };
  }

  async *streamScene(request: SceneGenerationRequest): AsyncIterable<TokenChunk> {
    const result = await this.generateScene(request);
    const words = result.generation.text.split(/(\s+)/).filter(Boolean);
    for (let index = 0; index < words.length; index += 1) {
      yield {
        provider: result.generation.provider,
        text: words[index] ?? "",
        index,
      };
    }
  }
}

export function defaultProviders(): LlmProvider[] {
  return [
    createAnthropicProvider(),
    createVertexProvider(),
    createDeepSeekProvider(),
    createDeterministicProvider(),
  ];
}

export { providerEligible };
