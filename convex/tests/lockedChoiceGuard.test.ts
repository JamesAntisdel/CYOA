// W1-S5: the locked-choice submission guard in `beginStreamingChoice`. A
// locked choice must be rejected with `choice_not_available` BEFORE the daily
// turn budget is charged, and a `choice.locked_denied` analytics row fires.
// Fake-ctx style (mirrors beginStreamingChoice.test.ts).

import { describe, expect, it } from "vitest";

import { beginStreamingChoice } from "../game";

type Insert = { table: string; doc: any; id: string };
type Patch = { id: string; patch: any };

// A schema-valid proposal with one locked choice (needs 15 gold; the save has
// 0) so the reader's submission of `pay` must be rejected.
const PRIOR_PROPOSAL = {
  prose: "The ferryman waits at the black water.",
  choices: [
    { id: "stay", label: "Stay on the bank" },
    {
      id: "pay",
      label: "Pay the ferryman (-15 gold)",
      conditions: [{ kind: "currency_at_least", value: 15 }],
      lockedHint: "Needs 15 gold",
    },
    { id: "flee", label: "Turn back into the fog" },
  ],
  terminal: null,
};

function makeSaveDoc(): Record<string, unknown> {
  return {
    _id: "save_1",
    accountId: "acct_1",
    storyId: "open-canvas",
    mode: "story",
    status: "active",
    engineVersion: 2,
    storyVersion: 1,
    currentSceneId: "scene_1",
    state: {
      storyId: "open-canvas",
      mode: "story",
      vitality: 5,
      currency: 0,
      attributes: {},
      inventory: [],
      flags: {},
      currentNodeId: "open-canvas:llm:1",
      turnNumber: 1,
      path: ["start", "open-canvas:llm:1"],
      delayed: [],
      endingsUnlocked: {},
      npcs: {},
      schemaVersion: 2,
    },
    currentNodeId: "open-canvas:llm:1",
    turnNumber: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeSceneDoc(): Record<string, unknown> {
  return { _id: "scene_1", saveId: "save_1", streamStatus: "complete", proposal: PRIOR_PROPOSAL };
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

function makeCtx() {
  const docs = new Map<string, Record<string, unknown>>();
  docs.set("save_1", makeSaveDoc());
  docs.set("scene_1", makeSceneDoc());
  docs.set("acct_1", makeAccountDoc());
  const inserted: Insert[] = [];
  const patches: Patch[] = [];
  let nextId = 1;

  const ctx = {
    db: {
      async get(id: any) {
        return docs.get(String(id)) ?? null;
      },
      query(_table: string) {
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
      async insert(table: string, doc: any) {
        const id = `${table}_${nextId++}`;
        inserted.push({ table, doc, id });
        return id;
      },
      async patch(id: any, patch: any) {
        patches.push({ id: String(id), patch });
      },
    },
  };
  return { ctx, inserted, patches };
}

describe("beginStreamingChoice — locked-choice submission guard (W1-S5)", () => {
  it("rejects a locked choice with choice_not_available and does not charge a turn", async () => {
    const { ctx, inserted, patches } = makeCtx();

    await expect(
      (beginStreamingChoice as any)._handler(ctx, {
        accountId: "acct_1",
        guestTokenHash: "guest_hash",
        saveId: "save_1",
        choiceId: "pay",
        requestId: "req_locked",
      }),
    ).rejects.toThrow(/choice_not_available/);

    // No daily budget consumed (guard runs before consumeTurn).
    expect(inserted.filter((r) => r.table === "daily_turn_counter")).toHaveLength(0);
    expect(patches.filter((r) => r.id.startsWith("daily_turn_counter"))).toHaveLength(0);
    // choice.locked_denied analytics recorded (best-effort).
    const analytics = inserted.filter((r) => r.table === "analytics_events");
    expect(analytics).toHaveLength(1);
    const event = analytics[0]!;
    expect(event.doc.eventName).toBe("choice.locked_denied");
    expect(event.doc.payload.choiceId).toBe("pay");
  });
});
