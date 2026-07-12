import { evaluateTextPolicy } from "../contentPolicy";
import { createAnthropicProvider } from "./anthropic";
import { createDeepSeekProvider } from "./deepseek";
import { createFireworksProvider } from "./fireworks";
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

/**
 * Thrown when the SSE client cancels the request mid-stream and the abort
 * signal fires through a provider call. Distinct from "provider down" so the
 * router skips the deterministic fallback (which would persist a generic
 * "press on into the story" scene and waste tokens on the next request).
 *
 * Callers (the SSE handler in `http.ts`) detect this and patch the scene's
 * `streamStatus` to "failed" without emitting any client-facing events.
 */
export class ClientDisconnectedError extends Error {
  constructor(message = "client_disconnected") {
    super(message);
    this.name = "ClientDisconnectedError";
  }
}

/**
 * Recognise an SSE-handler-driven client disconnect.
 *
 * CRITICAL: this MUST distinguish a client disconnect from a provider
 * HTTP timeout. Both surface as `AbortError`-ish errors. Only the SSE
 * handler's signal — passed into `generateScene` as `signal` — fires
 * when the BROWSER actually went away. The provider's own
 * `setTimeout(controller.abort)` (httpClient.ts) fires when WE gave up
 * on the provider — that is NOT a client disconnect; it's a provider
 * outage that the router should treat as "fall through to the next
 * provider" (and, ultimately, to the deterministic safety-net).
 *
 * Earlier this helper also returned true for any error with
 * `name === "AbortError"` — that bug caused a provider HTTP timeout
 * to short-circuit the whole router as if the client had vanished,
 * leaving the scene in a broken state with no fallback prose.
 */
function isClientAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (error instanceof ClientDisconnectedError) return true;
  // NOTE: we INTENTIONALLY do not classify a bare AbortError as a
  // client disconnect. Provider HTTP timeouts also fire AbortError on
  // their internal controller; misclassifying those would skip the
  // fallback path and leave scenes empty. Only the SSE signal above
  // is the authoritative "the client gave up" indicator.
  return false;
}

export class LlmRouter {
  constructor(private readonly providers: LlmProvider[] = defaultProviders()) {}

  getProviderHealth(): ProviderHealth[] {
    return this.providers.map((provider) => provider.health());
  }

  choose(request: SceneGenerationRequest): LlmProvider {
    return chooseProvider(this.providers, request);
  }

  async generateScene(request: SceneGenerationRequest, signal?: AbortSignal): Promise<RouterResult> {
    const candidates = orderedProviders(this.providers, request);
    let lastError: unknown;

    console.log(`[llm-router] save=${request.saveId} risk=${request.risk} mode=${request.mode} candidates=${candidates.map((p) => p.name).join(",")}`);

    for (const provider of candidates) {
      // Check the abort signal between provider attempts as well as on
      // failure: a client may disconnect after one provider already failed
      // but before we kick off the next. Without this check the loop
      // would still call the deterministic provider and persist its prose.
      if (signal?.aborted) throw new ClientDisconnectedError();
      try {
        // Pass signal through so the provider's HTTP call aborts on
        // browser disconnect (see LlmProvider.generate docstring). The
        // post-call check below catches the rare window between the
        // provider returning and the next loop iteration starting.
        const generation = await provider.generate(request, signal);
        if (signal?.aborted) throw new ClientDisconnectedError();
        const parsed = parseSceneOutput(generation.text);
        // Classify prose AND the proposed choice labels (+ terminal label)
        // together, BEFORE returning. For llm-driven scenes the SSE handler
        // emits an `event: choices` frame carrying the raw labels, so a
        // policy-violating label must block the whole generation here (→
        // deterministic fallback) rather than only being caught later in
        // completeSceneStream, after the client has already rendered it
        // (requirements.md §9: classification happens before rendering).
        const choiceLabels = (parsed.choiceMetadata ?? [])
          .map((choice) => choice.label)
          .filter((label): label is string => typeof label === "string" && label.length > 0);
        const terminalLabel = parsed.proposal?.terminal?.label;
        const policy = evaluateTextPolicy({
          text: [parsed.prose, ...choiceLabels, ...(terminalLabel ? [terminalLabel] : [])]
            .filter((part) => part.length > 0)
            .join("\n"),
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
        if (isClientAbort(error, signal)) {
          // Client gave up on us. Do NOT walk the candidates list further
          // and do NOT fall through to the deterministic provider — the
          // SSE handler will catch this and patch streamStatus:"failed"
          // without writing prose.
          throw error instanceof ClientDisconnectedError ? error : new ClientDisconnectedError();
        }
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[llm-router] provider=${provider.name} failed: ${msg.slice(0, 240)}`);
        lastError = error;
      }
    }

    if (!lastError) throw new Error("llm_provider_missing");
    if (signal?.aborted) throw new ClientDisconnectedError();
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
  async *streamScene(request: SceneGenerationRequest, signal?: AbortSignal): AsyncIterable<TokenChunk> {
    const result = await this.generateScene(request, signal);
    yield* tokenizeProse(result);
  }

  async streamSceneWithResult(
    request: SceneGenerationRequest,
    onToken: (chunk: TokenChunk) => void,
    signal?: AbortSignal,
  ): Promise<RouterResult> {
    const result = await this.generateScene(request, signal);
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
    // Fireworks is the primary inference provider (design §1.1); the
    // tier-aware policy routes every non-deterministic tier through it first.
    createFireworksProvider(),
    createAnthropicProvider(),
    createVertexProvider(),
    // DeepSeek stays registered for health/back-compat but is no longer in any
    // tier order — Fireworks (which serves DeepSeek-V3 as its cheap model)
    // superseded the direct DeepSeek route.
    createDeepSeekProvider(),
    createDeterministicProvider(),
  ];
}

export { providerEligible };
