// Regression coverage for the duplicate-SSE-stream bug. The original
// failure mode: two `getAuthorizedSceneStreamRequest` calls land back-to-
// back against the same save (mount-effect + submitChoice racing), both
// pass through, both POSTs open SSE streams, the browser cancels the
// earlier connection mid-flight, Vertex throws AbortError, the LLM
// router falls back to the deterministic provider, and the reader sees
// their premise echoed back as the scene's prose.
//
// The fix converts `getAuthorizedSceneStreamRequest` from a read-only
// query into a mutation that ALSO claims the scene's "streaming" lock
// with a TTL. The first caller patches `streamStatus: "streaming"` and
// stamps `streamStartedAt`; the second observes the lock within the
// TTL and throws `scene_stream_in_progress`. A stale lock (older than
// SCENE_STREAM_LOCK_TTL_MS) is overridable so a recovery-after-crash
// retry still works.

import { describe, expect, it } from "vitest";

import { getAuthorizedSceneStreamRequest } from "../game";

function makeSaveDoc(): Record<string, unknown> {
  return {
    _id: "save_1",
    accountId: "acct_1",
    storyId: "open-canvas",
    mode: "story",
    status: "active",
    engineVersion: 2,
    storyVersion: 1,
    state: {
      storyId: "open-canvas",
      mode: "story",
      vitality: 5,
      currency: 0,
      attributes: {},
      inventory: [],
      flags: {},
      currentNodeId: "start",
      turnNumber: 0,
      path: ["start"],
      delayed: [],
      endingsUnlocked: {},
      npcs: {},
      schemaVersion: 2,
    },
    currentNodeId: "start",
    currentSceneId: "scene_1",
    turnNumber: 1,
    createdAt: 1,
    updatedAt: 1,
    activeTurnRequestId: "req_active",
  };
}

function makeAccountDoc(): Record<string, unknown> {
  return {
    _id: "acct_1",
    kind: "guest",
    ageBand: "18+",
    matureContentEnabled: false,
    guestTokenHash: "guest_hash",
    lastActiveAt: 1,
    createdAt: 1,
  };
}

type Patch = { id: string; patch: any };

function makeCtx(input: {
  save: Record<string, unknown>;
  account: Record<string, unknown>;
  scene: Record<string, unknown>;
}) {
  const docs = new Map<string, Record<string, unknown>>();
  docs.set(String(input.save._id), input.save);
  docs.set(String(input.account._id), input.account);
  docs.set(String(input.scene._id), input.scene);
  const patches: Patch[] = [];

  const ctx = {
    db: {
      async get(id: any) {
        return docs.get(String(id)) ?? null;
      },
      query() {
        const chain = {
          withIndex() {
            return chain;
          },
          filter() {
            return chain;
          },
          async first() {
            return null;
          },
          async collect() {
            return [];
          },
        };
        return chain;
      },
      async patch(id: any, patch: any) {
        patches.push({ id: String(id), patch });
        const existing = docs.get(String(id));
        if (existing) docs.set(String(id), { ...existing, ...patch });
      },
    },
    auth: {
      async getUserIdentity() {
        return null;
      },
    },
  };
  return { ctx, patches, docs };
}

describe("getAuthorizedSceneStreamRequest — dedup lock", () => {
  it("rejects a second concurrent stream-open with scene_stream_in_progress", async () => {
    const scene = {
      _id: "scene_1",
      saveId: "save_1",
      nodeId: "start",
      turnNumber: 1,
      stateFingerprint: "fp",
      prose: "",
      // The PRIOR claim — a sibling SSE handler already authorized and
      // patched the scene to "streaming" with a fresh timestamp.
      streamStatus: "streaming",
      streamStartedAt: Date.now() - 1_000,
      choiceViews: [],
      engineEvents: [],
      safety: { risk: "normal", reasons: [] },
      createdAt: 1,
    };
    const { ctx } = makeCtx({
      save: makeSaveDoc(),
      account: makeAccountDoc(),
      scene,
    });

    await expect(
      (getAuthorizedSceneStreamRequest as any)._handler(ctx, {
        accountId: "acct_1",
        guestTokenHash: "guest_hash",
        saveId: "save_1",
      }),
    ).rejects.toThrow(/scene_stream_in_progress/);
  });

  it("allows reclaiming a stale (>TTL) streaming lock so crash-recovery still works", async () => {
    const scene = {
      _id: "scene_1",
      saveId: "save_1",
      nodeId: "start",
      turnNumber: 1,
      stateFingerprint: "fp",
      prose: "",
      streamStatus: "streaming",
      // 210s ago — past the 200s TTL (raised to outlast the 180s LLM
      // timeout). Reclaim is allowed; the prior holder is assumed dead.
      streamStartedAt: Date.now() - 210_000,
      choiceViews: [],
      engineEvents: [],
      safety: { risk: "normal", reasons: [] },
      createdAt: 1,
    };
    const { ctx, patches } = makeCtx({
      save: makeSaveDoc(),
      account: makeAccountDoc(),
      scene,
    });

    // We expect this to NOT throw scene_stream_in_progress. It may throw
    // later (loadStory / resolveContentContext aren't mocked) but the
    // throw should not be the dedup rejection.
    let dedupRejected = false;
    try {
      await (getAuthorizedSceneStreamRequest as any)._handler(ctx, {
        accountId: "acct_1",
        guestTokenHash: "guest_hash",
        saveId: "save_1",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("scene_stream_in_progress")) {
        dedupRejected = true;
      }
    }
    expect(dedupRejected).toBe(false);
    // The mutation should have patched the scene to claim a fresh lock.
    const claimPatch = patches.find(
      (p) => p.id === "scene_1" && p.patch.streamStatus === "streaming",
    );
    expect(claimPatch).toBeDefined();
    expect(typeof claimPatch?.patch.streamStartedAt).toBe("number");
  });

  it("allows a first-time claim from streamStatus=pending", async () => {
    const scene = {
      _id: "scene_1",
      saveId: "save_1",
      nodeId: "start",
      turnNumber: 1,
      stateFingerprint: "fp",
      prose: "",
      streamStatus: "pending",
      choiceViews: [],
      engineEvents: [],
      safety: { risk: "normal", reasons: [] },
      createdAt: 1,
    };
    const { ctx, patches } = makeCtx({
      save: makeSaveDoc(),
      account: makeAccountDoc(),
      scene,
    });

    let dedupRejected = false;
    try {
      await (getAuthorizedSceneStreamRequest as any)._handler(ctx, {
        accountId: "acct_1",
        guestTokenHash: "guest_hash",
        saveId: "save_1",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("scene_stream_in_progress")) {
        dedupRejected = true;
      }
    }
    expect(dedupRejected).toBe(false);
    const claimPatch = patches.find(
      (p) => p.id === "scene_1" && p.patch.streamStatus === "streaming",
    );
    expect(claimPatch).toBeDefined();
  });
});
