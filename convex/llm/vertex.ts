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
    generate: async (request: SceneGenerationRequest, signal?: AbortSignal): Promise<ProviderGeneration> => {
      if (!available) throw new Error("vertex_not_configured");
      const prompt = buildProviderPrompt(request);
      // JSON-mode soft hint via responseMimeType. We do NOT pass
      // `responseSchema` (grammar-constrained output). Empirically
      // (11-trial test on 2026-05-28), gemini-3-flash-preview ignores
      // the schema's `maxLength` constraints and fills the entire
      // `maxOutputTokens` budget on every turn, producing 30+s latencies
      // and frequent MAX_TOKENS truncation mid-string. With schema OFF
      // and only the mime-type hint, the same model returns parseable
      // JSON in 4-5s consistently. The engine's Zod parser
      // (`packages/engine/src/llm.ts`) is the actual schema gate.
      //
      // `thinkingConfig.thinkingLevel: "minimal"` is required: without
      // it Gemini 3 Flash spends the entire maxOutputTokens budget on
      // hidden reasoning and returns an empty `text` part.
      // Per-turn seed: the previous version passed only `request.seed`
      // (which is the SAVE's premise text — constant across every turn of
      // a story). That made every turn sample from the same RNG point and
      // collapsed scenes onto a single high-probability arc ("every scene
      // feels the same"). Mixing in turnNumber + nodeId gives a unique
      // seed per turn while keeping the sampler deterministic for replay.
      const perTurnSeedSource = [
        request.seed ?? "",
        String(request.turnNumber ?? 0),
        request.nodeId ?? "",
      ].join("|");
      const generationConfig: Record<string, unknown> = {
        // Creative-knob tuning (2026-05-28):
        //   - temperature 0.92: 0.75 was conservative for interactive
        //     fiction; 0.92 sits in the IF-creative band without going
        //     incoherent.
        //   - topP 0.95 / topK 64: explicit nucleus + top-k bound so the
        //     model has a wider sampling pool per token, breaking up the
        //     "same beats every turn" feel.
        temperature: 0.92,
        topP: 0.95,
        topK: 64,
        // 8K is a generous latency backstop. Without responseSchema the
        // model self-terminates well below this — observed 600-1500
        // tokens per scene in trials. If we ever see MAX_TOKENS again in
        // the [vertex-diag] log, the prompt is the problem, not this cap.
        maxOutputTokens: request.mode === "llm-driven" ? 8_192 : 2048,
        seed: hashSeedToInt32(perTurnSeedSource),
        thinkingConfig: { thinkingLevel: "minimal" },
      };
      if (request.mode === "llm-driven") {
        generationConfig.responseMimeType = "application/json";
      }
      const __vertexT0 = Date.now();
      console.log(`[vertex-diag] start save=${request.saveId} promptLen=${prompt.length} mode=${request.mode} timeoutMs=${config.timeoutMs} url=${vertexGenerateUrl(config).slice(0, 80)}`);
      let response: unknown;
      try {
        response = await postJson({
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
          ...(signal ? { signal } : {}),
        });
        console.log(`[vertex-diag] ok save=${request.saveId} elapsedMs=${Date.now() - __vertexT0}`);
      } catch (err) {
        const msg = err instanceof Error ? `${err.name}:${err.message}` : String(err);
        console.warn(`[vertex-diag] FAIL save=${request.saveId} elapsedMs=${Date.now() - __vertexT0} err=${msg.slice(0, 240)}`);
        throw err;
      }
      // Operator signal: detect MAX_TOKENS truncation explicitly. Even
      // with responseSchema, an oversized response can still hit the cap;
      // when it does, the JSON arrives complete-but-shorter rather than
      // mid-string, but it's worth flagging so we can bump the budget or
      // shrink the prompt.
      const finishReason = (
        response as { candidates?: Array<{ finishReason?: string }> }
      )?.candidates?.[0]?.finishReason;
      if (finishReason === "MAX_TOKENS") {
        console.warn(
          `[vertex] generation hit MAX_TOKENS cap (${generationConfig.maxOutputTokens}) — consider raising or shortening the prompt`,
        );
      }
      const rawText = extractVertexText(response);
      // Re-nest the flattened inventory_add shape from the wire schema
      // back into the engine's expected `{ item: { id, label } }` form.
      // The wire flattening is forced by a Gemini responseSchema quirk
      // (see responseSchema.ts INVENTORY_ADD_EFFECT comment); the
      // downstream Zod parser + engine reducer expect the nested shape.
      const text = request.mode === "llm-driven" ? normalizeFlatInventoryAdd(rawText) : rawText;
      const usage = (response as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata;
      return generationFromText({
        provider: "vertex",
        request,
        prompt,
        text,
        tokenUsage: { input: usage?.promptTokenCount, output: usage?.candidatesTokenCount },
        modelId: config.model,
      });
    },
  };
}

/**
 * Re-nest flattened inventory_add effects. Wire shape (forced by
 * Gemini responseSchema): `{ kind: "inventory_add", itemId, itemLabel }`.
 * Engine shape (expected by Zod + reducer): `{ kind: "inventory_add",
 * item: { id, label } }`. This pass walks every choice's effects array
 * and rewrites in place. Idempotent: a proposal that already arrived in
 * the nested form (e.g. from a non-Vertex provider or a model that
 * ignored the wire schema) passes through unchanged.
 */
function normalizeFlatInventoryAdd(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return text;
  let payload: any;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    return text;
  }
  const choices = Array.isArray(payload?.choices) ? payload.choices : null;
  if (!choices) return text;
  let changed = false;
  for (const choice of choices) {
    const effects = Array.isArray(choice?.effects) ? choice.effects : null;
    if (!effects) continue;
    for (const eff of effects) {
      if (
        eff &&
        typeof eff === "object" &&
        eff.kind === "inventory_add" &&
        !eff.item &&
        typeof eff.itemId === "string" &&
        typeof eff.itemLabel === "string"
      ) {
        eff.item = { id: eff.itemId, label: eff.itemLabel };
        delete eff.itemId;
        delete eff.itemLabel;
        changed = true;
      }
    }
  }
  return changed ? JSON.stringify(payload) : text;
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
