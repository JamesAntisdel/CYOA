import type { LlmProvider, ProviderGeneration, SceneGenerationRequest } from "./types";
import {
  buildProviderPrompt,
  generationFromText,
  isLocalProviderUrl,
  postJson,
  readEnv,
  readTimeoutMs,
  type LlmHttpConfig,
} from "./httpClient";

type VertexConfig = LlmHttpConfig & {
  accessToken?: string | undefined;
  apiKey?: string | undefined;
};

export function createVertexProvider(available = defaultVertexAvailable(), config = readVertexConfig()): LlmProvider {
  return {
    name: "vertex",
    role: "fallback",
    health: () => ({
      provider: "vertex",
      available,
      ...(available ? {} : { degradedReason: "vertex_not_configured" }),
    }),
    generate: async (request: SceneGenerationRequest): Promise<ProviderGeneration> => {
      if (!available) throw new Error("vertex_not_configured");
      const prompt = buildProviderPrompt(request);
      const response = await postJson({
        url: vertexGenerateUrl(config),
        timeoutMs: config.timeoutMs,
        headers: {
          ...(config.accessToken ? { authorization: `Bearer ${config.accessToken}` } : {}),
        },
        body: {
          model: config.model,
          seed: request.seed,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.75,
            maxOutputTokens: 900,
          },
        },
      });
      const text = extractVertexText(response);
      const usage = (response as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata;
      return generationFromText({
        provider: "vertex",
        request,
        prompt,
        text,
        tokenUsage: { input: usage?.promptTokenCount, output: usage?.candidatesTokenCount },
      });
    },
  };
}

function readVertexConfig(): VertexConfig {
  const projectId = readEnv("VERTEX_PROJECT_ID");
  const location = readEnv("VERTEX_LOCATION") ?? "us-central1";
  const accessToken = readEnv("VERTEX_ACCESS_TOKEN");
  const model = readEnv("GEMINI_TEXT_MODEL") ?? readEnv("VERTEX_TEXT_MODEL") ?? "gemini-2.5-flash";
  const baseUrl =
    readEnv("VERTEX_BASE_URL") ??
    (projectId && accessToken
      ? `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`
      : "https://generativelanguage.googleapis.com/v1beta/models");
  return {
    apiKey: readEnv("GEMINI_API_KEY"),
    accessToken,
    baseUrl,
    model,
    timeoutMs: readTimeoutMs(),
  };
}

function defaultVertexAvailable(): boolean {
  const config = readVertexConfig();
  return Boolean(config.accessToken || config.apiKey || isLocalProviderUrl(config.baseUrl));
}

function vertexGenerateUrl(config: VertexConfig): string {
  const trimmed = config.baseUrl.replace(/\/+$/, "");
  if (trimmed.includes(":generateContent") || isLocalProviderUrl(trimmed)) return trimmed;
  const query = config.apiKey ? `?key=${encodeURIComponent(config.apiKey)}` : "";
  return `${trimmed}/${config.model}:generateContent${query}`;
}

function extractVertexText(response: unknown): string {
  const parts = (response as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    .candidates?.[0]?.content?.parts;
  const text = parts
    ?.map((part) => part.text)
    .filter((part): part is string => typeof part === "string")
    .join("");
  if (!text) throw new Error("vertex_empty_response");
  return text;
}
