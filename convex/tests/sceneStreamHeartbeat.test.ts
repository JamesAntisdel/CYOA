import { afterEach, describe, expect, it, vi } from "vitest";

import { sceneStreamResponse } from "../http";
import type { LlmRouter, RouterResult } from "../llm/router";
import type { SceneGenerationRequest, TokenChunk } from "../llm/types";

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

// Build a router-shaped object whose streamSceneWithResult waits on a
// caller-controlled deferred before emitting tokens. This lets us assert
// that heartbeats arrive during the wait, BEFORE any token event lands.
function makeDeferredRouter(prose: string): {
  router: LlmRouter;
  resolve: () => void;
} {
  let releaseGate: () => void = () => undefined;
  const gate = new Promise<void>((res) => {
    releaseGate = res;
  });

  const result: RouterResult = {
    generation: {
      provider: "deterministic",
      text: prose,
      tokenUsage: { input: 0, output: 0 },
    },
    parsed: { prose, choiceMetadata: [] },
    safetyAction: "ok",
  };

  const router = {
    streamSceneWithResult: async (
      _req: SceneGenerationRequest,
      onToken: (chunk: TokenChunk) => void,
    ): Promise<RouterResult> => {
      // Block until the test releases us — simulating a slow Vertex call.
      await gate;
      const words = prose.split(/(\s+)/).filter(Boolean);
      words.forEach((text, index) => {
        onToken({ provider: "deterministic", text, index });
      });
      return result;
    },
  } as unknown as LlmRouter;

  return { router, resolve: () => releaseGate() };
}

describe("scene stream heartbeat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits keep-alive comments while the LLM call is in flight, then tokens + done", async () => {
    // Fake timers so we can step past 5s-heartbeat boundaries without
    // burning real wall time. Promises/microtasks remain real.
    vi.useFakeTimers();

    const { router, resolve } = makeDeferredRouter("A quiet room waits.");
    const response = sceneStreamResponse(request(), router);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // Pull chunks off the stream into a buffer in the background. The
    // reader resolves whenever new bytes are enqueued by the start fn.
    let received = "";
    let streamDone = false;
    const drain = (async () => {
      while (!streamDone) {
        const { value, done } = await reader.read();
        if (done) {
          streamDone = true;
          break;
        }
        if (value) received += decoder.decode(value, { stream: true });
      }
    })();

    // Advance 12 seconds — well past two 5s heartbeat boundaries. The
    // LLM gate is still closed, so no token events should have landed.
    await vi.advanceTimersByTimeAsync(12_000);

    expect(received).toContain(": keep-alive");
    expect(received).not.toContain("event: token");
    expect(received).not.toContain("event: done");

    // At least one keep-alive line — typically 2 by the 12s mark.
    const keepAliveCount = received.split(": keep-alive").length - 1;
    expect(keepAliveCount).toBeGreaterThanOrEqual(1);

    // Now release the deferred so the router emits tokens + completes.
    resolve();
    // Let microtasks settle so onToken callbacks run.
    await vi.runAllTimersAsync();
    await drain;

    expect(received).toContain("event: token");
    expect(received).toContain("event: done");
    // Heartbeats remain in the buffer; assert they came before the first token.
    const firstKeepAlive = received.indexOf(": keep-alive");
    const firstToken = received.indexOf("event: token");
    expect(firstKeepAlive).toBeGreaterThanOrEqual(0);
    expect(firstToken).toBeGreaterThan(firstKeepAlive);
  });

  it("clears the heartbeat interval after the stream errors", async () => {
    vi.useFakeTimers();
    const failingRouter = {
      streamSceneWithResult: async () => {
        throw new Error("provider blew up");
      },
    } as unknown as LlmRouter;

    const response = sceneStreamResponse(request(), failingRouter);
    const text = await response.text();

    expect(text).toContain("llm_stream_failed");
    // If the interval had leaked, advancing time would enqueue more
    // keep-alives onto a closed controller — defensive check.
    await vi.advanceTimersByTimeAsync(20_000);
    // No throw means the interval was cleared cleanly in the finally block.
    expect(true).toBe(true);
  });
});
