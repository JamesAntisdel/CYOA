import { evaluateTextPolicy } from "../contentPolicy";
import { createAnthropicProvider } from "./anthropic";
import { createDeepSeekProvider } from "./deepseek";
import { createDeterministicProvider } from "./deterministic";
import { parseSceneOutput } from "./parse";
import { chooseProvider, providerEligible } from "./providerPolicy";
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
    const provider = this.choose(request);
    const generation = await provider.generate(request);
    const policy = evaluateTextPolicy({
      text: generation.text,
      context: request.contentContext,
    });
    if (policy.action === "block" || policy.action === "safe_end") {
      const fallback = this.providers.find((candidate) => candidate.name === "deterministic");
      if (!fallback) throw new Error("deterministic_provider_missing");
      const safeGeneration = await fallback.generate(request);
      return {
        generation: safeGeneration,
        parsed: parseSceneOutput(safeGeneration.text),
        safetyAction: policy.action,
      };
    }
    return {
      generation,
      parsed: parseSceneOutput(generation.text),
      safetyAction: policy.action,
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
