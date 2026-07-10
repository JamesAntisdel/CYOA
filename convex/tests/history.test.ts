// Tests for `getRunHistory` — the scene archive query that powers
// `/read/[saveId]/history` and `/map/[saveId]`.
//
// The handler joins three tables (turn_history, scenes, assets) and
// applies an asc-by-turnNumber projection with a 200-row defensive cap.
// These tests stub the Convex ctx with the same lightweight mock
// pattern used by createSave.test.ts: in-memory document map, index
// stubs that ignore the index name and match on equality filters, and
// `_handler` direct invocation to bypass the validator.

import { describe, expect, it } from "vitest";

import { getRunHistory } from "../game";

type Row = Record<string, unknown>;

function makeAccountDoc(): Row {
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

function makeSaveDoc(overrides: Partial<Row> = {}): Row {
  return {
    _id: "save_1",
    accountId: "acct_1",
    storyId: "open-canvas",
    mode: "story",
    status: "active",
    engineVersion: 1,
    storyVersion: 1,
    state: {
      schemaVersion: 1,
      storyId: "open-canvas",
      currentNodeId: "open-canvas:llm:0",
      turnNumber: 3,
      vitality: 5,
      currency: 0,
      attributes: {},
      inventory: [],
      flags: {},
      npcs: {},
      rngSeed: "r",
    },
    currentNodeId: "open-canvas:llm:3",
    turnNumber: 3,
    seedTitle: "Hand-crafted Title",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeCtx(input: {
  account: Row;
  save: Row;
  history: Row[];
  scenes: Row[];
  assets: Row[];
}) {
  const docs = new Map<string, Row>();
  docs.set(String(input.account._id), input.account);
  docs.set(String(input.save._id), input.save);

  return {
    db: {
      async get(id: any) {
        return docs.get(String(id)) ?? null;
      },
      query(table: string) {
        const rows: Row[] =
          table === "turn_history"
            ? input.history
            : table === "scenes"
              ? input.scenes
              : table === "assets"
                ? input.assets
                : table === "entitlements"
                  ? []
                  : [];
        const filters: Record<string, unknown> = {};
        let orderDir: "asc" | "desc" = "asc";
        const chain: any = {
          withIndex(_name: string, build: (q: any) => any) {
            build({
              eq(field: string, value: unknown) {
                filters[field] = value;
                return this;
              },
            });
            return chain;
          },
          filter(_build: (q: any) => any) {
            return chain;
          },
          order(dir: "asc" | "desc") {
            orderDir = dir;
            return chain;
          },
          async take(n: number) {
            const matched = rows.filter((row) =>
              Object.entries(filters).every(([k, v]) => row[k] === v),
            );
            const sorted = matched.slice().sort((a, b) => {
              const av = Number(a.turnNumber ?? 0);
              const bv = Number(b.turnNumber ?? 0);
              return orderDir === "desc" ? bv - av : av - bv;
            });
            return sorted.slice(0, n);
          },
          async first() {
            return (
              rows.find((row) =>
                Object.entries(filters).every(([k, v]) => row[k] === v),
              ) ?? null
            );
          },
          async collect() {
            return rows.filter((row) =>
              Object.entries(filters).every(([k, v]) => row[k] === v),
            );
          },
        };
        return chain;
      },
    },
  };
}

const baseArgs = {
  accountId: "acct_1",
  saveId: "save_1",
  guestTokenHash: "guest_hash",
};

describe("getRunHistory", () => {
  it("returns turns oldest→newest with choice labels joined from turn_history", async () => {
    const history: Row[] = [
      {
        _id: "h1",
        saveId: "save_1",
        accountId: "acct_1",
        turnNumber: 1,
        choiceId: "c1",
        choiceLabel: "Open the door",
        fromNodeId: "open-canvas:llm:0",
      },
      {
        _id: "h2",
        saveId: "save_1",
        accountId: "acct_1",
        turnNumber: 2,
        choiceId: "c2",
        choiceLabel: "Hide in the closet",
        fromNodeId: "open-canvas:llm:1",
      },
      {
        _id: "h3",
        saveId: "save_1",
        accountId: "acct_1",
        turnNumber: 3,
        choiceId: "c3",
        choiceLabel: "Run for the exit",
        fromNodeId: "open-canvas:llm:2",
      },
    ];
    const scenes: Row[] = [
      {
        _id: "scene_1",
        saveId: "save_1",
        turnNumber: 1,
        nodeId: "open-canvas:llm:1",
        prose: "First prose.",
        streamStatus: "complete",
        completedAt: 100,
      },
      {
        _id: "scene_2",
        saveId: "save_1",
        turnNumber: 2,
        nodeId: "open-canvas:llm:2",
        prose: "Second prose.",
        streamStatus: "complete",
        completedAt: 200,
      },
      {
        _id: "scene_3",
        saveId: "save_1",
        turnNumber: 3,
        nodeId: "open-canvas:llm:3",
        prose: "Third prose.",
        streamStatus: "complete",
        completedAt: 300,
      },
    ];
    const ctx = makeCtx({
      account: makeAccountDoc(),
      save: makeSaveDoc(),
      history,
      scenes,
      assets: [],
    });

    const result = await (getRunHistory as any)._handler(ctx, baseArgs);

    expect(result.saveId).toBe("save_1");
    expect(result.storyTitle).toBe("Hand-crafted Title"); // seedTitle wins
    expect(result.currentTurnNumber).toBe(3);
    expect(result.hasMore).toBe(false);
    expect(result.turns.map((t: any) => t.turnNumber)).toEqual([1, 2, 3]);
    expect(result.turns.map((t: any) => t.choice?.choiceLabel)).toEqual([
      "Open the door",
      "Hide in the closet",
      "Run for the exit",
    ]);
    expect(result.turns.map((t: any) => t.prose)).toEqual([
      "First prose.",
      "Second prose.",
      "Third prose.",
    ]);
    // Synthetic llm node ids collapse to a "Turn N" sceneTitle so the UI
    // never leaks ":llm:" engine internals to the reader.
    expect(result.turns.map((t: any) => t.sceneTitle)).toEqual([
      "Turn 1",
      "Turn 2",
      "Turn 3",
    ]);
  });

  it("surfaces ONLY ready asset URIs for image / video / narrator slots", async () => {
    const history: Row[] = [
      {
        _id: "h1",
        saveId: "save_1",
        accountId: "acct_1",
        turnNumber: 1,
        choiceId: "c1",
        choiceLabel: "Step forward",
        fromNodeId: "open-canvas:llm:0",
      },
    ];
    const scenes: Row[] = [
      {
        _id: "scene_1",
        saveId: "save_1",
        turnNumber: 1,
        nodeId: "open-canvas:llm:1",
        prose: "Lit corridor.",
        streamStatus: "complete",
        completedAt: 100,
      },
    ];
    const assets: Row[] = [
      // Ready image — should surface.
      {
        _id: "a_img",
        sceneId: "scene_1",
        kind: "image",
        provider: "vertex-imagen",
        status: "ready",
        url: "https://cdn/x.png",
        provenance: {},
        safety: {},
      },
      // Failed video — must NOT surface a uri.
      {
        _id: "a_vid",
        sceneId: "scene_1",
        kind: "video",
        provider: "vertex-veo",
        status: "failed",
        url: "https://cdn/should-not-show.mp4",
        provenance: {},
        safety: {},
      },
      // Generating narrator — must NOT surface a uri.
      {
        _id: "a_narrator_pending",
        sceneId: "scene_1",
        kind: "audio",
        provider: "google-tts",
        status: "generating",
        url: "",
        provenance: { voiceId: "voice.ash" },
        safety: {},
      },
    ];
    const ctx = makeCtx({
      account: makeAccountDoc(),
      save: makeSaveDoc(),
      history,
      scenes,
      assets,
    });

    const result = await (getRunHistory as any)._handler(ctx, baseArgs);
    expect(result.turns).toHaveLength(1);
    const turn = result.turns[0];
    expect(turn.media?.imageUri).toBe("https://cdn/x.png");
    expect(turn.media?.videoUri).toBeUndefined();
    expect(turn.media?.narratorUri).toBeUndefined();
  });

  it("returns ready narrator URI with voiceId from provenance", async () => {
    const history: Row[] = [
      {
        _id: "h1",
        saveId: "save_1",
        accountId: "acct_1",
        turnNumber: 1,
        choiceId: "c1",
        choiceLabel: "Listen",
        fromNodeId: "open-canvas:llm:0",
      },
    ];
    const scenes: Row[] = [
      {
        _id: "scene_1",
        saveId: "save_1",
        turnNumber: 1,
        nodeId: "open-canvas:llm:1",
        prose: "...",
        streamStatus: "complete",
        completedAt: 100,
      },
    ];
    const assets: Row[] = [
      {
        _id: "a_narrator",
        sceneId: "scene_1",
        kind: "audio",
        provider: "google-tts",
        status: "ready",
        url: "https://cdn/narration.mp3",
        provenance: { voiceId: "voice.lark" },
        safety: {},
      },
    ];
    const ctx = makeCtx({
      account: makeAccountDoc(),
      save: makeSaveDoc(),
      history,
      scenes,
      assets,
    });

    const result = await (getRunHistory as any)._handler(ctx, baseArgs);
    expect(result.turns[0].media?.narratorUri).toBe(
      "https://cdn/narration.mp3",
    );
    expect(result.turns[0].media?.narratorVoiceId).toBe("voice.lark");
  });

  it("rejects access from a different account", async () => {
    const ctx = makeCtx({
      account: makeAccountDoc(),
      save: makeSaveDoc({ accountId: "someone_else" }),
      history: [],
      scenes: [],
      assets: [],
    });
    await expect(
      (getRunHistory as any)._handler(ctx, baseArgs),
    ).rejects.toThrow(/save_forbidden/);
  });

  it("returns empty turns when the save has no turn_history yet", async () => {
    const ctx = makeCtx({
      account: makeAccountDoc(),
      save: makeSaveDoc({ turnNumber: 0 }),
      history: [],
      scenes: [],
      assets: [],
    });

    const result = await (getRunHistory as any)._handler(ctx, baseArgs);
    expect(result.turns).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.currentTurnNumber).toBe(0);
  });

  it("caps at 200 turns and reports hasMore=true when more exist", async () => {
    const history: Row[] = [];
    const scenes: Row[] = [];
    // Seed 205 rows. take(201) reads 201 most-recent in DESC order; cap is
    // 200; we expect hasMore=true and the 200 turns to span 6..205.
    for (let i = 1; i <= 205; i += 1) {
      history.push({
        _id: `h${i}`,
        saveId: "save_1",
        accountId: "acct_1",
        turnNumber: i,
        choiceId: `c${i}`,
        choiceLabel: `Choice ${i}`,
        fromNodeId: `open-canvas:llm:${i - 1}`,
      });
      scenes.push({
        _id: `scene_${i}`,
        saveId: "save_1",
        turnNumber: i,
        nodeId: `open-canvas:llm:${i}`,
        prose: `prose ${i}`,
        streamStatus: "complete",
        completedAt: i * 100,
      });
    }
    const ctx = makeCtx({
      account: makeAccountDoc(),
      save: makeSaveDoc({ turnNumber: 205 }),
      history,
      scenes,
      assets: [],
    });

    const result = await (getRunHistory as any)._handler(ctx, baseArgs);
    expect(result.hasMore).toBe(true);
    expect(result.turns).toHaveLength(200);
    // After reversal (oldest→newest among the most-recent 200): turns
    // span 6..205.
    expect(result.turns[0].turnNumber).toBe(6);
    expect(result.turns[result.turns.length - 1].turnNumber).toBe(205);
  });
});
