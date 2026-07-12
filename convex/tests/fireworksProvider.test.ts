// Fireworks provider (provider-and-credit design §1.1). Exercises the
// OpenAI-compatible call path via a stubbed fetch, plus the tier → model-id
// resolution and the offline-availability precedence.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFireworksProvider,
  fireworksModelId,
  fireworksTierForRequest,
  readFireworksConfig,
  FIREWORKS_DEFAULT_MODELS,
} from "../llm/fireworks";
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
    risk: "normal",
    entitlementTier: "free",
    retryCount: 0,
    ...overrides,
  };
}

const ENV_KEYS = [
  "FIREWORKS_API_KEY",
  "FIREWORKS_BASE_URL",
  "FIREWORKS_MODEL_CHEAP",
  "FIREWORKS_MODEL_MID",
  "FIREWORKS_MODEL_PREMIUM",
  "GEMINI_API_KEY",
  "VERTEX_ACCESS_TOKEN",
  "ANTHROPIC_API_KEY",
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]] as const));
}
function restoreEnv(snap: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("fireworks model-id resolution", () => {
  let snap: Record<string, string | undefined>;
  afterEach(() => restoreEnv(snap));

  it("uses documented defaults when no env override is set", () => {
    snap = snapshotEnv();
    for (const k of ["FIREWORKS_MODEL_CHEAP", "FIREWORKS_MODEL_MID", "FIREWORKS_MODEL_PREMIUM"]) {
      delete process.env[k];
    }
    expect(fireworksModelId("cheap")).toBe(FIREWORKS_DEFAULT_MODELS.cheap);
    expect(fireworksModelId("mid")).toBe(FIREWORKS_DEFAULT_MODELS.mid);
    expect(fireworksModelId("premium")).toBe(FIREWORKS_DEFAULT_MODELS.premium);
    expect(FIREWORKS_DEFAULT_MODELS.cheap).toBe("accounts/fireworks/models/deepseek-v3");
    expect(FIREWORKS_DEFAULT_MODELS.premium).toBe("accounts/fireworks/models/glm-5p2");
  });

  it("honours per-tier env overrides", () => {
    snap = snapshotEnv();
    process.env.FIREWORKS_MODEL_CHEAP = "custom/cheap";
    process.env.FIREWORKS_MODEL_MID = "custom/mid";
    process.env.FIREWORKS_MODEL_PREMIUM = "custom/premium";
    expect(fireworksModelId("cheap")).toBe("custom/cheap");
    expect(fireworksModelId("mid")).toBe("custom/mid");
    expect(fireworksModelId("premium")).toBe("custom/premium");
  });
});

describe("fireworksTierForRequest", () => {
  it("prefers the explicit per-candidate hint over the entitlement tier", () => {
    expect(fireworksTierForRequest(request({ tier: "pro", fireworksModelTier: "cheap" }))).toBe("cheap");
  });

  it("maps entitlement tier when no hint is present", () => {
    expect(fireworksTierForRequest(request({ tier: "guest" }))).toBe("cheap");
    expect(fireworksTierForRequest(request({ tier: "free" }))).toBe("cheap");
    expect(fireworksTierForRequest(request({ tier: "unlimited" }))).toBe("mid");
    expect(fireworksTierForRequest(request({ tier: "pro" }))).toBe("premium");
  });

  it("defaults to cheap when tier is absent", () => {
    expect(fireworksTierForRequest(request())).toBe("cheap");
  });
});

describe("createFireworksProvider.generate", () => {
  let snap: Record<string, string | undefined>;
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv(snap);
  });

  function stubFetch(body: unknown) {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("posts to the OpenAI-compatible endpoint with the tier-resolved model and parses usage", async () => {
    snap = snapshotEnv();
    const fetchMock = stubFetch({
      choices: [{ message: { content: '{"prose":"The page turns."}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 9 },
    });

    const provider = createFireworksProvider(true, {
      apiKey: "fw-key",
      baseUrl: "https://api.fireworks.ai/inference/v1",
      timeoutMs: 1000,
    });
    const result = await provider.generate(request({ tier: "unlimited" }));

    expect(result.provider).toBe("fireworks");
    expect(result.text).toContain("page turns");
    expect(result.tokenUsage).toEqual({ input: 12, output: 9 });
    // Unlimited → mid model surfaced for pricing.
    expect(result.modelId).toBe(fireworksModelId("mid"));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.fireworks.ai/inference/v1/chat/completions");
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe(fireworksModelId("mid"));
    expect(init.headers).toMatchObject({ authorization: "Bearer fw-key" });
  });

  it("honours the explicit fireworksModelTier routing hint", async () => {
    snap = snapshotEnv();
    const fetchMock = stubFetch({
      choices: [{ message: { content: "prose" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const provider = createFireworksProvider(true, {
      apiKey: "fw-key",
      baseUrl: "https://api.fireworks.ai/inference/v1",
      timeoutMs: 1000,
    });
    // tier says free (cheap) but the routing hint pins premium.
    const result = await provider.generate(request({ tier: "free", fireworksModelTier: "premium" }));
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(sent.model).toBe(fireworksModelId("premium"));
    expect(result.modelId).toBe(fireworksModelId("premium"));
  });

  it("throws when unavailable and when the response has no text", async () => {
    snap = snapshotEnv();
    const unavailable = createFireworksProvider(false, {
      baseUrl: "https://api.fireworks.ai/inference/v1",
      timeoutMs: 1000,
    });
    await expect(unavailable.generate(request())).rejects.toThrow("fireworks_not_configured");

    stubFetch({ choices: [{ message: { content: "" } }] });
    const provider = createFireworksProvider(true, {
      apiKey: "fw-key",
      baseUrl: "https://api.fireworks.ai/inference/v1",
      timeoutMs: 1000,
    });
    await expect(provider.generate(request())).rejects.toThrow("fireworks_empty_response");
  });
});

describe("fireworks availability precedence", () => {
  let snap: Record<string, string | undefined>;
  afterEach(() => restoreEnv(snap));

  it("a real key wins; without a key a mock route yields to a real other-provider key", () => {
    snap = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];

    // Real Fireworks key → available.
    process.env.FIREWORKS_API_KEY = "fw-key";
    expect(readFireworksConfig().apiKey).toBe("fw-key");
    expect(createFireworksProvider().health().available).toBe(true);

    // No key, mock base, but a real Anthropic key exists → NOT available.
    delete process.env.FIREWORKS_API_KEY;
    process.env.FIREWORKS_BASE_URL = "http://provider-mocks:4010";
    process.env.ANTHROPIC_API_KEY = "anthropic-key";
    expect(createFireworksProvider().health().available).toBe(false);

    // No key, mock base, no other real key → available (offline dev).
    delete process.env.ANTHROPIC_API_KEY;
    expect(createFireworksProvider().health().available).toBe(true);
  });
});
