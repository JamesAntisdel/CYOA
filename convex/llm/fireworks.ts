// Fireworks AI provider — the primary inference provider (provider-and-credit
// design §1.1). Fireworks serves many open models behind ONE OpenAI-compatible
// endpoint (`/chat/completions`), so this is a SINGLE provider that selects one
// of three model tiers from a tier signal on the request — NOT three modules.
// Modeled directly on convex/llm/deepseek.ts (same postJson, same message
// shape, same usage extraction), parameterized by the resolved model id.
//
// Tier selection precedence:
//   1. `request.fireworksModelTier` — the transient per-candidate hint the
//      router sets so a single turn's order can try Fireworks twice (cheap then
//      mid) as an escalation ladder.
//   2. `request.tier` — the reader's entitlement (guest/free → cheap,
//      unlimited → mid, pro → premium).
//   3. Default `cheap` — the cheapest, safest lane when neither is present.

import type { LlmProvider, ProviderGeneration, SceneGenerationRequest } from "./types";
import {
  appendPath,
  buildProviderPrompt,
  generationFromText,
  isLocalProviderUrl,
  postJson,
  readEnv,
  readTimeoutMs,
} from "./httpClient";

export type FireworksModelTier = "cheap" | "mid" | "premium";

export type FireworksConfig = {
  apiKey?: string | undefined;
  baseUrl: string;
  timeoutMs: number;
};

// Documented defaults (design §1.1). Overridable per-tier via env so the exact
// served model can be swapped without a code change.
export const FIREWORKS_DEFAULT_MODELS: Record<FireworksModelTier, string> = {
  cheap: "accounts/fireworks/models/deepseek-v3", // free/guest workhorse, ~$0.14/$0.28 per M
  mid: "accounts/fireworks/models/glm-4p6", // GLM-4.6, ~$0.43/$1.75 — Unlimited default
  premium: "accounts/fireworks/models/glm-5p2", // GLM-5.2, ~$1.40/$4.40 — Pro / quality retries
};

/** Resolve the concrete Fireworks model id for a tier (env override → default). */
export function fireworksModelId(tier: FireworksModelTier): string {
  switch (tier) {
    case "cheap":
      return readEnv("FIREWORKS_MODEL_CHEAP") ?? FIREWORKS_DEFAULT_MODELS.cheap;
    case "mid":
      return readEnv("FIREWORKS_MODEL_MID") ?? FIREWORKS_DEFAULT_MODELS.mid;
    case "premium":
      return readEnv("FIREWORKS_MODEL_PREMIUM") ?? FIREWORKS_DEFAULT_MODELS.premium;
  }
}

/**
 * Resolve which Fireworks model tier to serve for a request: the explicit
 * per-candidate `fireworksModelTier` routing hint wins, then the reader's
 * entitlement `tier`, then the cheapest default.
 */
export function fireworksTierForRequest(request: SceneGenerationRequest): FireworksModelTier {
  if (request.fireworksModelTier) return request.fireworksModelTier;
  switch (request.tier ?? "free") {
    case "unlimited":
      return "mid";
    case "pro":
      return "premium";
    case "guest":
    case "free":
    default:
      return "cheap";
  }
}

export function readFireworksConfig(): FireworksConfig {
  return {
    apiKey: readEnv("FIREWORKS_API_KEY"),
    baseUrl: readEnv("FIREWORKS_BASE_URL") ?? "https://api.fireworks.ai/inference/v1",
    timeoutMs: readTimeoutMs(),
  };
}

function defaultFireworksAvailable(): boolean {
  const config = readFireworksConfig();
  if (config.apiKey) return true;
  // Same offline-only rule as deepseek.ts/anthropic.ts: a mock route must not
  // win when a real key exists for another provider.
  if (!isLocalProviderUrl(config.baseUrl)) return false;
  const hasRealVertex = Boolean(readEnv("GEMINI_API_KEY") || readEnv("VERTEX_ACCESS_TOKEN"));
  const hasRealAnthropic = Boolean(readEnv("ANTHROPIC_API_KEY"));
  return !hasRealVertex && !hasRealAnthropic;
}

export function createFireworksProvider(
  available = defaultFireworksAvailable(),
  config = readFireworksConfig(),
): LlmProvider {
  return {
    name: "fireworks",
    role: "cost",
    health: () => ({
      provider: "fireworks",
      available,
      ...(available ? {} : { degradedReason: "fireworks_not_configured" }),
    }),
    generate: async (request: SceneGenerationRequest, signal?: AbortSignal): Promise<ProviderGeneration> => {
      if (!available) throw new Error("fireworks_not_configured");
      const model = fireworksModelId(fireworksTierForRequest(request));
      const prompt = buildProviderPrompt(request);
      const response = await postJson({
        url: appendPath(config.baseUrl, "/chat/completions"),
        timeoutMs: config.timeoutMs,
        headers: {
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: {
          model,
          temperature: 0.7,
          seed: request.seed,
          messages: [
            {
              role: "system",
              content: "You write concise, safe interactive fiction prose. Never mutate game state.",
            },
            { role: "user", content: prompt },
          ],
        },
        ...(signal ? { signal } : {}),
      });
      const text = extractFireworksText(response);
      const usage = (response as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
      return generationFromText({
        provider: "fireworks",
        request,
        prompt,
        text,
        tokenUsage: { input: usage?.prompt_tokens, output: usage?.completion_tokens },
        modelId: model,
      });
    },
  };
}

function extractFireworksText(response: unknown): string {
  const choice = (response as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0];
  const text = choice?.message?.content;
  if (!text) throw new Error("fireworks_empty_response");
  return text;
}
