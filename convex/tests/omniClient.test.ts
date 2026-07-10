import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildOmniRequestBody,
  extractOmniVideo,
  parseOmniFileName,
  resolveOmniModel,
  type OmniCinematicRequest,
} from "../media/omniClient";

function req(overrides: Partial<OmniCinematicRequest> = {}): OmniCinematicRequest {
  return {
    prompt: "A hero stands at the cliff edge as dawn breaks.",
    references: [],
    durationSeconds: 8,
    resolution: "720p",
    aspectRatio: "16:9",
    audio: false,
    ...overrides,
  };
}

describe("resolveOmniModel", () => {
  const saved = process.env.GEMINI_OMNI_MODEL;
  afterEach(() => {
    if (saved === undefined) delete process.env.GEMINI_OMNI_MODEL;
    else process.env.GEMINI_OMNI_MODEL = saved;
  });

  it("defaults to gemini-omni-flash-preview", () => {
    delete process.env.GEMINI_OMNI_MODEL;
    expect(resolveOmniModel()).toBe("gemini-omni-flash-preview");
  });

  it("honors the GEMINI_OMNI_MODEL override (trimmed)", () => {
    process.env.GEMINI_OMNI_MODEL = "  gemini-omni-flash-next  ";
    expect(resolveOmniModel()).toBe("gemini-omni-flash-next");
  });

  it("falls back to the default for a blank override", () => {
    process.env.GEMINI_OMNI_MODEL = "   ";
    expect(resolveOmniModel()).toBe("gemini-omni-flash-preview");
  });
});

describe("buildOmniRequestBody", () => {
  const saved = process.env.GEMINI_OMNI_MODEL;
  beforeEach(() => {
    delete process.env.GEMINI_OMNI_MODEL;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.GEMINI_OMNI_MODEL;
    else process.env.GEMINI_OMNI_MODEL = saved;
  });

  it("builds a text_to_video body with no images", () => {
    const body = buildOmniRequestBody(req());
    expect(body).toEqual({
      model: "gemini-omni-flash-preview",
      input: [{ type: "text", text: "A hero stands at the cliff edge as dawn breaks." }],
      response_format: { type: "video", aspect_ratio: "16:9", delivery: "uri" },
      generation_config: { video_config: { task: "text_to_video" } },
    });
  });

  it("builds a reference_to_video body with subject references (images first, text last)", () => {
    const body = buildOmniRequestBody(
      req({
        references: [
          { bytesBase64: "PROTAG", mimeType: "image/png" },
          { bytesBase64: "SETTING", mimeType: "image/jpeg" },
        ],
        aspectRatio: "9:16",
      }),
    );
    expect(body.generation_config.video_config.task).toBe("reference_to_video");
    expect(body.response_format).toEqual({ type: "video", aspect_ratio: "9:16", delivery: "uri" });
    expect(body.input).toEqual([
      { type: "image", data: "PROTAG", mime_type: "image/png" },
      { type: "image", data: "SETTING", mime_type: "image/jpeg" },
      { type: "text", text: "A hero stands at the cliff edge as dawn breaks." },
    ]);
  });

  it("uses image_to_video for a single seed still (the API's strict 1-image mode)", () => {
    const body = buildOmniRequestBody(req({ i2vStill: { bytesBase64: "FRAME", mimeType: "image/png" } }));
    expect(body.generation_config.video_config.task).toBe("image_to_video");
    expect(body.input).toEqual([
      { type: "image", data: "FRAME", mime_type: "image/png" },
      { type: "text", text: "A hero stands at the cliff edge as dawn breaks." },
    ]);
  });

  it("promotes a seed still + references (2+ images) to reference_to_video, not image_to_video", () => {
    // The live API rejects image_to_video with >1 image; multi-image goes through
    // reference_to_video (up to 7 subjects). The i2v still leads, refs follow.
    const body = buildOmniRequestBody(
      req({
        i2vStill: { bytesBase64: "FRAME", mimeType: "image/png" },
        references: [{ bytesBase64: "COMPANION", mimeType: "image/png" }],
      }),
    );
    expect(body.generation_config.video_config.task).toBe("reference_to_video");
    expect(body.input).toEqual([
      { type: "image", data: "FRAME", mime_type: "image/png" },
      { type: "image", data: "COMPANION", mime_type: "image/png" },
      { type: "text", text: "A hero stands at the cliff edge as dawn breaks." },
    ]);
  });

  it("caps reference images at seven", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ bytesBase64: `R${i}`, mimeType: "image/png" as const }));
    const body = buildOmniRequestBody(req({ references: many }));
    const imageParts = body.input.filter((p) => (p as { type: string }).type === "image");
    expect(imageParts).toHaveLength(7);
    expect(body.generation_config.video_config.task).toBe("reference_to_video");
  });

  it("appends a native-audio directive to the prompt when audio is requested", () => {
    const body = buildOmniRequestBody(req({ audio: true }));
    const textPart = body.input.at(-1) as { type: "text"; text: string };
    expect(textPart.type).toBe("text");
    expect(textPart.text.startsWith("A hero stands at the cliff edge as dawn breaks.")).toBe(true);
    expect(textPart.text).toContain("synchronized ambient soundscape");
  });

  it("uses the GEMINI_OMNI_MODEL override in the body", () => {
    process.env.GEMINI_OMNI_MODEL = "gemini-omni-flash-next";
    expect(buildOmniRequestBody(req()).model).toBe("gemini-omni-flash-next");
  });
});

describe("extractOmniVideo / parseOmniFileName", () => {
  const uriEnvelope = {
    id: "v1_abc",
    status: "completed",
    object: "interaction",
    steps: [
      { type: "user_input", content: [{ type: "text", text: "prompt" }] },
      { type: "thought", content: [{ type: "thought", text: "..." }] },
      {
        type: "model_output",
        content: [
          {
            type: "video",
            mime_type: "video/mp4",
            uri: "https://generativelanguage.googleapis.com/v1beta/files/xyz123:download?alt=media",
          },
        ],
      },
    ],
  };

  it("extracts the video uri from a model_output step", () => {
    expect(extractOmniVideo(uriEnvelope)).toEqual({
      uri: "https://generativelanguage.googleapis.com/v1beta/files/xyz123:download?alt=media",
      mimeType: "video/mp4",
    });
  });

  it("extracts inline base64 video data", () => {
    const inline = {
      steps: [
        { type: "model_output", content: [{ type: "video", mime_type: "video/mp4", data: "AAAA" }] },
      ],
    };
    expect(extractOmniVideo(inline)).toEqual({ data: "AAAA", mimeType: "video/mp4" });
  });

  it("parses the Files resource name from the video uri", () => {
    expect(parseOmniFileName(uriEnvelope)).toBe("files/xyz123");
  });

  it("returns null when there is no video part", () => {
    expect(extractOmniVideo({ steps: [{ type: "model_output", content: [] }] })).toBeNull();
    expect(parseOmniFileName({ steps: [] })).toBeNull();
    expect(extractOmniVideo(null)).toBeNull();
  });

  it("returns null when the video part is inline-only (no pollable file)", () => {
    const inline = {
      steps: [{ type: "model_output", content: [{ type: "video", data: "AAAA" }] }],
    };
    expect(parseOmniFileName(inline)).toBeNull();
  });
});
