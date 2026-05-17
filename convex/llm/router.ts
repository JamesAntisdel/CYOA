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

    console.log(`[llm-router] save=${request.saveId} risk=${request.risk} mode=${request.mode} candidates=${candidates.map((p) => p.name).join(",")}`);

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
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[llm-router] provider=${provider.name} failed: ${msg.slice(0, 240)}`);
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

  /**
   * Stream the scene's *prose* tokens. The router does a full generation
   * first, parses the result, and then re-emits the parsed prose word-by-word
   * so the client never has to deal with raw JSON for llm-driven scenes.
   *
   * To surface the parsed proposal (the LLM-driven contract's choices +
   * terminal) to the SSE wrapper, callers should prefer `streamSceneWithResult`
   * — it both yields tokens and resolves the final RouterResult.
   */
  async *streamScene(request: SceneGenerationRequest): AsyncIterable<TokenChunk> {
    const result = await this.generateScene(request);
    yield* tokenizeProse(result);
  }

  async streamSceneWithResult(
    request: SceneGenerationRequest,
    onToken: (chunk: TokenChunk) => void,
  ): Promise<RouterResult> {
    const result = await this.generateScene(request);
    for (const chunk of tokenizeProse(result)) onToken(chunk);
    return result;
  }
}

function tokenizeProse(result: RouterResult): TokenChunk[] {
  // For llm-driven scenes only emit the parsed prose, never the raw JSON.
  // For authored scenes the parsed prose IS the generation text (no JSON
  // wrapping), so the behaviour is unchanged.
  const proseText = result.parsed.prose;
  const words = proseText.split(/(\s+)/).filter(Boolean);
  return words.map((text, index) => ({
    provider: result.generation.provider,
    text: text ?? "",
    index,
  }));
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
