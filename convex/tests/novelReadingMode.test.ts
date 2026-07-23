// reading-modes W3 (R4) — INTEGRATOR (task 3.5) coverage.
//
// Two integrator-owned seams that the engine suite (packages/engine/tests/
// reading-modes.test.ts, which already pins the novel schema, `sceneSchemaFor`,
// and the `turn-page` cursor resolution) does NOT reach:
//
//   1. The createSave gate (posture A / RM5): `resolveReadingMode({ desired,
//      isPro })` is resolved ONCE at create and persisted via `cleanDoc`, so a
//      non-Pro reader who asks for "novel" degrades to "branching" (field
//      absent) and a plain launch stays byte-identical to today.
//   2. The memory/summarizer suppression: `memoryBeatFromHistory` drops the
//      `Chose "…"` clause for the synthetic page-turn so the novel memory window
//      leans on prose continuity instead of echoing "Turn the page" each beat.
//
// The synthetic turn-page STAMP + the four in-mutation parse-site selections
// live inside `completeSceneStream`, which the existing suite documents as not
// feasible to drive end-to-end without a full convex-test setup (see
// summarizer.test.ts). Their correctness rests on the engine contract the
// engine suite pins: `sceneSchemaFor("novel")` accepts the 0-choice payload and
// `advanceLlmTurnCursor` resolves the stamped `{ id: "turn-page" }` cleanly.

import { describe, expect, it } from "vitest";

import { createSave, getCurrentScene, memoryBeatFromHistory } from "../game";

type Insert = { table: string; doc: any; id: string };
type Patch = { id: string; patch: any };

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

function makeCtx(input: {
  account: Record<string, unknown>;
  entitlement?: Record<string, unknown> | null;
}) {
  const docs = new Map<string, Record<string, unknown>>();
  docs.set(String(input.account._id), input.account);
  const inserted: Insert[] = [];
  const patches: Patch[] = [];
  let nextId = 1;

  const ctx = {
    db: {
      async get(id: any) {
        return docs.get(String(id)) ?? null;
      },
      query(table: string) {
        const rows: Record<string, unknown>[] =
          table === "entitlements"
            ? input.entitlement
              ? [input.entitlement]
              : []
            : [];
        const chain = {
          withIndex(_name: string, _build: (q: any) => any) {
            return chain;
          },
          filter(_build: (q: any) => any) {
            return chain;
          },
          async first() {
            return rows[0] ?? null;
          },
          async collect() {
            return rows;
          },
        };
        return chain;
      },
      async insert(table: string, doc: any) {
        const id = `${table}_${nextId++}`;
        inserted.push({ table, doc, id });
        docs.set(id, { ...doc, _id: id });
        return id;
      },
      async patch(id: any, patch: any) {
        patches.push({ id: String(id), patch });
        const existing = docs.get(String(id));
        if (existing) docs.set(String(id), { ...existing, ...patch });
      },
    },
  };
  return { ctx, inserted, patches };
}

function baseArgs(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "acct_1",
    guestTokenHash: "guest_hash",
    storyId: "open-canvas",
    mode: "story" as const,
    ...overrides,
  };
}

const PRO_ENTITLEMENT = {
  _id: "ent_1",
  accountId: "acct_1",
  tier: "pro",
  status: "active",
};

describe("createSave — readingMode gate (posture A, R4.9/RM5)", () => {
  it("persists readingMode 'novel' when a Pro reader requests it", async () => {
    const { ctx, inserted } = makeCtx({
      account: makeAccountDoc(),
      entitlement: PRO_ENTITLEMENT,
    });

    await (createSave as any)._handler(ctx, baseArgs({ readingMode: "novel" }));

    const saveInsert = inserted.find((row) => row.table === "saves");
    expect(saveInsert).toBeTruthy();
    expect(saveInsert!.doc.readingMode).toBe("novel");
  });

  it("degrades novel->branching for a non-Pro reader (field absent)", async () => {
    const { ctx, inserted } = makeCtx({
      account: makeAccountDoc(),
      entitlement: null,
    });

    await (createSave as any)._handler(ctx, baseArgs({ readingMode: "novel" }));

    const saveInsert = inserted.find((row) => row.table === "saves");
    expect(saveInsert).toBeTruthy();
    // cleanDoc strips the resolved "branching" (only "novel" is ever spread),
    // so the field is absent — the save reads back as branching, byte-identical.
    expect(saveInsert!.doc.readingMode).toBeUndefined();
  });

  it("degrades novel->branching for a grace (non-active) paid entitlement", async () => {
    const { ctx, inserted } = makeCtx({
      account: makeAccountDoc(),
      entitlement: { ...PRO_ENTITLEMENT, status: "grace" },
    });

    await (createSave as any)._handler(ctx, baseArgs({ readingMode: "novel" }));

    const saveInsert = inserted.find((row) => row.table === "saves");
    expect(saveInsert!.doc.readingMode).toBeUndefined();
  });

  it("omits readingMode entirely on a plain launch (branching, byte-identical)", async () => {
    const { ctx, inserted } = makeCtx({
      account: makeAccountDoc(),
      entitlement: PRO_ENTITLEMENT,
    });

    await (createSave as any)._handler(ctx, baseArgs({}));

    const saveInsert = inserted.find((row) => row.table === "saves");
    expect(saveInsert!.doc.readingMode).toBeUndefined();
  });

  it("omits readingMode when a Pro reader explicitly requests branching", async () => {
    const { ctx, inserted } = makeCtx({
      account: makeAccountDoc(),
      entitlement: PRO_ENTITLEMENT,
    });

    await (createSave as any)._handler(ctx, baseArgs({ readingMode: "branching" }));

    const saveInsert = inserted.find((row) => row.table === "saves");
    expect(saveInsert!.doc.readingMode).toBeUndefined();
  });
});

describe("memoryBeatFromHistory — novel page-turn suppression (R4)", () => {
  it("drops the 'Chose …' clause for the synthetic turn-page id", () => {
    const beat = memoryBeatFromHistory(
      // The page-turn row carries no choiceLabel (omitted at write time so
      // cleanDoc strips it); the beat must still not echo "turn-page".
      { _id: "h1", turnNumber: 3, choiceId: "turn-page" },
      { proposal: { prose: "The corridor narrowed. She pressed on into the dark." } },
    );
    expect(beat).not.toBeNull();
    expect(beat!.turnNumber).toBe(3);
    expect(beat!.text).not.toMatch(/Chose/i);
    expect(beat!.text).not.toMatch(/turn-page/);
    expect(beat!.text).toContain("Turn 3");
    // Prose continuity still rides the excerpt.
    expect(beat!.text).toMatch(/pressed on/);
  });

  it("keeps the 'Chose \"…\"' clause for a normal branching choice", () => {
    const beat = memoryBeatFromHistory(
      { _id: "h2", turnNumber: 2, choiceId: "c1", choiceLabel: "Open the door" },
      { proposal: { prose: "A cold draft slid through the gap." } },
    );
    expect(beat).not.toBeNull();
    expect(beat!.text).toMatch(/Chose "Open the door"/);
  });

  it("emits a bare turn marker for a page-turn with no scene prose", () => {
    const beat = memoryBeatFromHistory(
      { _id: "h3", turnNumber: 5, choiceId: "turn-page" },
      null,
    );
    expect(beat).not.toBeNull();
    expect(beat!.text).not.toMatch(/Chose/i);
    expect(beat!.text).not.toMatch(/turn-page/);
    expect(beat!.text).toContain("Turn 5");
  });
});

// The persisted novel proposal carries exactly ONE choice (the stamped
// turn-page). The shared `readPersistedProposal` validates through the branching
// min(2) schema, which would REJECT that and null the proposal — stranding the
// NEXT turn on `llm_prior_proposal_missing` and projecting NO page-turn on a
// reload. The integrator's mode-aware `readPersistedProposalForMode` fixes both
// read paths; this exercises the getCurrentScene projection round-trip end to
// end (the failure mode is silent — a novel save that loses its page-turn).
function makeReadCtx(input: {
  save: Record<string, unknown>;
  account: Record<string, unknown>;
  scene: Record<string, unknown>;
}) {
  const docs = new Map<string, Record<string, unknown>>();
  docs.set(String(input.save._id), input.save);
  docs.set(String(input.account._id), input.account);
  docs.set(String(input.scene._id), input.scene);
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
          order() {
            return chain;
          },
          async first() {
            return null;
          },
          async collect() {
            return [];
          },
          async take() {
            return [];
          },
        };
        return chain;
      },
      async patch() {},
    },
    auth: {
      async getUserIdentity() {
        return null;
      },
    },
  };
  return { ctx };
}

function makeNovelSaveDoc(): Record<string, unknown> {
  return {
    _id: "save_novel",
    accountId: "acct_1",
    storyId: "open-canvas",
    mode: "story",
    status: "active",
    engineVersion: 2,
    storyVersion: 1,
    readingMode: "novel",
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
      path: ["start"],
      delayed: [],
      endingsUnlocked: {},
      npcs: {},
      schemaVersion: 2,
    },
    currentNodeId: "open-canvas:llm:1",
    currentSceneId: "scene_novel",
    turnNumber: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("getCurrentScene — novel proposal rehydration round-trip (R4.4)", () => {
  it("rehydrates the persisted 1-choice novel proposal and projects the page-turn", async () => {
    const scene = {
      _id: "scene_novel",
      saveId: "save_novel",
      nodeId: "open-canvas:llm:1",
      turnNumber: 1,
      prose: "The corridor exhaled cold air; a single page waited to be turned.",
      streamStatus: "complete",
      choiceViews: [
        { choice: { id: "turn-page", label: "Turn the page", targetNodeId: "open-canvas:llm:next" }, visibility: "visible" },
      ],
      // The stamped novel proposal — exactly one choice, which the branching
      // min(2) schema would reject on re-read.
      proposal: {
        prose: "The corridor exhaled cold air; a single page waited to be turned.",
        choices: [{ id: "turn-page", label: "Turn the page" }],
      },
      engineEvents: [],
      safety: { risk: "normal", reasons: [] },
      provider: "vertex",
      createdAt: 1,
      completedAt: 1,
    };
    const { ctx } = makeReadCtx({
      save: makeNovelSaveDoc(),
      account: makeAccountDoc(),
      scene,
    });

    const projection = await (getCurrentScene as any)._handler(ctx, {
      accountId: "acct_1",
      guestTokenHash: "guest_hash",
      saveId: "save_novel",
    });

    // The proposal rehydrated (not nulled by the branching schema), so the
    // page-turn projects as exactly one visible choice.
    expect(projection.choices).toHaveLength(1);
    expect(projection.choices[0].choice.id).toBe("turn-page");
    expect(projection.choices[0].visibility).toBe("visible");
    // The reader-known content axis is carried so the Novel layout can render
    // the page-turn affordance.
    expect(projection.readingMode).toBe("novel");
  });

  // posture B (live mid-run switch) regression — the deep-scrub critical: a
  // switch patches save.readingMode immediately, but the CURRENT scene was
  // authored under the PRIOR mode. Its persisted proposal must still rehydrate
  // (else the current scene blanks its choices and the next turn strands on
  // llm_prior_proposal_missing), and the projection must render the current
  // scene in its AUTHORED mode — the switch applies from the NEXT scene.
  it("novel->branching switch: the current novel scene keeps its page-turn (rehydrated under the sibling schema)", async () => {
    const scene = {
      _id: "scene_novel",
      saveId: "save_novel",
      nodeId: "open-canvas:llm:1",
      turnNumber: 1,
      prose: "A single page waited to be turned.",
      streamStatus: "complete",
      choiceViews: [
        { choice: { id: "turn-page", label: "Turn the page", targetNodeId: "open-canvas:llm:next" }, visibility: "visible" },
      ],
      proposal: { prose: "A single page waited to be turned.", choices: [{ id: "turn-page", label: "Turn the page" }] },
      engineEvents: [],
      safety: { risk: "normal", reasons: [] },
      provider: "vertex",
      createdAt: 1,
      completedAt: 1,
    };
    // The save has been FLIPPED to branching mid-run; the scene is still novel.
    const switchedSave = { ...makeNovelSaveDoc(), readingMode: "branching" };
    const { ctx } = makeReadCtx({ save: switchedSave, account: makeAccountDoc(), scene });

    const projection = await (getCurrentScene as any)._handler(ctx, {
      accountId: "acct_1",
      guestTokenHash: "guest_hash",
      saveId: "save_novel",
    });

    // The novel proposal did NOT strand under the live branching schema — the
    // page-turn survives and the current scene still renders as novel.
    expect(projection.choices).toHaveLength(1);
    expect(projection.choices[0].choice.id).toBe("turn-page");
    expect(projection.readingMode).toBe("novel");
  });

  it("branching->novel switch: the current branching scene keeps its real choices (not collapsed to a page-turn)", async () => {
    const scene = {
      _id: "scene_novel",
      saveId: "save_novel",
      nodeId: "open-canvas:llm:1",
      turnNumber: 1,
      prose: "Two doors faced her.",
      streamStatus: "complete",
      choiceViews: [
        { choice: { id: "c1", label: "The left door", targetNodeId: "open-canvas:llm:l" }, visibility: "visible" },
        { choice: { id: "c2", label: "The right door", targetNodeId: "open-canvas:llm:r" }, visibility: "visible" },
      ],
      proposal: {
        prose: "Two doors faced her.",
        choices: [{ id: "c1", label: "The left door" }, { id: "c2", label: "The right door" }],
      },
      engineEvents: [],
      safety: { risk: "normal", reasons: [] },
      provider: "vertex",
      createdAt: 1,
      completedAt: 1,
    };
    // Branching-authored scene on a save FLIPPED to novel mid-run.
    const switchedSave = { ...makeNovelSaveDoc(), readingMode: "novel" };
    const { ctx } = makeReadCtx({ save: switchedSave, account: makeAccountDoc(), scene });

    const projection = await (getCurrentScene as any)._handler(ctx, {
      accountId: "acct_1",
      guestTokenHash: "guest_hash",
      saveId: "save_novel",
    });

    // The 2 real branching choices survive (not rejected by the novel max(1)
    // schema), and the current scene is NOT mislabelled novel.
    expect(projection.choices).toHaveLength(2);
    expect(projection.readingMode).toBeUndefined();
  });
});
