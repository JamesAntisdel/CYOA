// Gemini Omni Flash client for endpoint cinematics (Requirement 3).
//
// Unlike Veo (`predictLongRunning`) and Gemini Flash Image (`generateContent`),
// Omni Flash uses the **Interactions API**:
//
//   POST https://generativelanguage.googleapis.com/v1beta/interactions
//   header: x-goog-api-key: <key>
//   body:  { model, input, response_format, generation_config }
//
// `input` is either a bare string or an array of typed parts:
//   { type: "image", data: "<base64>", mime_type: "image/png" }   (subject refs / i2v frame)
//   { type: "text",  text: "<prompt>" }
// The task is set via `generation_config.video_config.task`:
//   text_to_video | image_to_video | reference_to_video | edit.
// Aspect ratio is `response_format.aspect_ratio`; `response_format.delivery`
// controls inline base64 vs a Files API resource ("uri").
//
// The interaction completes and returns a `steps[]` envelope; the generated
// video arrives in the `model_output` step's `content[]` as a part with
// `type: "video"` carrying either inline `data` (base64) or a `uri` pointing at
// a Files API resource. We force `delivery: "uri"` so large cinematics land as a
// pollable Files resource, letting us mirror the Veo submit -> poll split even
// though the interaction itself is synchronous.
//
// Native synchronized audio is generated automatically for video output and is
// steered by prompt description — there is no explicit wire toggle in the
// preview (see TODO(verify-on-live-key) below).
//
// Auth: `x-goog-api-key` (submit) / `?key=` (Files poll), reusing GEMINI_API_KEY.

import { omniEnabledFromEnv } from "./mediaStrategy";

const OMNI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Resolve the Omni model id. Defaults to the preview id; override with
 * `GEMINI_OMNI_MODEL` when iterating on a newer revision.
 */
export function resolveOmniModel(): string {
  return process.env.GEMINI_OMNI_MODEL?.trim() || "gemini-omni-flash-preview";
}

/**
 * Whether Omni is usable: a GEMINI_API_KEY is present AND the env kill-switch
 * (`OMNI_ENABLED`) is not off. Shares the kill-switch logic with the media
 * strategy resolver so both agree on "is Omni live".
 */
export function omniConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return typeof key === "string" && key.trim().length > 0 && omniEnabledFromEnv();
}

// Gemini Omni Flash accepts up to seven images as reference inputs for
// reference_to_video (subject/world consistency). Cap defensively at the wire.
export const OMNI_MAX_REFERENCE_IMAGES = 7;

export type OmniReference = { bytesBase64: string; mimeType: string };

export type OmniCinematicRequest = {
  prompt: string;
  references: OmniReference[];
  // Optional first-frame still for image-to-video (i2v). When present the task
  // becomes `image_to_video` and this image leads the `input` array.
  i2vStill?: OmniReference | null;
  // Contract fields for cost/provenance. NOTE(verify-on-live-key): the preview
  // Interactions API sets duration/resolution *implicitly via the prompt*, not
  // as request parameters, so these are not currently written to the wire body.
  durationSeconds: number;
  resolution: "720p" | "1080p";
  aspectRatio: "16:9" | "9:16";
  // Request native synchronized audio. There is no explicit wire toggle in the
  // preview; setting this appends an audio directive to the prompt.
  audio: boolean;
};

type OmniImagePart = { type: "image"; data: string; mime_type: string };
type OmniTextPart = { type: "text"; text: string };
type OmniTask = "text_to_video" | "image_to_video" | "reference_to_video";

export type OmniRequestBody = {
  model: string;
  input: Array<OmniImagePart | OmniTextPart>;
  response_format: { type: "video"; aspect_ratio: "16:9" | "9:16"; delivery: "uri" };
  generation_config: { video_config: { task: OmniTask } };
};

/**
 * Build the Interactions API request body for an Omni cinematic. PURE and
 * exported so the unit test can pin the exact wire shape.
 *
 * Ordering mirrors the documented examples: image parts (i2v frame first, then
 * subject references) precede the single text part. The task is inferred from
 * the reference shape.
 *
 * TODO(verify-on-live-key): the preview docs state duration/resolution are
 * prompt-implicit and audio is generated automatically (steered by prompt
 * text). If a future revision exposes explicit `video_config` fields for
 * duration/resolution/audio, wire `req.durationSeconds` / `req.resolution` /
 * `req.audio` here and drop the prompt suffix.
 */
export function buildOmniRequestBody(req: OmniCinematicRequest): OmniRequestBody {
  const images: OmniImagePart[] = [];
  if (req.i2vStill) {
    images.push({ type: "image", data: req.i2vStill.bytesBase64, mime_type: req.i2vStill.mimeType });
  }
  for (const ref of req.references) {
    images.push({ type: "image", data: ref.bytesBase64, mime_type: ref.mimeType });
  }
  // Cap at the model's reference-image limit and pick the task by IMAGE COUNT —
  // the live API gates on exactly this (verified against a 400 + the Gemini Omni
  // docs, July 2026): `image_to_video` accepts exactly ONE image ("Image-to-video
  // does not support more than 1 image."), while `reference_to_video` accepts up
  // to OMNI_MAX_REFERENCE_IMAGES reference subjects for character/world
  // consistency. So: 1 image → image_to_video (animate the seed still); 2+ →
  // reference_to_video (multi-subject conditioning); none → text_to_video.
  const capped = images.slice(0, OMNI_MAX_REFERENCE_IMAGES);
  const task: OmniTask =
    capped.length === 0
      ? "text_to_video"
      : capped.length === 1
        ? "image_to_video"
        : "reference_to_video";

  const promptText = req.audio
    ? `${req.prompt}\n\nInclude a native, synchronized ambient soundscape that matches the visuals.`
    : req.prompt;

  return {
    model: resolveOmniModel(),
    input: [...capped, { type: "text", text: promptText }],
    response_format: { type: "video", aspect_ratio: req.aspectRatio, delivery: "uri" },
    generation_config: { video_config: { task } },
  };
}

type OmniVideoContent = { uri?: string; data?: string; mimeType?: string };

/**
 * Extract the generated video part from an Interactions response envelope.
 * Walks `steps[] -> model_output -> content[]` for the first `type: "video"`
 * part. Exported for unit-testing the parser against fixtures. Tolerates both a
 * top-level `output_video` convenience field and the raw `steps` array.
 */
export function extractOmniVideo(payload: unknown): OmniVideoContent | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;

  // SDK convenience field (best-effort; raw REST uses `steps`).
  const conv = root.output_video;
  if (conv && typeof conv === "object") {
    const c = conv as Record<string, unknown>;
    if (typeof c.uri === "string" || typeof c.data === "string") {
      return {
        ...(typeof c.uri === "string" ? { uri: c.uri } : {}),
        ...(typeof c.data === "string" ? { data: c.data } : {}),
        ...(typeof c.mime_type === "string" ? { mimeType: c.mime_type } : {}),
      };
    }
  }

  const steps = root.steps;
  if (!Array.isArray(steps)) return null;
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    if ((step as Record<string, unknown>).type !== "model_output") continue;
    const content = (step as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      if (p.type !== "video") continue;
      const uri = typeof p.uri === "string" ? p.uri : undefined;
      const data = typeof p.data === "string" ? p.data : undefined;
      if (!uri && !data) continue;
      const mime = typeof p.mime_type === "string" ? p.mime_type : undefined;
      return {
        ...(uri ? { uri } : {}),
        ...(data ? { data } : {}),
        ...(mime ? { mimeType: mime } : {}),
      };
    }
  }
  return null;
}

/**
 * Parse the Files API resource name (`files/<id>`) out of a video `uri` such as
 * `https://.../v1beta/files/<id>:download?alt=media`. Returns null when the uri
 * is absent or not a Files resource. Exported for testing.
 */
export function parseOmniFileName(payload: unknown): string | null {
  const video = extractOmniVideo(payload);
  if (!video?.uri) return null;
  const match = video.uri.match(/\/v1beta\/(files\/[^:?]+)/u);
  return match?.[1] ?? null;
}

/**
 * Submit an Omni cinematic interaction. Returns the pollable Files resource name
 * (e.g. `files/abc123`) to hand to `pollOmniCinematic`, or null on any failure
 * (network, non-2xx, missing video). The API key is scrubbed from all logged
 * error text (see submitVeoLongRunning in sceneMedia.ts).
 *
 * TODO(verify-on-live-key): the Interactions API is documented as synchronous
 * (no operation name). We force `delivery: "uri"` so the result is a Files
 * resource we can poll, preserving the Veo-style submit -> poll contract. If a
 * revision returns an `operations/<name>` handle or only inline base64, adapt
 * the return here (inline base64 currently yields null -> caller falls back).
 */
export async function submitOmniCinematic(
  apiKey: string,
  req: OmniCinematicRequest,
): Promise<string | null> {
  const body = buildOmniRequestBody(req);

  let res: Response;
  try {
    res = await fetch(`${OMNI_BASE}/interactions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "omni_submit_fetch_failed";
    console.warn(`[omniClient] submit fetch threw: ${scrubKey(message, apiKey)}`);
    return null;
  }

  if (!res.ok) {
    const text = await res.text();
    console.warn(`[omniClient] submit non-2xx ${res.status}: ${scrubKey(text, apiKey).slice(0, 800)}`);
    return null;
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : "omni_submit_invalid_json";
    console.warn(`[omniClient] submit json parse failed: ${scrubKey(message, apiKey)}`);
    return null;
  }

  const fileName = parseOmniFileName(payload);
  if (!fileName) {
    console.warn("[omniClient] submit response had no pollable video file uri — falling back.");
    return null;
  }
  return fileName;
}

export type OmniPollResult =
  | { kind: "pending" }
  | { kind: "ready"; videoUri?: string; videoBytesBase64?: string; hasAudio: boolean }
  | { kind: "error"; error: string };

/**
 * Poll a Files resource produced by `submitOmniCinematic`. Returns "pending"
 * while the file is still processing, "ready" with a keyless download uri once
 * it is ACTIVE, or "error" with a scrubbed message. The caller re-schedules on
 * "pending" (same contract as pollVeoOperation).
 *
 * TODO(verify-on-live-key): Omni generates native synchronized audio for video
 * output automatically, and the Files metadata does not expose an audio flag,
 * so `hasAudio` is reported true whenever a video file goes ACTIVE.
 */
export async function pollOmniCinematic(
  apiKey: string,
  operationName: string,
): Promise<OmniPollResult> {
  const pollUrl = `${OMNI_BASE}/${operationName}?key=${encodeURIComponent(apiKey)}`;

  let res: Response;
  try {
    res = await fetch(pollUrl, { method: "GET" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "omni_poll_fetch_failed";
    return { kind: "error", error: `omni_poll_fetch_failed: ${scrubKey(message, apiKey).slice(0, 160)}` };
  }

  if (!res.ok) {
    const text = await res.text();
    return { kind: "error", error: `omni_poll_${res.status}: ${scrubKey(text, apiKey).slice(0, 160)}` };
  }

  let data: { state?: string; error?: { message?: string }; uri?: string; mimeType?: string };
  try {
    data = (await res.json()) as typeof data;
  } catch (err) {
    const message = err instanceof Error ? err.message : "omni_poll_invalid_json";
    return { kind: "error", error: `omni_poll_invalid_json: ${scrubKey(message, apiKey).slice(0, 160)}` };
  }

  if (data.error?.message) {
    return { kind: "error", error: `omni_error: ${scrubKey(data.error.message, apiKey).slice(0, 160)}` };
  }

  const state = data.state;
  if (state === "FAILED") return { kind: "error", error: "omni_file_failed" };
  if (state !== "ACTIVE") return { kind: "pending" };

  // Keyless download uri — the caller appends its own `?key=` when fetching the
  // bytes, so we never persist/return the key inline.
  const videoUri = `${OMNI_BASE}/${operationName}:download?alt=media`;
  return { kind: "ready", videoUri, hasAudio: true };
}

// Strip every occurrence of the API key (raw + url-encoded) from a string so it
// is safe to log or return. Mirrors scrubKeyFromUrl in sceneMedia.ts.
function scrubKey(text: string, apiKey: string): string {
  if (!apiKey) return text;
  return text.split(apiKey).join("<redacted>").split(encodeURIComponent(apiKey)).join("<redacted>");
}
