import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildMemoryWindow,
  buildScenePrompt,
  collectSceneStream,
  createAnthropicProvider,
  createDeepSeekProvider,
  createDeterministicProvider,
  createVertexProvider,
  LlmRouter,
  parseSceneOutput,
  providerEligible,
  sceneGenerationRequestSchema,
} from "../index";
import { sceneStreamResponse } from "../http";
import { postJson } from "../llm/httpClient";
import type { SceneGenerationRequest } from "../llm/types";

function request(overrides: Partial<SceneGenerationRequest> = {}): SceneGenerationRequest {
  return {
    saveId: "save",
    storyId: "story",
    nodeId: "node",
    seed: "A quiet room waits.",
    memory: [],
    choices: [{ choiceId: "go", label: "Go on" }],
    sceneLength: "standard",
    contentContext: {
      surface: "generation",
      entitlementTier: "free",
      matureContentEnabled: false,
    },
    risk: "low",
    entitlementTier: "free",
    retryCount: 0,
    ...overrides,
  };
}

describe("llm router", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes low-risk non-mature prose to DeepSeek when available", async () => {
    const router = new LlmRouter([
      createAnthropicProvider(true),
      createVertexProvider(true),
      createDeepSeekProvider(true),
      createDeterministicProvider(),
    ]);

    const result = await router.generateScene(request());

    expect(result.generation.provider).toBe("deepseek");
    expect(result.parsed.prose).toContain("quiet room");
  });

  it("routes sensitive turns to quality/fallback providers, not DeepSeek", async () => {
    const router = new LlmRouter([
      createAnthropicProvider(false),
      createVertexProvider(true),
      createDeepSeekProvider(true),
      createDeterministicProvider(),
    ]);

    expect((await router.generateScene(request({ risk: "sensitive" }))).generation.provider).toBe("vertex");
  });

  it("uses deterministic fallback when policy blocks generated text", async () => {
    const unsafeProvider = {
      ...createAnthropicProvider(true),
      name: "anthropic" as const,
      generate: async () => ({
        provider: "anthropic" as const,
        text: "The narration says you are worthless.",
        tokenUsage: { input: 1, output: 1 },
      }),
    };
    const router = new LlmRouter([unsafeProvider, createDeterministicProvider()]);

    const result = await router.generateScene(request({ risk: "normal" }));

    expect(result.generation.provider).toBe("deterministic");
    expect(result.safetyAction).toBe("safe_end");
  });

  it("streams generated prose as token chunks", async () => {
    const chunks = await collectSceneStream(request(), new LlmRouter([createDeterministicProvider()]));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.provider).toBe("deterministic");
  });

  it("parses JSON scene output and rejects state mutation fields", () => {
    expect(parseSceneOutput('{"prose":"Hello","choiceMetadata":[{"choiceId":"a"}]}')).toEqual({
      prose: "Hello",
      choiceMetadata: [{ choiceId: "a" }],
    });
  });

  it("builds prompt and memory windows", () => {
    expect(buildScenePrompt(request())).toContain("Do not mutate state");
    expect(buildScenePrompt(request({ sceneLength: "rich" }))).toContain("700-1000 words");
    expect(
      buildMemoryWindow({
        currentSeed: "current",
        beats: [
          { id: "1", text: "old", tags: [], turnNumber: 1 },
          { id: "2", text: "new", tags: [], turnNumber: 2 },
        ],
        maxBeats: 1,
      }),
    ).toEqual(["new", "current"]);
  });

  it("limits DeepSeek eligibility to low-risk non-mature context", () => {
    const deepseek = createDeepSeekProvider(true);
    expect(providerEligible(deepseek, request())).toBe(true);
    expect(providerEligible(deepseek, request({ risk: "normal" }))).toBe(false);
    expect(
      providerEligible(
        deepseek,
        request({
          contentContext: {
            surface: "generation",
            ageBand: "18+",
            entitlementTier: "pro",
            matureContentEnabled: true,
          },
        }),
      ),
    ).toBe(false);
  });

  it("calls Anthropic-compatible HTTP providers and parses token usage", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: '{"prose":"The live page turns."}' }],
          usage: { input_tokens: 11, output_tokens: 7 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createAnthropicProvider(true, {
      apiKey: "test-key",
      baseUrl: "https://anthropic.test",
      model: "claude-test",
      timeoutMs: 1000,
    }).generate(request({ risk: "sensitive" }));

    expect(result.text).toContain("live page");
    expect(result.tokenUsage).toEqual({ input: 11, output: 7 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://anthropic.test/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "test-key" }),
      }),
    );
  });

  it("falls back when a live provider errors", async () => {
    const failingProvider = {
      ...createAnthropicProvider(true),
      name: "anthropic" as const,
      generate: async () => {
        throw new Error("provider_down");
      },
    };
    const router = new LlmRouter([failingProvider, createVertexProvider(false), createDeterministicProvider()]);

    const result = await router.generateScene(request({ risk: "sensitive" }));

    expect(result.generation.provider).toBe("deterministic");
    expect(result.safetyAction).toBe("fallback");
  });

  it("validates scene generation requests with Zod", () => {
    expect(sceneGenerationRequestSchema.safeParse(request()).success).toBe(true);
    expect(sceneGenerationRequestSchema.safeParse({ ...request(), retryCount: -1 }).success).toBe(false);
    expect(sceneGenerationRequestSchema.safeParse({ ...request(), choices: [{ label: "Missing id" }] }).success).toBe(false);
  });

  it("streams SSE token and done events", async () => {
    const response = sceneStreamResponse(request(), new LlmRouter([createDeterministicProvider()]));
    const text = await response.text();

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("event: token");
    expect(text).toContain("event: done");
  });

  it("calls the stream completion hook with accumulated prose", async () => {
    const completions: Array<{ prose: string; provider: string }> = [];
    const response = sceneStreamResponse(
      request(),
      new LlmRouter([createDeterministicProvider()]),
      async (result) => {
        completions.push(result);
      },
    );
    await response.text();

    expect(completions[0]?.provider).toBe("deterministic");
    expect(completions[0]?.prose).toContain("quiet room");
  });

  it("does not expose raw provider errors in SSE output", async () => {
    const failingRouter = {
      streamScene: async function* () {
        throw new Error("provider leaked secret details");
      },
    } as unknown as LlmRouter;
    let cleanedUp = false;

    const text = await sceneStreamResponse(request(), failingRouter, undefined, async () => {
      cleanedUp = true;
    }).text();

    expect(text).toContain("llm_stream_failed");
    expect(text).not.toContain("provider leaked secret details");
    expect(cleanedUp).toBe(true);
  });

  it("rejects non-local plain HTTP provider URLs before sending credentials", async () => {
    await expect(
      postJson({
        url: "http://example.com/v1/messages",
        headers: { authorization: "Bearer secret" },
        body: {},
        timeoutMs: 1000,
      }),
    ).rejects.toThrow("llm_provider_insecure_url");
  });
});
