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

export function createDeepSeekProvider(available = defaultDeepSeekAvailable(), config = readDeepSeekConfig()): LlmProvider {
  return {
    name: "deepseek",
    role: "cost",
    health: () => ({
      provider: "deepseek",
      available,
      ...(available ? {} : { degradedReason: "deepseek_not_configured" }),
    }),
    generate: async (request: SceneGenerationRequest): Promise<ProviderGeneration> => {
      if (!available) throw new Error("deepseek_not_configured");
      const prompt = buildProviderPrompt(request);
      const response = await postJson({
        url: appendPath(config.baseUrl, "/chat/completions"),
        timeoutMs: config.timeoutMs,
        headers: {
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: {
          model: config.model,
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
      });
      const text = extractDeepSeekText(response);
      const usage = (response as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
      return generationFromText({
        provider: "deepseek",
        request,
        prompt,
        text,
        tokenUsage: { input: usage?.prompt_tokens, output: usage?.completion_tokens },
      });
    },
  };
}

function readDeepSeekConfig(): LlmHttpConfig {
  const baseUrl = readEnv("DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com";
  return {
    apiKey: readEnv("DEEPSEEK_API_KEY"),
    baseUrl,
    model: readEnv("DEEPSEEK_MODEL") ?? "deepseek-chat",
    timeoutMs: readTimeoutMs(),
  };
}

function defaultDeepSeekAvailable(): boolean {
  const config = readDeepSeekConfig();
  if (config.apiKey) return true;
  // Same offline-only rule as anthropic.ts: don't let a mock route win when
  // a real key exists for another provider.
  if (!isLocalProviderUrl(config.baseUrl)) return false;
  const hasRealVertex = Boolean(readEnv("GEMINI_API_KEY") || readEnv("VERTEX_ACCESS_TOKEN"));
  const hasRealAnthropic = Boolean(readEnv("ANTHROPIC_API_KEY"));
  return !hasRealVertex && !hasRealAnthropic;
}

function extractDeepSeekText(response: unknown): string {
  const choice = (response as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0];
  const text = choice?.message?.content;
  if (!text) throw new Error("deepseek_empty_response");
  return text;
}
