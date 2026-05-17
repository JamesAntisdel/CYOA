import { buildScenePrompt } from "./prompts/scene";
import type { ProviderGeneration, ProviderName, SceneGenerationRequest } from "./types";
import { estimateTokenUsage } from "./deterministic";

export type LlmHttpConfig = {
  apiKey?: string | undefined;
  baseUrl: string;
  model: string;
  timeoutMs: number;
};

export function buildProviderPrompt(request: SceneGenerationRequest): string {
  if (request.mode === "llm-driven") {
    // The llm-driven prompt already prescribes the exact JSON shape. Don't
    // double-spec a second, narrower shape — that confused providers in
    // practice and produced authored-style payloads in llm-driven runs.
    return buildScenePrompt(request);
  }
  return [
    buildScenePrompt(request),
    "",
    "Return either plain prose or compact JSON with this exact shape:",
    '{"prose":"...","choiceMetadata":[{"choiceId":"...","tone":"optional","label":"optional"}]}',
  ].join("\n");
}

export async function postJson(input: {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
}): Promise<unknown> {
  assertSafeProviderUrl(input.url, input.headers);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...input.headers,
      },
      body: JSON.stringify(input.body),
      signal: controller.signal,
    });
    const text = await response.text();
    const body = parseJsonOrText(text);
    if (!response.ok) {
      throw new Error(`llm_provider_http_${response.status}:${readProviderError(body)}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export function generationFromText(input: {
  provider: ProviderName;
  request: SceneGenerationRequest;
  prompt: string;
  text: string;
  tokenUsage?: { input?: number | undefined; output?: number | undefined } | undefined;
}): ProviderGeneration {
  const fallback = estimateTokenUsage(input.prompt, input.text);
  return {
    provider: input.provider,
    text: input.text,
    tokenUsage: {
      input: input.tokenUsage?.input ?? fallback.input,
      output: input.tokenUsage?.output ?? fallback.output,
    },
  };
}

export function readEnv(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export function readTimeoutMs(): number {
  const raw = readEnv("LLM_TIMEOUT_MS");
  const parsed = raw ? Number(raw) : 15_000;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15_000;
}

export function isLocalProviderUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "provider-mocks" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "0.0.0.0" ||
      parsed.hostname === "host.docker.internal"
    );
  } catch {
    return false;
  }
}

export function appendPath(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith(path)) return trimmed;
  return `${trimmed}${path}`;
}

function parseJsonOrText(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function readProviderError(body: unknown): string {
  if (typeof body === "string") return body.slice(0, 200);
  if (body && typeof body === "object") {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
  }
  return "unknown";
}

function assertSafeProviderUrl(url: string, headers: Record<string, string>): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && !isLocalProviderUrl(url)) {
    throw new Error("llm_provider_insecure_url");
  }
  const hasCredential = Object.keys(headers).some((key) => ["authorization", "x-api-key"].includes(key.toLowerCase()));
  if (hasCredential && parsed.protocol !== "https:" && !isLocalProviderUrl(url)) {
    throw new Error("llm_provider_insecure_credential_url");
  }
}
