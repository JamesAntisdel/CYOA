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
    generate: async (request: SceneGenerationRequest): Promise<ProviderGeneration> => {
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
      });
      const text = extractAnthropicText(response);
      const usage = (response as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
      return generationFromText({
        provider: "anthropic",
        request,
        prompt,
        text,
        tokenUsage: { input: usage?.input_tokens, output: usage?.output_tokens },
      });
    },
  };
}

function readAnthropicConfig(): LlmHttpConfig {
  const baseUrl = readEnv("ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com";
  return {
    apiKey: readEnv("ANTHROPIC_API_KEY"),
    baseUrl,
    model: readEnv("ANTHROPIC_MODEL") ?? "claude-sonnet-4-6",
    timeoutMs: readTimeoutMs(),
  };
}

function defaultAnthropicAvailable(): boolean {
  const config = readAnthropicConfig();
  return Boolean(config.apiKey || isLocalProviderUrl(config.baseUrl));
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
