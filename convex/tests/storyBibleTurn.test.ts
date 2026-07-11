// Turn-mutation story-bible integration (task SB-S5, design §2/§8):
// attach-once at request assembly (`loadStoryBibleDigest`), registry events
// folded into the bible row IN THE SAME call as gate evaluation
// (`applyBibleTurnIntegration`, SB4), due-key seeding through the existing
// thread store (R5.1), one-refresh-per-act guard (R6), and the §6 analytics
// payload shapes including `choice.locked_shown`.

import { describe, expect, it } from "vitest";

import {
  createInitialState,
  synthesizeFallbackArc,
  type LlmSceneProposal,
  type PlayerState,
  type Story,
  type StoryBible,
} from "@cyoa/engine";

import {
  applyBibleTurnIntegration,
  buildLockedShownPayload,
  loadStoryBibleDigest,
} from "../game";

const story: Story = {
  id: "open-premise",
  version: 1,
  title: "Open Canvas",
  startNodeId: "start",
  initialState: { vitality: 5, currency: 10, attributes: {}, inventory: [], flags: {} },
  endings: {},
  nodes: { start: { id: "start", seed: "Begin.", choices: [] } },
};

function stateWithArc(turnNumber = 4): PlayerState {
  const state = createInitialState(story, "story", 1, "seed");
  state.turnNumber = turnNumber;
  state.arc = synthesizeFallbackArc("A drowned city waits for its heir.", "Below");
  return state;
}

function bibleFixture(overrides: Partial<StoryBible> = {}): StoryBible {
  return {
    keyRegistry: [
      { id: "bone-key", label: "the Bone Key", opensHint: "opens the crypt gate", surfaceBand: "early", status: "planned" },
      { id: "ferry-token", label: "a ferryman's token", opensHint: "passage across", surfaceBand: "mid", status: "planned" },
      { id: "salt-lamp", label: "a salt lamp", opensHint: "", surfaceBand: "mid", status: "planned" },
      { id: "iron-writ", label: "the Iron Writ", opensHint: "", surfaceBand: "late", status: "planned" },
    ],
    lockPlan: [
      { id: "crypt-gate", label: "the crypt gate", keyId: "bone-key", gateBand: "mid", note: "", status: "planned" },
    ],
    cast: [],
    twists: [],
    endingHints: [
      { endingId: "ending-question-answered", requires: "answer the question" },
      { endingId: "totally-unmatched-ending", requires: "never matches" },
    ],
    motifs: ["salt"],
    source: "llm",
    version: 1,
    ...overrides,
  };
}

type AnyDoc = Record<string, any>;

function makeCtx(bibleRow: AnyDoc | null) {
  const analytics: AnyDoc[] = [];
  const patches: Array<{ id: string; patch: AnyDoc }> = [];
  const scheduled: Array<{ ref: string; args: any }> = [];
  const row = bibleRow ? { ...bibleRow } : null;
  const ctx: any = {
    db: {
      query(table: string) {
        const chain = {
          withIndex: () => chain,
          filter: () => chain,
          async first() {
            return table === "story_bibles" ? row : null;
          },
          async collect() {
            return table === "story_bibles" && row ? [row] : [];
          },
        };
        return chain;
      },
      async insert(table: string, doc: AnyDoc) {
        if (table === "analytics_events") analytics.push(doc);
        return `${table}_1`;
      },
      async patch(id: any, patch: AnyDoc) {
        patches.push({ id: String(id), patch });
        if (row && String(id) === String(row._id)) Object.assign(row, patch);
      },
      async get() {
        return null;
      },
    },
    scheduler: {
      async runAfter(_ms: number, ref: any, args: any) {
        scheduled.push({ ref: String(ref), args });
      },
    },
  };
  return { ctx, row, analytics, patches, scheduled };
}

function readyRow(bible: StoryBible, extra: AnyDoc = {}): AnyDoc {
  return {
    _id: "bible_1",
    saveId: "save_1",
    status: "ready",
    bible,
    retryCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

function gatedProposal(overrides: Partial<LlmSceneProposal> = {}): LlmSceneProposal {
  return {
    prose: "The gate looms.",
    choices: [
      { id: "walk-on", label: "Walk on", effects: [] },
      { id: "rest", label: "Rest a while", effects: [] },
      {
        id: "open-crypt",
        label: "Open the crypt gate",
        conditions: [{ kind: "has_item", itemId: "bone-key" }],
        lockedHint: "Needs the Bone Key",
        effects: [],
      },
    ],
    terminal: null,
    ...overrides,
  } as LlmSceneProposal;
}

const baseInput = {
  terminal: false,
  turnNumber: 4,
  saveIdValue: "save_1",
  accountId: "acct_1",
  storyId: "open-premise",
  premise: "A drowned city waits for its heir.",
  storySummary: "LOCATION: the dock.",
  actAdvanced: false,
  now: 1_000,
};

describe("applyBibleTurnIntegration — registry events folded atomically (SB4/R2.1)", () => {
  it("keeps a registry-backed gate locked, promises the key on the row, and fires the §6 analytics", async () => {
    const { ctx, row, analytics } = makeCtx(readyRow(bibleFixture()));
    const state = stateWithArc();
    const out = await applyBibleTurnIntegration(ctx, {
      ...baseInput,
      proposal: gatedProposal(),
      state,
    });

    const locked = out.choiceVisibilities.find((v) => v.choiceId === "open-crypt");
    expect(locked?.visibility).toBe("locked");
    expect(locked?.lockedHint).toBe("Needs the Bone Key");

    // The fold landed on the row inside the SAME call (no follow-up mutation).
    const foldedKey = (row!.bible as StoryBible).keyRegistry.find((k) => k.id === "bone-key");
    expect(foldedKey).toMatchObject({ status: "promised", promisedAtTurn: 4 });

    const promised = analytics.find((e) => e.eventName === "bible.key_promised");
    expect(promised?.payload).toMatchObject({ keyId: "bone-key", turn: 4 });

    // choice.locked_shown — once, at visibility computation, with the R4.6 shape.
    const lockedShown = analytics.filter((e) => e.eventName === "choice.locked_shown");
    expect(lockedShown).toHaveLength(1);
    expect(lockedShown[0]?.payload).toMatchObject({
      conditionKind: "has_item",
      itemId: "bone-key",
      everGranted: false,
      inRegistry: true,
    });
  });

  it("phantom-unlocks an unmatched gate on a bible-less save and records it (R4.5)", async () => {
    const { ctx, analytics } = makeCtx(null);
    const state = stateWithArc();
    const out = await applyBibleTurnIntegration(ctx, {
      ...baseInput,
      proposal: gatedProposal({
        choices: [
          { id: "walk-on", label: "Walk on", effects: [] },
          { id: "rest", label: "Rest a while", effects: [] },
          {
            id: "ghost-door",
            label: "Use the ghost key",
            conditions: [{ kind: "has_item", itemId: "ghost-key" }],
            lockedHint: "Needs the Ghost Key",
            effects: [],
          },
        ],
      } as Partial<LlmSceneProposal>),
      state,
    });
    const ghost = out.choiceVisibilities.find((v) => v.choiceId === "ghost-door");
    expect(ghost?.visibility).toBe("visible");
    const phantom = analytics.find((e) => e.eventName === "bible.gate_phantom_unlocked");
    expect(phantom?.payload).toMatchObject({ itemId: "ghost-key", turn: 4 });
    // No locked choice survived → no locked_shown row.
    expect(analytics.filter((e) => e.eventName === "choice.locked_shown")).toHaveLength(0);
  });

  it("adopts a hallucinated gate into a non-full registry (R4.3) and folds the adopted key", async () => {
    const { ctx, row, analytics } = makeCtx(readyRow(bibleFixture()));
    const state = stateWithArc();
    await applyBibleTurnIntegration(ctx, {
      ...baseInput,
      proposal: gatedProposal({
        choices: [
          { id: "walk-on", label: "Walk on", effects: [] },
          { id: "rest", label: "Rest a while", effects: [] },
          {
            id: "night-door",
            label: "Show the night pass",
            conditions: [{ kind: "has_item", itemId: "night-pass" }],
            lockedHint: "Needs a night pass",
            effects: [],
          },
        ],
      } as Partial<LlmSceneProposal>),
      state,
    });
    const adopted = (row!.bible as StoryBible).keyRegistry.find((k) => k.id === "night-pass");
    expect(adopted).toMatchObject({ status: "promised", adopted: true });
    expect(
      analytics.find((e) => e.eventName === "bible.key_adopted")?.payload,
    ).toMatchObject({ keyId: "night-pass", turn: 4 });
  });
});

describe("applyBibleTurnIntegration — promise seeding (R5.1)", () => {
  it("seeds a promised key ≥3 turns old through the existing thread store", async () => {
    const bible = bibleFixture();
    bible.keyRegistry[0] = {
      ...bible.keyRegistry[0]!,
      status: "promised",
      promisedAtTurn: 1,
    };
    const { ctx, row, analytics } = makeCtx(readyRow(bible));
    const state = stateWithArc(4);
    const out = await applyBibleTurnIntegration(ctx, {
      ...baseInput,
      proposal: gatedProposal({ choices: [
        { id: "walk-on", label: "Walk on", effects: [] },
        { id: "rest", label: "Rest a while", effects: [] },
      ] } as Partial<LlmSceneProposal>),
      state,
    });
    // The seeding rode state.delayed (NO parallel store) with delayNodes: 1
    // and an inventory_add of the key.
    expect(state.delayed).toHaveLength(1);
    expect(state.delayed[0]?.remainingNodes).toBe(1);
    expect(state.delayed[0]?.effects[0]).toMatchObject({
      kind: "inventory_add",
      item: { id: "bone-key", label: "the Bone Key" },
    });
    // thread_set diff surfaced for the echo; seeded flag folded onto the row.
    expect(out.seedDiffs.some((d) => (d as { kind: string }).kind === "thread_set")).toBe(true);
    expect(
      (row!.bible as StoryBible).keyRegistry.find((k) => k.id === "bone-key")?.seeded,
    ).toBe(true);
    expect(
      analytics.find((e) => e.eventName === "bible.key_seeded")?.payload,
    ).toMatchObject({ keyId: "bone-key", turn: 4 });
  });

  it("does not seed before 3 completed turns or on terminal turns", async () => {
    const bible = bibleFixture();
    bible.keyRegistry[0] = { ...bible.keyRegistry[0]!, status: "promised", promisedAtTurn: 2 };
    const { ctx } = makeCtx(readyRow(bible));
    const state = stateWithArc(4);
    await applyBibleTurnIntegration(ctx, { ...baseInput, proposal: null, state });
    expect(state.delayed).toHaveLength(0);

    const bibleDue = bibleFixture();
    bibleDue.keyRegistry[0] = { ...bibleDue.keyRegistry[0]!, status: "promised", promisedAtTurn: 1 };
    const { ctx: ctx2 } = makeCtx(readyRow(bibleDue));
    const state2 = stateWithArc(4);
    await applyBibleTurnIntegration(ctx2, {
      ...baseInput,
      proposal: null,
      state: state2,
      terminal: true,
    });
    expect(state2.delayed).toHaveLength(0);
  });
});

describe("applyBibleTurnIntegration — act refresh guard (R6)", () => {
  it("schedules ONE refresh per act boundary and stamps lastRefreshAct in the same call", async () => {
    const { ctx, row, scheduled } = makeCtx(readyRow(bibleFixture()));
    const state = stateWithArc(6);
    state.arc = { ...state.arc!, act: 2 };
    await applyBibleTurnIntegration(ctx, {
      ...baseInput,
      proposal: null,
      state,
      turnNumber: 6,
      actAdvanced: true,
    });
    const refreshes = scheduled.filter((j) => j.ref === "llm/storyBible:refreshStoryBible");
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]?.args).toMatchObject({
      saveId: "save_1",
      accountId: "acct_1",
      act: 2,
      premise: baseInput.premise,
      storySummary: baseInput.storySummary,
    });
    expect(row!.lastRefreshAct).toBe(2);

    // A duplicate act_advanced completion at the same act is guarded off.
    await applyBibleTurnIntegration(ctx, {
      ...baseInput,
      proposal: null,
      state,
      turnNumber: 7,
      actAdvanced: true,
    });
    expect(
      scheduled.filter((j) => j.ref === "llm/storyBible:refreshStoryBible"),
    ).toHaveLength(1);
  });

  it("never schedules a refresh without an act_advanced diff or without a bible", async () => {
    const { ctx, scheduled } = makeCtx(readyRow(bibleFixture()));
    const state = stateWithArc(6);
    state.arc = { ...state.arc!, act: 2 };
    await applyBibleTurnIntegration(ctx, { ...baseInput, proposal: null, state, turnNumber: 6 });
    expect(scheduled).toHaveLength(0);

    const { ctx: bibleless, scheduled: none } = makeCtx(null);
    await applyBibleTurnIntegration(bibleless, {
      ...baseInput,
      proposal: null,
      state,
      turnNumber: 6,
      actAdvanced: true,
    });
    expect(none).toHaveLength(0);
  });
});

describe("applyBibleTurnIntegration — failure safety (BC5)", () => {
  it("falls back to plain visibility when the bible surface throws", async () => {
    const ctx: any = {
      db: {
        query() {
          throw new Error("table_missing");
        },
        async insert() {
          throw new Error("nope");
        },
        async patch() {},
        async get() {
          return null;
        },
      },
    };
    const state = stateWithArc();
    const out = await applyBibleTurnIntegration(ctx, {
      ...baseInput,
      proposal: gatedProposal(),
      state,
    });
    // Never a turn failure: visibilities still computed (empty-registry path
    // auto-unlocks the unmatched gate).
    expect(out.choiceVisibilities).toHaveLength(3);
    expect(out.seedDiffs).toEqual([]);
  });
});

describe("loadStoryBibleDigest — attach-once (R1.5)", () => {
  const digestInput = {
    turnNumber: 3,
    saveIdValue: "save_1",
    accountId: "acct_1",
    storyId: "open-premise",
    now: 1_000,
  };

  it("attaches on first inclusion: arc-matched endingHints, attachedAtTurn patch, bible.attached", async () => {
    const { ctx, row, analytics, patches } = makeCtx(readyRow(bibleFixture()));
    const state = stateWithArc(3);
    const digest = await loadStoryBibleDigest(ctx, { ...digestInput, state });
    expect(digest).toBeDefined();
    expect(digest!.keys.length).toBeGreaterThan(0);
    expect(row!.attachedAtTurn).toBe(3);
    // The synthesized arc carries an "ending-question-answered"-style id set;
    // the unmatched hint is dropped and matched ones normalized (≤ original).
    const attachedBible = row!.bible as StoryBible;
    expect(
      attachedBible.endingHints.some((h) => h.endingId === "totally-unmatched-ending"),
    ).toBe(false);
    expect(analytics.find((e) => e.eventName === "bible.attached")?.payload).toMatchObject({
      turn: 3,
    });
    const patchCount = patches.length;

    // Second inclusion: no re-attach, no extra patch, digest still served.
    const again = await loadStoryBibleDigest(ctx, { ...digestInput, state });
    expect(again).toBeDefined();
    expect(patches.length).toBe(patchCount);
    expect(analytics.filter((e) => e.eventName === "bible.attached")).toHaveLength(1);
  });

  it("returns undefined on the opening turn, for missing/not-ready rows, and on errors", async () => {
    const state = stateWithArc(0);
    const { ctx } = makeCtx(readyRow(bibleFixture()));
    expect(
      await loadStoryBibleDigest(ctx, { ...digestInput, state, turnNumber: 0 }),
    ).toBeUndefined();

    const { ctx: noRow } = makeCtx(null);
    expect(
      await loadStoryBibleDigest(noRow, { ...digestInput, state: stateWithArc(3) }),
    ).toBeUndefined();

    const { ctx: queued } = makeCtx({ _id: "bible_1", saveId: "save_1", status: "queued", retryCount: 0 });
    expect(
      await loadStoryBibleDigest(queued, { ...digestInput, state: stateWithArc(3) }),
    ).toBeUndefined();
  });
});

describe("buildLockedShownPayload — payload shapes (R4.6)", () => {
  it("describes a numeric deficit for stat/currency gates", () => {
    const state = stateWithArc();
    state.currency = 10;
    const payload = buildLockedShownPayload(
      {
        id: "bribe",
        label: "Bribe the guard",
        conditions: [{ kind: "currency_at_least", value: 25 }],
      } as any,
      state,
      { keyRegistry: [] },
    );
    expect(payload).toMatchObject({
      conditionKind: "currency_at_least",
      everGranted: false,
      inRegistry: false,
      deficit: 15,
    });
    expect(payload.itemId).toBeUndefined();
  });

  it("marks everGranted from the itemsEverGranted ledger", () => {
    const state = stateWithArc();
    // The ledger stores refs normalized via normalizeItemRef ("bone-key" →
    // "bonekey") — see recordEverGranted.
    state.itemsEverGranted = ["bonekey"];
    const payload = buildLockedShownPayload(
      {
        id: "crypt",
        label: "Open the crypt",
        conditions: [{ kind: "has_item", itemId: "bone-key" }],
      } as any,
      state,
      { keyRegistry: [] },
    );
    expect(payload).toMatchObject({
      conditionKind: "has_item",
      itemId: "bone-key",
      everGranted: true,
      inRegistry: false,
    });
  });
});
