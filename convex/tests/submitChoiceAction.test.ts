// FETCH-IN-MUTATION regression guard (product-readiness defect).
//
// `game:submitChoice` used to be a MUTATION whose handler called the LLM router
// (`router.generateScene` → httpClient `fetch`) inline. On a real provider that
// crashes a Convex mutation with "Can't use fetch in a mutation". It is now an
// ACTION that reserves the turn via the `beginStreamingChoice` mutation, runs
// the LLM in the action (where fetch is legal), and persists via the
// `completeSceneStream` mutation — mirroring the SSE streaming path.
//
// These tests drive `submitChoice._handler` with a fake ACTION ctx (runMutation
// / runQuery stubs routed by function name) and a `global.fetch` spy, asserting:
//   1. submitChoice is registered as an action, not a mutation.
//   2. The terminal branch returns without any generation / stream step.
//   3. The streaming branch runs the router IN THE ACTION (never inside a
//      mutation) and persists through `completeSceneStream`, with no `fetch`
//      call reaching the wire (no provider keys → deterministic fallback).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

import { submitChoice } from "../game";

type Call = { name: string; args: any };

function makeActionCtx(routes: Record<string, (args: any) => any>) {
  const calls: Call[] = [];
  async function dispatch(ref: any, args: any) {
    const name = getFunctionName(ref);
    calls.push({ name, args });
    const handler = routes[name];
    if (!handler) throw new Error(`unexpected call ${name}`);
    return handler(args);
  }
  const ctx = {
    runMutation: (ref: any, args: any) => dispatch(ref, args),
    runQuery: (ref: any, args: any) => dispatch(ref, args),
  };
  return { ctx, calls };
}

const baseArgs = {
  accountId: "acct_1",
  guestTokenHash: "guest_hash",
  saveId: "save_1",
  choiceId: "choice_a",
  requestId: "req_submit_1",
};

describe("submitChoice — fetch-in-mutation fix", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Any fetch during the run is a regression: the mutations must never fetch,
    // and in the no-provider-keys test env the router resolves to the
    // deterministic provider, which also never touches the network.
    fetchSpy = vi.fn(() => {
      throw new Error("fetch must not be called on the submitChoice path in tests");
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("is registered as an ACTION (the fetch now happens in an action, not a mutation)", () => {
    expect((submitChoice as any).isAction).toBe(true);
    expect((submitChoice as any).isMutation).toBeFalsy();
  });

  it("returns a terminal turn inline without a stream/generation step", async () => {
    const { ctx, calls } = makeActionCtx({
      "game:beginStreamingChoice": () => ({
        saveId: "save_1",
        sceneId: "scene_terminal",
        scene: { prose: "You fall into the dark.", streamStatus: "complete", choices: [] },
        stream: false,
      }),
    });

    const result = await (submitChoice as any)._handler(ctx, baseArgs);

    expect(result).toEqual({
      saveId: "save_1",
      sceneId: "scene_terminal",
      scene: { prose: "You fall into the dark.", streamStatus: "complete", choices: [] },
      prose: "You fall into the dark.",
    });
    // Only the phase-A mutation runs — no request build, no completion.
    expect(calls.map((c) => c.name)).toEqual(["game:beginStreamingChoice"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("runs the LLM in the action and persists via completeSceneStream (no fetch)", async () => {
    let completed: any = null;
    const { ctx, calls } = makeActionCtx({
      "game:beginStreamingChoice": () => ({
        saveId: "save_1",
        sceneId: "scene_pending",
        scene: { prose: "", streamStatus: "pending", choices: [] },
        stream: true,
      }),
      // Authored-mode generation request (mirrors getAuthorizedSceneStreamRequest).
      "game:getAuthorizedSceneStreamRequest": () => ({
        saveId: "save_1",
        storyId: "story_x",
        nodeId: "node_1",
        seed: "A quiet road at dusk.",
        memory: [],
        choices: [{ choiceId: "choice_a", label: "Walk on" }],
        sceneLength: "standard",
        contentContext: {
          surface: "generation",
          entitlementTier: "free",
          matureContentEnabled: false,
        },
        risk: "normal",
        entitlementTier: "free",
        tier: "free",
        retryCount: 0,
      }),
      "game:completeSceneStream": (args: any) => {
        completed = args;
        return { ok: true };
      },
      "game:getCurrentScene": () => ({
        prose: "resolved",
        streamStatus: "complete",
        choices: [],
      }),
    });

    const result = await (submitChoice as any)._handler(ctx, baseArgs);

    // The router ran (deterministic fallback with no provider keys) and produced
    // prose, which was handed to completeSceneStream — the ONLY writer.
    expect(completed).not.toBeNull();
    expect(typeof completed.prose).toBe("string");
    expect(completed.prose.length).toBeGreaterThan(0);
    expect(completed.saveId).toBe("save_1");
    expect(typeof result.prose).toBe("string");
    expect(result.sceneId).toBe("scene_pending");

    // Persistence flows through the mutation seam; the LLM ran in the action.
    expect(calls.map((c) => c.name)).toEqual([
      "game:beginStreamingChoice",
      "game:getAuthorizedSceneStreamRequest",
      "game:completeSceneStream",
      "game:getCurrentScene",
    ]);
    // No fetch reached the wire anywhere on the path.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to the current scene when the turn is no longer pending (idempotent replay)", async () => {
    const { ctx, calls } = makeActionCtx({
      "game:beginStreamingChoice": () => ({
        saveId: "save_1",
        sceneId: "scene_pending",
        scene: { prose: "", streamStatus: "pending", choices: [] },
        stream: true,
      }),
      "game:getAuthorizedSceneStreamRequest": () => {
        throw new Error("scene_stream_not_pending");
      },
      "game:getCurrentScene": () => ({ prose: "already resolved", streamStatus: "complete" }),
    });

    const result = await (submitChoice as any)._handler(ctx, baseArgs);

    expect(result).toEqual({
      saveId: "save_1",
      sceneId: "scene_pending",
      scene: { prose: "already resolved", streamStatus: "complete" },
    });
    // No completion / generation re-run — just the canonical scene read.
    expect(calls.map((c) => c.name)).toEqual([
      "game:beginStreamingChoice",
      "game:getAuthorizedSceneStreamRequest",
      "game:getCurrentScene",
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
