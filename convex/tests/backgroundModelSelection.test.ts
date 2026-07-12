// Background-call model selection (provider-and-credit design §1.4).
//
// The summarizer and story-bible fan-outs must:
//   - use the Fireworks cheap model as the primary cheap leg (no hardcoded
//     deprecated `deepseek-chat`), and
//   - fall back to a REAL Haiku id read from a DEDICATED env
//     (ANTHROPIC_SUMMARIZER_MODEL / ANTHROPIC_BIBLE_MODEL) defaulting to
//     `claude-haiku-4-5` — NOT the shared ANTHROPIC_MODEL and NOT the
//     nonexistent `claude-haiku-4-6`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { summarizeStory, setStorySummary } from "../llm/summarizer";
import { callStoryBibleModel } from "../llm/storyBible";
import { fireworksModelId } from "../llm/fireworks";

const ENV_KEYS = [
  "FIREWORKS_API_KEY",
  "FIREWORKS_BASE_URL",
  "FIREWORKS_MODEL_CHEAP",
  "DEEPSEEK_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SUMMARIZER_MODEL",
  "ANTHROPIC_BIBLE_MODEL",
  "GEMINI_API_KEY",
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

function stubFetchCapturing(body: unknown) {
  const calls: Array<{ url: string; body: any }> = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string) });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function openAiBody(text: string) {
  return { choices: [{ message: { content: text } }] };
}
function anthropicBody(text: string) {
  return { content: [{ type: "text", text }] };
}

function summarizerCtx() {
  const save = { _id: "save_1", storySummary: undefined };
  const ctx: any = {
    db: {
      async get(id: string) {
        return id === "save_1" ? save : null;
      },
      async patch(_id: string, patch: any) {
        Object.assign(save, patch);
      },
    },
    runMutation: async (_ref: any, args: any) => {
      await (setStorySummary as any)._handler(ctx, args);
    },
  };
  return ctx;
}

const summarizerArgs = {
  saveId: "save_1",
  accountId: "acct_1",
  priorSummary: "prior",
  lastSceneExcerpt: "The reader opened the door.",
  lastChoiceLabel: "Open the door.",
  premise: "A house with one door.",
  turnNumber: 2,
};

describe("summarizer model selection", () => {
  let snap: Record<string, string | undefined>;
  beforeEach(() => {
    snap = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv(snap);
  });

  it("uses the Fireworks cheap model as the primary cheap leg", async () => {
    process.env.FIREWORKS_API_KEY = "fw-key";
    process.env.FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";
    const calls = stubFetchCapturing(openAiBody("LOCATION: door"));

    const result = await (summarizeStory as any)._handler(summarizerCtx(), summarizerArgs);

    expect(result.updated).toBe(true);
    expect(result.provider).toBe("fireworks");
    expect(calls[0]!.url).toBe("https://api.fireworks.ai/inference/v1/chat/completions");
    expect(calls[0]!.body.model).toBe(fireworksModelId("cheap"));
    expect(calls[0]!.body.model).not.toBe("deepseek-chat");
  });

  it("falls back to a real Haiku id (claude-haiku-4-5) from ANTHROPIC_SUMMARIZER_MODEL default", async () => {
    // No Fireworks key; a shared ANTHROPIC_MODEL is set to Sonnet and must be
    // IGNORED by the background call.
    process.env.ANTHROPIC_API_KEY = "anthropic-key";
    process.env.ANTHROPIC_MODEL = "claude-sonnet-4-6";
    const calls = stubFetchCapturing(anthropicBody("LOCATION: door"));

    const result = await (summarizeStory as any)._handler(summarizerCtx(), summarizerArgs);

    expect(result.provider).toBe("anthropic");
    expect(calls[0]!.body.model).toBe("claude-haiku-4-5");
    expect(calls[0]!.body.model).not.toBe("claude-haiku-4-6");
    expect(calls[0]!.body.model).not.toBe("claude-sonnet-4-6");
  });

  it("honours an explicit ANTHROPIC_SUMMARIZER_MODEL override", async () => {
    process.env.ANTHROPIC_API_KEY = "anthropic-key";
    process.env.ANTHROPIC_SUMMARIZER_MODEL = "claude-custom-summarizer";
    const calls = stubFetchCapturing(anthropicBody("LOCATION: door"));

    await (summarizeStory as any)._handler(summarizerCtx(), summarizerArgs);
    expect(calls[0]!.body.model).toBe("claude-custom-summarizer");
  });
});

describe("story-bible model selection", () => {
  let snap: Record<string, string | undefined>;
  beforeEach(() => {
    snap = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv(snap);
  });

  it("uses the Fireworks cheap model as the primary cheap leg", async () => {
    process.env.FIREWORKS_API_KEY = "fw-key";
    process.env.FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";
    const calls = stubFetchCapturing(openAiBody('{"keys":[]}'));

    const result = await callStoryBibleModel("plan the story");

    expect(result?.provider).toBe("fireworks");
    expect(calls[0]!.url).toBe("https://api.fireworks.ai/inference/v1/chat/completions");
    expect(calls[0]!.body.model).toBe(fireworksModelId("cheap"));
    expect(calls[0]!.body.model).not.toBe("deepseek-chat");
  });

  it("falls back to a real Haiku id (claude-haiku-4-5) from ANTHROPIC_BIBLE_MODEL default", async () => {
    process.env.ANTHROPIC_API_KEY = "anthropic-key";
    process.env.ANTHROPIC_MODEL = "claude-sonnet-4-6";
    const calls = stubFetchCapturing(anthropicBody('{"keys":[]}'));

    const result = await callStoryBibleModel("plan the story");

    expect(result?.provider).toBe("anthropic");
    expect(calls[0]!.body.model).toBe("claude-haiku-4-5");
    expect(calls[0]!.body.model).not.toBe("claude-haiku-4-6");
    expect(calls[0]!.body.model).not.toBe("claude-sonnet-4-6");
  });
});
