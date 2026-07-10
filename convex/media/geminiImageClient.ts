// Gemini Flash Image client. Wraps the `gemini-3.1-flash-image-preview`
// (aka "Nano Banana 2") endpoint which differs from the Imagen 4 fast model
// in two important ways:
//
//   1. It accepts a multi-modal input: text + 0..N inline reference images,
//      passed as inlineData parts inside `contents[0].parts`. The model
//      conditions on the references → consistent character / setting /
//      style across the read.
//   2. The response shape is the standard generateContent envelope —
//      `candidates[0].content.parts[*]` — and the generated image bytes
//      arrive as the FIRST `inlineData.data` part (base64-encoded PNG).
//      No `predictions[]` like Imagen.
//
// This is the renderer we use for scene illustrations on every turn after
// turn 1 (turn 1 generates its anchors via this same client, just with
// referenceImages=[]). Callers fall back to the existing Imagen 4 fast
// path in `imagenClient.ts:maybeRunImagen` when this returns null or
// throws — text + reduced-motion playback must never block on Gemini.
//
// Auth: `x-goog-api-key`. Reuses `GEMINI_API_KEY`; no new env var needed.

export type GeminiImageBytes = { bytes: string; mime: string };

export type GeminiImageReference = { bytes: Uint8Array; mime: string };

// Hard ceiling on inline references. Gemini Flash Image documents
// multi-image input but performance/quality degrades past a small number;
// the design pins us at 2 anchors (protagonist + setting) so 4 is a
// generous upper bound that still keeps the request body small.
const MAX_REFERENCE_IMAGES = 4;

// The model name lives here so the unit test can pin it without a live
// fetch. Override via env when iterating on a newer revision.
// Default: Nano Banana 2 (`gemini-3.1-flash-image`, now GA — dropped the
// `-preview` suffix). It gives 4K output, 4-image character consistency, and
// reference-image support, which is exactly what the protagonist/setting
// anchor carry-over pipeline needs. Set GEMINI_FLASH_IMAGE_MODEL to
// `gemini-3-pro-image` (Nano Banana Pro: 5-character consistency + world
// knowledge, ~2x cost) for the premium tier, or `gemini-3.1-flash-lite-image`
// (Nano Banana 2 Lite: 1K, cheapest) for cost-optimized runs. Earlier deploys
// used `gemini-2.5-flash-image-preview` (Nano Banana 1).
export function resolveGeminiImageModel(): string {
  return process.env.GEMINI_FLASH_IMAGE_MODEL?.trim() || "gemini-3.1-flash-image";
}

/**
 * Build the request body for a Gemini Flash Image call. Exported and
 * pure so the unit test can pin the exact shape (inlineData parts come
 * FIRST, text part comes LAST — recommended ordering for multi-modal
 * conditioning per the AI Studio docs).
 *
 * Each reference's bytes are base64-encoded inline. Callers pass already-
 * decoded `Uint8Array`s (from `ctx.storage.get` + arrayBuffer) so we don't
 * pay the decode/re-encode cost on every scene; this helper only handles
 * the byte→base64 step before the wire payload is assembled.
 *
 * Returns the body the action will JSON-stringify and POST.
 */
export function buildGeminiImageRequestBody(input: {
  prompt: string;
  referenceImages?: ReadonlyArray<GeminiImageReference>;
}): {
  contents: Array<{
    role: "user";
    parts: Array<
      | { inline_data: { mime_type: string; data: string } }
      | { text: string }
    >;
  }>;
  generationConfig: { responseModalities: ["IMAGE"] };
} {
  const refs = (input.referenceImages ?? []).slice(0, MAX_REFERENCE_IMAGES);
  // Wrap the caller's prompt with explicit instruction to honour the
  // references when any are present. Without this, the model can drift —
  // the references must be the dominant signal for character + setting,
  // not just suggestive style cues. The wrapper text intentionally
  // mentions WHAT the references are (protagonist + setting) without
  // hard-coding the order, since callers may pass only one anchor when
  // the other anchor failed to generate.
  const guidedPrompt = refs.length > 0
    ? [
        "Generate this scene.",
        "CRITICAL: maintain visual consistency with the reference images above —",
        "same protagonist face, same wardrobe, same setting style. Do not change the",
        "character's identity, ethnicity, age, or clothing palette. Match the",
        "lighting and art style of the references.",
        "",
        input.prompt,
      ].join(" ")
    : input.prompt;

  const parts: Array<
    | { inline_data: { mime_type: string; data: string } }
    | { text: string }
  > = [];
  for (const ref of refs) {
    parts.push({
      inline_data: {
        mime_type: ref.mime || "image/png",
        data: encodeUint8ArrayToBase64(ref.bytes),
      },
    });
  }
  parts.push({ text: guidedPrompt });

  return {
    contents: [{ role: "user", parts }],
    generationConfig: { responseModalities: ["IMAGE"] },
  };
}

/**
 * Parse the Gemini Flash Image response. Returns the first part with
 * inlineData (the generated PNG). Exported so the unit test can pin the
 * parser against fixture payloads without hitting the network.
 *
 * Response shape (from generateContent):
 *   {
 *     candidates: [{
 *       content: {
 *         parts: [
 *           { inlineData: { data: "<base64 png>", mimeType: "image/png" } },
 *           ...
 *         ]
 *       }
 *     }, ...]
 *   }
 *
 * Some preview revisions key the inline data as `inline_data` (snake_case)
 * instead of `inlineData` (camelCase). We try both — the wire protocol
 * tolerates either form when the underlying transport is JSON.
 */
export function parseGeminiImageResponse(payload: unknown): GeminiImageBytes | null {
  if (!payload || typeof payload !== "object") return null;
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const content = (candidate as { content?: unknown }).content;
    if (!content || typeof content !== "object") continue;
    const parts = (content as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const partRecord = part as Record<string, unknown>;
      // Try camelCase first (documented shape), then snake_case (some
      // preview revisions emit the latter — same as the request side).
      const inline =
        (partRecord.inlineData as { data?: unknown; mimeType?: unknown } | undefined) ??
        (partRecord.inline_data as { data?: unknown; mime_type?: unknown } | undefined);
      if (!inline) continue;
      const data = (inline as { data?: unknown }).data;
      if (typeof data !== "string" || data.length === 0) continue;
      const mime =
        (inline as { mimeType?: unknown }).mimeType ??
        (inline as { mime_type?: unknown }).mime_type;
      return {
        bytes: data,
        mime: typeof mime === "string" && mime.length > 0 ? mime : "image/png",
      };
    }
  }
  return null;
}

/**
 * Generate an image via Gemini Flash Image. Pass `referenceImages` as
 * inline parts so the model carries character / setting consistency from
 * the anchors. Returns null when the API call fails for any reason —
 * callers MUST fall back to the existing `maybeRunImagen` text-only path
 * so a Gemini outage never blocks the scene.
 *
 * The fallback policy is enforced here (we return null on error and log)
 * rather than throwing because the parent action's try/catch would still
 * have to map to the same null-or-bytes shape; centralising it keeps the
 * call-site simple.
 */
export async function runGeminiImage(input: {
  prompt: string;
  apiKey: string;
  referenceImages?: ReadonlyArray<GeminiImageReference>;
}): Promise<GeminiImageBytes | null> {
  const model = resolveGeminiImageModel();
  const refCount = Math.min(input.referenceImages?.length ?? 0, MAX_REFERENCE_IMAGES);
  // Diagnostic: model + refCount + prompt length. NOT the prompt content
  // (that's already logged at the sceneMedia layer). Keys are scrubbed
  // implicitly — we only log the length + prefix/suffix.
  console.log(
    `[geminiImageClient] model=${model} refCount=${refCount} promptLen=${input.prompt.length} keyLen=${input.apiKey.length} keyPrefix=${input.apiKey.slice(0, 6)} keySuffix=${input.apiKey.slice(-4)}`,
  );

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = buildGeminiImageRequestBody({
    prompt: input.prompt,
    ...(input.referenceImages ? { referenceImages: input.referenceImages } : {}),
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": input.apiKey },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "gemini_image_fetch_failed";
    console.warn(`[geminiImageClient] fetch threw: ${message}`);
    return null;
  }

  if (!res.ok) {
    const text = await res.text();
    const safe = text.replace(input.apiKey, "<redacted>").slice(0, 400);
    console.warn(`[geminiImageClient] non-2xx ${res.status}: ${safe}`);
    return null;
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : "gemini_image_invalid_json";
    console.warn(`[geminiImageClient] json parse failed: ${message}`);
    return null;
  }

  const parsed = parseGeminiImageResponse(payload);
  if (!parsed) {
    console.warn(
      `[geminiImageClient] response had no inline image part — falling back. candidates=${
        Array.isArray((payload as { candidates?: unknown } | null)?.candidates)
          ? ((payload as { candidates?: unknown[] }).candidates ?? []).length
          : 0
      }`,
    );
    return null;
  }
  return parsed;
}

// Encode a Uint8Array as a base64 string. Mirrors the helper in
// sceneMedia.ts but kept local so this module has no cross-file dep on
// the scene pipeline — geminiImageClient is consumed from both
// sceneMedia.ts (scene illustrations) and the anchor action (turn 1).
function encodeUint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...(chunk as unknown as number[]));
  }
  return btoa(binary);
}
