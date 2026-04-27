import { describe, expect, it } from "vitest";

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
} from "../index";
import type { SceneGenerationRequest } from "../llm/types";

function request(overrides: Partial<SceneGenerationRequest> = {}): SceneGenerationRequest {
  return {
    saveId: "save",
    storyId: "story",
    nodeId: "node",
    seed: "A quiet room waits.",
    memory: [],
    choices: [{ choiceId: "go", label: "Go on" }],
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
  it("routes low-risk non-mature prose to DeepSeek when available", async () => {
    const router = new LlmRouter([
      createAnthropicProvider(),
      createVertexProvider(),
      createDeepSeekProvider(),
      createDeterministicProvider(),
    ]);

    const result = await router.generateScene(request());

    expect(result.generation.provider).toBe("deepseek");
    expect(result.parsed.prose).toContain("quiet room");
  });

  it("routes sensitive turns to quality/fallback providers, not DeepSeek", async () => {
    const router = new LlmRouter([
      createAnthropicProvider(false),
      createVertexProvider(),
      createDeepSeekProvider(),
      createDeterministicProvider(),
    ]);

    expect((await router.generateScene(request({ risk: "sensitive" }))).generation.provider).toBe("vertex");
  });

  it("uses deterministic fallback when policy blocks generated text", async () => {
    const unsafeProvider = {
      ...createAnthropicProvider(),
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
    const deepseek = createDeepSeekProvider();
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
});
