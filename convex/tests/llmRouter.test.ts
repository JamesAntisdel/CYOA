import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildMemoryWindow,
  buildScenePrompt,
  ClientDisconnectedError,
  collectSceneStream,
  createAnthropicProvider,
  createDeterministicProvider,
  createVertexProvider,
  LlmRouter,
  parseSceneOutput,
  providerEligible,
  sceneGenerationRequestSchema,
} from "../index";
import { createFireworksProvider } from "../llm/fireworks";
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

  it("routes free-tier prose to Fireworks (cheap) when available", async () => {
    const fireworks = {
      ...createFireworksProvider(true),
      name: "fireworks" as const,
      generate: async () => ({
        provider: "fireworks" as const,
        text: "A quiet room waits in silence.",
        tokenUsage: { input: 1, output: 1 },
      }),
    };
    const router = new LlmRouter([
      createAnthropicProvider(true),
      createVertexProvider(true),
      fireworks,
      createDeterministicProvider(),
    ]);

    const result = await router.generateScene(request({ tier: "free" }));

    expect(result.generation.provider).toBe("fireworks");
    expect(result.parsed.prose).toContain("quiet room");
  });

  it("routes pro-tier turns to Vertex when Fireworks and Anthropic are down", async () => {
    const vertex = {
      ...createVertexProvider(true),
      name: "vertex" as const,
      generate: async () => ({
        provider: "vertex" as const,
        text: "A quiet room waits.",
        tokenUsage: { input: 1, output: 1 },
      }),
    };
    const router = new LlmRouter([
      createFireworksProvider(false),
      createAnthropicProvider(false),
      vertex,
      createDeterministicProvider(),
    ]);

    expect(
      (await router.generateScene(request({ tier: "pro", risk: "sensitive" }))).generation.provider,
    ).toBe("vertex");
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
    // Pro tier so Anthropic is actually reached and its blocked output routes
    // through the deterministic safe-end path.
    const router = new LlmRouter([unsafeProvider, createDeterministicProvider()]);

    const result = await router.generateScene(request({ tier: "pro", risk: "normal" }));

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

  it("drops the mature-incapable cheap Fireworks model when mature content is enabled", () => {
    const fireworks = createFireworksProvider(true);
    // Non-mature: the cheap Fireworks model is eligible.
    expect(providerEligible(fireworks, request({ tier: "free" }), "cheap")).toBe(true);
    // Mature enabled: the cheap model (allowsMature=false) is gated OFF...
    const matureReq = request({
      tier: "free",
      contentContext: {
        surface: "generation",
        ageBand: "18+",
        entitlementTier: "pro",
        matureContentEnabled: true,
      },
    });
    expect(providerEligible(fireworks, matureReq, "cheap")).toBe(false);
    // ...but the mid model (allowsMature=true) stays eligible.
    expect(providerEligible(fireworks, matureReq, "mid")).toBe(true);
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

    const result = await router.generateScene(request({ tier: "pro", risk: "sensitive" }));

    expect(result.generation.provider).toBe("deterministic");
    expect(result.safetyAction).toBe("fallback");
  });

  it("stamps isFallback=true on the deterministic provider's generation", async () => {
    // Regression guard for the "press on into the story" bug: when the
    // router falls through to the deterministic provider, the scene must
    // carry the isFallback sentinel so the reader UI renders the
    // FallbackTurnPanel instead of the placeholder prose + choices.
    const failingProvider = {
      ...createAnthropicProvider(true),
      name: "anthropic" as const,
      generate: async () => {
        throw new Error("provider_down");
      },
    };
    const router = new LlmRouter([failingProvider, createDeterministicProvider()]);
    const result = await router.generateScene(request({ tier: "pro", risk: "sensitive" }));
    expect(result.generation.provider).toBe("deterministic");
    expect(result.generation.isFallback).toBe(true);
  });

  it("does NOT stamp isFallback on a successful real-provider generation", async () => {
    // The sentinel must be reserved for the last-resort path. A healthy
    // Fireworks (or any real provider) generation must leave the flag
    // absent so the reader gets the real scene rendered, not the
    // FallbackTurnPanel.
    const fireworks = {
      ...createFireworksProvider(true),
      name: "fireworks" as const,
      generate: async () => ({
        provider: "fireworks" as const,
        text: "A quiet room waits in silence.",
        tokenUsage: { input: 1, output: 1 },
      }),
    };
    const router = new LlmRouter([fireworks, createDeterministicProvider()]);
    const result = await router.generateScene(request({ tier: "free" }));
    expect(result.generation.provider).toBe("fireworks");
    expect(result.generation.isFallback).toBeUndefined();
  });

  it("stamps isFallback=true when policy forces a safe-end through the deterministic path", async () => {
    // The policy-block path also routes through generateDeterministicFallback,
    // so a content-classifier rewrite must produce a fallback-marked scene
    // for the same UI reason — the reader shouldn't see the deterministic
    // placeholder prose as if it were a curated safe-ending.
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
    const result = await router.generateScene(request({ tier: "pro", risk: "normal" }));
    expect(result.generation.provider).toBe("deterministic");
    expect(result.generation.isFallback).toBe(true);
  });

  it("does NOT fall back to deterministic when the abort comes from client disconnect", async () => {
    // Simulates the SSE client closing the connection mid-call: the
    // provider's fetch throws an AbortError, and the router must NOT
    // walk the candidate list or persist the deterministic provider's
    // generic "press on into the story" prose as the canonical result.
    const controller = new AbortController();
    const deterministicGenerate = vi.fn(createDeterministicProvider().generate);
    const deterministic = {
      ...createDeterministicProvider(),
      generate: deterministicGenerate,
    };
    const abortingProvider = {
      ...createAnthropicProvider(true),
      name: "anthropic" as const,
      generate: async () => {
        // Fire the signal first to mirror "client closed the SSE while
        // we were waiting on the provider"; then throw AbortError as
        // the underlying fetch would.
        controller.abort();
        const err = new Error("The user aborted a request.");
        err.name = "AbortError";
        throw err;
      },
    };
    const router = new LlmRouter([abortingProvider, createVertexProvider(false), deterministic]);

    await expect(
      router.generateScene(request({ tier: "pro", risk: "sensitive" }), controller.signal),
    ).rejects.toBeInstanceOf(ClientDisconnectedError);
    expect(deterministicGenerate).not.toHaveBeenCalled();
  });

  it("client-disconnect during SSE stream does not invoke onComplete and does call onError", async () => {
    // End-to-end-ish: the SSE wrapper sees a ClientDisconnectedError and
    // routes to the `failSceneStream` (onError) callback, skipping the
    // `completeSceneStream` (onComplete) callback that would otherwise
    // persist deterministic prose on the scene record.
    const abortingRouter = {
      streamSceneWithResult: async () => {
        throw new ClientDisconnectedError();
      },
      streamScene: async function* () {
        throw new ClientDisconnectedError();
      },
    } as unknown as LlmRouter;

    const completions: unknown[] = [];
    const errors: unknown[] = [];

    const response = sceneStreamResponse(
      request(),
      abortingRouter,
      async (result) => {
        completions.push(result);
      },
      async () => {
        errors.push("fail");
      },
    );
    const text = await response.text();

    expect(completions).toEqual([]);
    expect(errors).toEqual(["fail"]);
    // Client is gone — we MUST NOT emit a fake error event "to" them
    // either; that would be a noop at best and an exception (enqueue on
    // a cancelled controller) at worst.
    expect(text).not.toContain("llm_stream_failed");
    expect(text).not.toContain("event: done");
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
