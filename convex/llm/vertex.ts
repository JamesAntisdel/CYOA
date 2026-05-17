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
      // Gemini supports JSON mode via responseMimeType. For llm-driven scenes
      // we require strict JSON because the engine rejects anything else; for
      // authored scenes we leave the response unconstrained (prose works).
      // Gemini's generateContent endpoint rejects a top-level `seed`. The
      // seed (and JSON mode) belong inside generationConfig.
      // Gemini 3 Flash defaults thinking to "high", which spends the
      // maxOutputTokens budget on hidden reasoning and returns an empty
      // text part. We don't need reasoning for prose/JSON scene output —
      // force thinking minimal and give a generous token cap.
      const generationConfig: Record<string, unknown> = {
        temperature: 0.75,
        maxOutputTokens: request.mode === "llm-driven" ? 4096 : 2048,
        seed: hashSeedToInt32(request.seed),
        thinkingConfig: { thinkingLevel: "minimal" },
      };
      if (request.mode === "llm-driven") {
        generationConfig.responseMimeType = "application/json";
      }
      const response = await postJson({
        url: vertexGenerateUrl(config),
        timeoutMs: config.timeoutMs,
        headers: {
          ...(config.accessToken ? { authorization: `Bearer ${config.accessToken}` } : {}),
          ...(config.apiKey && !config.accessToken ? { "x-goog-api-key": config.apiKey } : {}),
        },
        body: {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig,
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
  const apiKey = readEnv("GEMINI_API_KEY");
  const model = readEnv("GEMINI_TEXT_MODEL") ?? readEnv("VERTEX_TEXT_MODEL") ?? "gemini-3-flash-preview";
  const envBaseUrl = readEnv("VERTEX_BASE_URL");
  // Real-key takes precedence over VERTEX_BASE_URL=*provider-mocks*. The
  // mock URL in .env is meant as the fallback for offline dev; once a
  // real GEMINI_API_KEY or VERTEX_ACCESS_TOKEN is configured, route to
  // the real Google endpoint regardless of the local mock override.
  const envOverrideIsMock = envBaseUrl ? isLocalProviderUrl(envBaseUrl) : false;
  const hasLiveCredential = Boolean(apiKey || (projectId && accessToken));
  const liveBaseUrl =
    projectId && accessToken
      ? `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`
      : "https://generativelanguage.googleapis.com/v1beta/models";
  const baseUrl = hasLiveCredential && envOverrideIsMock
    ? liveBaseUrl
    : envBaseUrl ?? liveBaseUrl;
  return {
    apiKey,
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
  return `${trimmed}/${config.model}:generateContent`;
}

// Gemini's generationConfig.seed is a 32-bit signed int. Our request
// carries seed as a string (the per-scene seed value). FNV-1a hash to
// a stable int32 so two calls with the same seed string deterministically
// hit the same Gemini seed.
function hashSeedToInt32(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Math.imul already returns a signed int32; just normalize.
  return hash | 0;
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
