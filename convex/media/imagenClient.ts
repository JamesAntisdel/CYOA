// Shared Imagen + Convex-storage helpers. Extracted from sceneMedia.ts so
// both the scene pipeline and the NPC portrait pipeline (convex/media/npcMedia.ts)
// can call the same code path without duplicating provider logic.
//
// Three concerns live here, all kept dependency-free so they can be imported
// from any media module without dragging in scene-specific types:
//
//   1. `maybeRunImagen`  — provider-dispatching wrapper. Picks the public
//      Gemini API key path first, falls back to Vertex AI predict, returns
//      null when neither is configured (caller decides what to do — scene
//      media falls back to a Picsum placeholder; portraits skip the run).
//   2. `decodeBase64ToUint8Array` — Imagen returns 1–2 MiB of base64 PNG
//      bytes; the caller decodes them before handing the buffer to Convex
//      storage. Past the Convex 1 MiB document-field cap, so we never inline
//      the data: URL.
//   3. `rewriteToPublicOrigin` — self-hosted Convex's `storage.getUrl()`
//      returns its INTERNAL origin (e.g. http://127.0.0.1:3210). Browsers
//      behind a tunnel can't reach that. When CONVEX_PUBLIC_ORIGIN (or
//      EXPO_PUBLIC_CONVEX_URL) is set, swap the scheme+host prefix so the
//      asset URL we hand back through the projection is publicly fetchable.
//
// `aspectRatio` is now a parameter on `maybeRunImagen` — the scene path
// passes "16:9" (cinematic), the portrait path passes "1:1" (square card).

export type ImagenBytes = { bytes: string; mime: string };

export type ImagenAspectRatio = "1:1" | "16:9" | "9:16";

export async function maybeRunImagen(
  prompt: string,
  aspectRatio: ImagenAspectRatio = "16:9",
): Promise<ImagenBytes | null> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    return runImagenViaGeminiApi(prompt, geminiKey, aspectRatio);
  }
  const project = process.env.VERTEX_PROJECT_ID;
  const token = process.env.VERTEX_ACCESS_TOKEN;
  if (project && token) {
    return runImagenViaVertex(prompt, project, token, aspectRatio);
  }
  return null;
}

// Swap the scheme+host of a storage URL for the public-facing origin
// declared by CONVEX_PUBLIC_ORIGIN (or the EXPO_PUBLIC_CONVEX_URL the
// client uses, since they're equivalent). The /api/storage/<id> path is
// preserved as-is. Returns the input unchanged when no public origin is
// configured (the localhost dev case).
export function rewriteToPublicOrigin(url: string): string {
  const publicOrigin = process.env.CONVEX_PUBLIC_ORIGIN ?? process.env.EXPO_PUBLIC_CONVEX_URL;
  if (!publicOrigin) return url;
  // String-replace approach: Convex's V8 runtime rejects the WHATWG URL
  // `host` / `protocol` setters with "Not implemented". Match the
  // scheme://host[:port] prefix and swap it for the public origin's prefix.
  const match = /^(https?:\/\/[^/]+)(.*)$/.exec(url);
  if (!match) return url;
  const trimmedPublic = publicOrigin.replace(/\/+$/, "");
  return `${trimmedPublic}${match[2]}`;
}

export function decodeBase64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function runImagenViaGeminiApi(
  prompt: string,
  apiKey: string,
  aspectRatio: ImagenAspectRatio,
): Promise<ImagenBytes | null> {
  const model = process.env.GEMINI_IMAGE_MODEL ?? "imagen-4.0-fast-generate-001";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`;
  const body = {
    instances: [{ prompt }],
    parameters: { sampleCount: 1, aspectRatio },
  };
  // Diagnostic: confirm the deployment env carries the same key value we
  // expect. Google keys are 39 chars; if length differs the env was pushed
  // wrong (trailing whitespace / truncation / wrong key entirely).
  console.log(
    `[imagenClient] Imagen model=${model} aspect=${aspectRatio} keyLen=${apiKey.length} keyPrefix=${apiKey.slice(0, 6)} keySuffix=${apiKey.slice(-4)}`,
  );
  // TEMP DIAGNOSTIC (revert after image-mismatch root-cause): log the
  // actual prompt content reaching Imagen so we can compare against the
  // LLM's visualDescription field. Truncated to 240 chars to avoid log
  // spam but long enough to identify the subject + setting.
  console.log(
    `[imagenClient][DIAG] prompt(${prompt.length})="${prompt.slice(0, 240).replace(/\s+/g, " ")}"`,
  );
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    const safe = text.replace(apiKey, "<redacted>").slice(0, 200);
    throw new Error(`gemini_imagen_${res.status}: ${safe}`);
  }
  const data = (await res.json()) as { predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }> };
  const first = data.predictions?.[0];
  if (!first?.bytesBase64Encoded) return null;
  return { bytes: first.bytesBase64Encoded, mime: first.mimeType ?? "image/png" };
}

async function runImagenViaVertex(
  prompt: string,
  project: string,
  token: string,
  aspectRatio: ImagenAspectRatio,
): Promise<ImagenBytes | null> {
  const location = process.env.VERTEX_LOCATION ?? "us-central1";
  const model = "imagen-4.0-fast-generate-001";
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:predict`;
  const body = {
    instances: [{ prompt }],
    parameters: { sampleCount: 1, aspectRatio },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`vertex_imagen_${res.status}: ${text.slice(0, 120)}`);
  }
  const data = (await res.json()) as { predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }> };
  const first = data.predictions?.[0];
  if (!first?.bytesBase64Encoded) return null;
  return { bytes: first.bytesBase64Encoded, mime: first.mimeType ?? "image/png" };
}
