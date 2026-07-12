import type { LlmProvider, ProviderGeneration, SceneGenerationRequest } from "./types";
import {
  appendPath,
  buildProviderPrompt,
  generationFromText,
  isLocalProviderUrl,
  postJson,
  readEnv,
  readTimeoutMs,
  type LlmHttpConfig,
} from "./httpClient";

export function createAnthropicProvider(available = defaultAnthropicAvailable(), config = readAnthropicConfig()): LlmProvider {
  return {
    name: "anthropic",
    role: "quality",
    health: () => ({
      provider: "anthropic",
      available,
      ...(available ? {} : { degradedReason: "anthropic_not_configured" }),
    }),
    generate: async (request: SceneGenerationRequest, signal?: AbortSignal): Promise<ProviderGeneration> => {
      if (!available) throw new Error("anthropic_not_configured");
      const prompt = buildProviderPrompt(request);
      const response = await postJson({
        url: appendPath(config.baseUrl, "/v1/messages"),
        timeoutMs: config.timeoutMs,
        headers: {
          "anthropic-version": "2023-06-01",
          ...(config.apiKey ? { "x-api-key": config.apiKey } : {}),
        },
        body: {
          model: config.model,
          max_tokens: 900,
          temperature: 0.8,
          seed: request.seed,
          messages: [{ role: "user", content: prompt }],
        },
        ...(signal ? { signal } : {}),
      });
      const text = extractAnthropicText(response);
      const usage = (response as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
      return generationFromText({
        provider: "anthropic",
        request,
        prompt,
        text,
        tokenUsage: { input: usage?.input_tokens, output: usage?.output_tokens },
        modelId: config.model,
      });
    },
  };
}

function readAnthropicConfig(): LlmHttpConfig {
  // Real ANTHROPIC_API_KEY beats a mock ANTHROPIC_BASE_URL override —
  // see the same logic in vertex.ts.
  const apiKey = readEnv("ANTHROPIC_API_KEY");
  const envBase = readEnv("ANTHROPIC_BASE_URL");
  const baseUrl = apiKey && envBase && isLocalProviderUrl(envBase)
    ? "https://api.anthropic.com"
    : envBase ?? "https://api.anthropic.com";
  return {
    apiKey: readEnv("ANTHROPIC_API_KEY"),
    baseUrl,
    model: readEnv("ANTHROPIC_MODEL") ?? "claude-sonnet-4-6",
    timeoutMs: readTimeoutMs(),
  };
}

function defaultAnthropicAvailable(): boolean {
  const config = readAnthropicConfig();
  if (config.apiKey) return true;
  // Mock URL is the *offline-only* fallback. If a real key exists for any
  // other provider (Gemini/Vertex), let that provider win instead of
  // returning canned `[anthropic:mock]` prose.
  if (!isLocalProviderUrl(config.baseUrl)) return false;
  const hasRealVertex = Boolean(readEnv("GEMINI_API_KEY") || readEnv("VERTEX_ACCESS_TOKEN"));
  const hasRealDeepseek = Boolean(readEnv("DEEPSEEK_API_KEY"));
  return !hasRealVertex && !hasRealDeepseek;
}

function extractAnthropicText(response: unknown): string {
  const content = (response as { content?: Array<{ type?: string; text?: string }> }).content;
  const text = content
    ?.filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
  if (!text) throw new Error("anthropic_empty_response");
  return text;
}
