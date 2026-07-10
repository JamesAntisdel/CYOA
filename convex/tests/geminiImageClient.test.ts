// Tests for the Gemini Flash Image client. We exercise the pure
// request-body builder + response parser against fixture payloads —
// `runGeminiImage` itself talks to the live API so it stays out of CI,
// mirroring the existing media.test.ts treatment of `maybeRunImagen`.

import { describe, expect, it } from "vitest";

import {
  buildGeminiImageRequestBody,
  parseGeminiImageResponse,
  resolveGeminiImageModel,
} from "../media/geminiImageClient";

describe("resolveGeminiImageModel", () => {
  it("defaults to gemini-3.1-flash-image (Nano Banana 2, GA)", () => {
    delete process.env.GEMINI_FLASH_IMAGE_MODEL;
    expect(resolveGeminiImageModel()).toBe("gemini-3.1-flash-image");
  });

  it("honours the GEMINI_FLASH_IMAGE_MODEL env override", () => {
    process.env.GEMINI_FLASH_IMAGE_MODEL = "gemini-3.1-flash-image-stable";
    try {
      expect(resolveGeminiImageModel()).toBe("gemini-3.1-flash-image-stable");
    } finally {
      delete process.env.GEMINI_FLASH_IMAGE_MODEL;
    }
  });
});

describe("buildGeminiImageRequestBody", () => {
  it("emits a single text part when no references are supplied", () => {
    const body = buildGeminiImageRequestBody({ prompt: "A wide shot of the cliff at dawn." });
    expect(body).toEqual({
      contents: [
        {
          role: "user",
          parts: [{ text: "A wide shot of the cliff at dawn." }],
        },
      ],
      generationConfig: { responseModalities: ["IMAGE"] },
    });
  });

  it("orders inline references BEFORE the text part and wraps the prompt with consistency guidance", () => {
    const proto = new Uint8Array([1, 2, 3, 4]);
    const setting = new Uint8Array([9, 9]);
    const body = buildGeminiImageRequestBody({
      prompt: "Scene visual.",
      referenceImages: [
        { bytes: proto, mime: "image/png" },
        { bytes: setting, mime: "image/jpeg" },
      ],
    });
    expect(body.contents[0]?.parts).toHaveLength(3);
    // First two parts are the inline anchors, in the order supplied.
    expect(body.contents[0]?.parts[0]).toMatchObject({
      inline_data: { mime_type: "image/png" },
    });
    expect(body.contents[0]?.parts[1]).toMatchObject({
      inline_data: { mime_type: "image/jpeg" },
    });
    const textPart = body.contents[0]?.parts[2] as { text: string };
    expect(textPart.text).toContain("Scene visual.");
    expect(textPart.text).toContain("CRITICAL");
    expect(textPart.text).toContain("same protagonist face");
  });

  it("caps reference inputs at 4 anchors to keep the request body small", () => {
    const bytes = new Uint8Array([0]);
    const body = buildGeminiImageRequestBody({
      prompt: "X.",
      referenceImages: [
        { bytes, mime: "image/png" },
        { bytes, mime: "image/png" },
        { bytes, mime: "image/png" },
        { bytes, mime: "image/png" },
        { bytes, mime: "image/png" },
        { bytes, mime: "image/png" },
      ],
    });
    expect(body.contents[0]?.parts).toHaveLength(5); // 4 anchors + text
  });

  it("falls back to image/png when the reference's mime is empty", () => {
    const body = buildGeminiImageRequestBody({
      prompt: "X.",
      referenceImages: [{ bytes: new Uint8Array([0]), mime: "" }],
    });
    expect(body.contents[0]?.parts[0]).toMatchObject({
      inline_data: { mime_type: "image/png" },
    });
  });

  it("does NOT wrap the prompt with consistency guidance when zero references are supplied", () => {
    const body = buildGeminiImageRequestBody({
      prompt: "Anchor portrait.",
      referenceImages: [],
    });
    const textPart = body.contents[0]?.parts[0] as { text: string };
    expect(textPart.text).toBe("Anchor portrait.");
    expect(textPart.text).not.toContain("CRITICAL");
  });
});

describe("parseGeminiImageResponse", () => {
  it("returns the first inlineData part from the documented camelCase shape", () => {
    const parsed = parseGeminiImageResponse({
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { data: "abcd", mimeType: "image/png" } },
              { text: "ignored" },
            ],
          },
        },
      ],
    });
    expect(parsed).toEqual({ bytes: "abcd", mime: "image/png" });
  });

  it("falls back to snake_case inline_data for preview revisions that emit it", () => {
    const parsed = parseGeminiImageResponse({
      candidates: [
        {
          content: {
            parts: [{ inline_data: { data: "wxyz", mime_type: "image/jpeg" } }],
          },
        },
      ],
    });
    expect(parsed).toEqual({ bytes: "wxyz", mime: "image/jpeg" });
  });

  it("defaults the mime to image/png when the response omits it", () => {
    const parsed = parseGeminiImageResponse({
      candidates: [
        {
          content: {
            parts: [{ inlineData: { data: "abcd" } }],
          },
        },
      ],
    });
    expect(parsed).toEqual({ bytes: "abcd", mime: "image/png" });
  });

  it("returns null when the response is empty or shaped wrong", () => {
    expect(parseGeminiImageResponse(null)).toBeNull();
    expect(parseGeminiImageResponse({})).toBeNull();
    expect(parseGeminiImageResponse({ candidates: [] })).toBeNull();
    expect(parseGeminiImageResponse({ candidates: [{ content: {} }] })).toBeNull();
    expect(
      parseGeminiImageResponse({ candidates: [{ content: { parts: [{ text: "no image" }] } }] }),
    ).toBeNull();
    // inlineData with empty data string is treated as absent (preview API
    // sometimes returns an empty payload when safety filters fired).
    expect(
      parseGeminiImageResponse({
        candidates: [{ content: { parts: [{ inlineData: { data: "" } }] } }],
      }),
    ).toBeNull();
  });

  it("skips non-inline parts and returns the first inline part in order", () => {
    const parsed = parseGeminiImageResponse({
      candidates: [
        {
          content: {
            parts: [
              { text: "preamble" },
              { text: "more preamble" },
              { inlineData: { data: "first", mimeType: "image/png" } },
              { inlineData: { data: "second", mimeType: "image/png" } },
            ],
          },
        },
      ],
    });
    expect(parsed).toEqual({ bytes: "first", mime: "image/png" });
  });
});
