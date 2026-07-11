// Story-bible scheduling matrix (task SB-S3, R1.1 / R1.6 / R2.4):
//   - exactly ONE bible row + ONE "llm/storyBible:generateStoryBible" job per
//     llm-driven createSave;
//   - ZERO for authored stories;
//   - forks COPY the source's ready bible row (consumption state included)
//     instead of scheduling a new call;
//   - the bible schedule is best-effort: a ctx without a scheduler (or a
//     failing insert) never fails the save mutation.

import { describe, expect, it } from "vitest";

import { createSave } from "../game";
import { forkTale } from "../talesFunctions";

type AnyDoc = Record<string, any>;

function accountDoc(): AnyDoc {
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

function makeCtx(seed: Record<string, AnyDoc[]> = {}, opts: { scheduler?: boolean } = {}) {
  const tables = new Map<string, AnyDoc[]>();
  const byId = new Map<string, AnyDoc>();
  for (const [table, rows] of Object.entries(seed)) {
    const copy = rows.map((row) => ({ ...row }));
    tables.set(table, copy);
    for (const row of copy) byId.set(String(row._id), row);
  }
  let nextId = 1;
  const scheduled: Array<{ ref: string; args: any }> = [];

  const ctx: any = {
    db: {
      async get(id: any) {
        return byId.get(String(id)) ?? null;
      },
      query(table: string) {
        const rows = () => tables.get(table) ?? [];
        const constraints: Array<[string, unknown]> = [];
        const q = {
          eq(field: string, value: unknown) {
            constraints.push([field, value]);
            return q;
          },
        };
        const filtered = () =>
          rows().filter((row) =>
            constraints.every(([field, value]) => row[field] === value),
          );
        const chain = {
          withIndex(_name: string, build?: (qq: any) => any) {
            if (build) build(q);
            return chain;
          },
          filter() {
            return chain;
          },
          async first() {
            return filtered()[0] ?? null;
          },
          async collect() {
            return filtered();
          },
          async take(n: number) {
            return filtered().slice(0, n);
          },
        };
        return chain;
      },
      async insert(table: string, doc: any) {
        const id = `${table}_${nextId++}`;
        const row = { ...doc, _id: id };
        if (!tables.has(table)) tables.set(table, []);
        tables.get(table)!.push(row);
        byId.set(id, row);
        return id;
      },
      async patch(id: any, patch: any) {
        const existing = byId.get(String(id));
        if (!existing) return;
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) delete existing[key];
          else existing[key] = value;
        }
      },
    },
    ...(opts.scheduler === false
      ? {}
      : {
          scheduler: {
            async runAfter(_ms: number, ref: any, args: any) {
              scheduled.push({ ref: String(ref), args });
            },
          },
        }),
  };
  return { ctx, tables, scheduled };
}

describe("createSave — bible job matrix (R1.1/R1.6)", () => {
  it("schedules exactly one bible job + row for an llm-driven save", async () => {
    const { ctx, tables, scheduled } = makeCtx({ accounts: [accountDoc()] });
    await (createSave as any)._handler(ctx, {
      accountId: "acct_1",
      guestTokenHash: "guest_hash",
      storyId: "open-canvas",
      mode: "story",
      seedPremise: "A lighthouse keeper hears knocking from below the waterline.",
      seedTitle: "Below the Waterline",
      seedTone: "slow-burn dread",
    });

    const rows = tables.get("story_bibles") ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "queued", retryCount: 0 });
    const saveId = (tables.get("saves") ?? [])[0]?._id;
    expect(rows[0]?.saveId).toBe(saveId);

    const bibleJobs = scheduled.filter(
      (j) => j.ref === "llm/storyBible:generateStoryBible",
    );
    expect(bibleJobs).toHaveLength(1);
    expect(bibleJobs[0]?.args).toMatchObject({
      saveId,
      accountId: "acct_1",
      premise: "A lighthouse keeper hears knocking from below the waterline.",
      storyTitle: "Below the Waterline",
      storyTone: "slow-burn dread",
      attempt: 0,
    });
  });

  it("schedules nothing for an authored story", async () => {
    const { ctx, tables, scheduled } = makeCtx({ accounts: [accountDoc()] });
    await (createSave as any)._handler(ctx, {
      accountId: "acct_1",
      guestTokenHash: "guest_hash",
      storyId: "training-room",
      mode: "story",
    });
    expect(tables.get("story_bibles") ?? []).toHaveLength(0);
    expect(
      scheduled.filter((j) => j.ref === "llm/storyBible:generateStoryBible"),
    ).toHaveLength(0);
  });

  it("still creates the save (row inserted, job skipped) when ctx has no scheduler", async () => {
    const { ctx, tables } = makeCtx({ accounts: [accountDoc()] }, { scheduler: false });
    const result = await (createSave as any)._handler(ctx, {
      accountId: "acct_1",
      guestTokenHash: "guest_hash",
      storyId: "open-canvas",
      mode: "story",
    });
    expect(result.saveId).toBeDefined();
    expect(tables.get("story_bibles") ?? []).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// forkTale — bible copy (R2.4). Seed mirrors talesFunctions.test.ts's
// publish/fork fixtures, plus a ready source bible row.
// ---------------------------------------------------------------------------

const AUTHORED_STORY = {
  id: "authored_seed:seed1",
  version: 1,
  title: "Door",
  defaultSceneLength: "standard",
  startNodeId: "start",
  initialState: { vitality: 5, currency: 0, attributes: {}, inventory: [], flags: {} },
  endings: {},
  nodes: {
    start: {
      id: "start",
      title: "Start",
      seed: "A small door.",
      choices: [{ id: "go", label: "Open the door", targetNodeId: "hall", effects: [] }],
    },
    hall: { id: "hall", title: "Hall", seed: "A quiet hall.", choices: [] },
  },
};

function forkSeed(extra: Record<string, AnyDoc[]> = {}) {
  return {
    accounts: [
      { ...accountDoc(), _id: "acct_owner", guestTokenHash: "owner_token" },
    ],
    authored_seeds: [
      { _id: "seed1", ownerAccountId: "acct_owner", status: "published", story: AUTHORED_STORY },
    ],
    saves: [
      {
        _id: "save_1",
        accountId: "acct_owner",
        storyId: "authored_seed:seed1",
        mode: "story",
        status: "active",
        engineVersion: 2,
        storyVersion: 1,
        currentNodeId: "hall",
        turnNumber: 1,
        createdAt: 1,
        updatedAt: 1,
        state: {},
      },
    ],
    published_tales: [
      {
        _id: "tale_1",
        ownerAccountId: "acct_owner",
        sourceSaveId: "save_1",
        storyId: "authored_seed:seed1",
        title: "The Quiet Hall",
        synopsis: "A small door.",
        privacy: "public",
        forkPolicy: "any_decision",
        isMature: false,
        safetySummary: {},
        snapshotTurnIds: ["turn_1"],
        snapshotTurns: [
          {
            sourceTurnId: "turn_1",
            turnNumber: 1,
            fromNodeId: "start",
            choiceId: "go",
            engineDiffs: [],
            engineEvents: [],
            stateAfter: {
              storyId: "authored_seed:seed1",
              mode: "story",
              currentNodeId: "hall",
              turnNumber: 1,
              vitality: 5,
              currency: 0,
              attributes: {},
              inventory: [],
              flags: {},
              delayed: [],
              visitedNodeIds: ["start", "hall"],
              unlockedEndings: [],
              schemaVersion: 2,
              rngSeed: "seed",
            },
            prose: "The door opens onto a quiet hall.",
            sceneMirror: { choiceViews: [], safety: { risk: "normal", reasons: [] }, provider: "deterministic" },
          },
        ],
        createdAt: 1,
        updatedAt: 5,
      },
    ],
    entitlements: [],
    ...extra,
  };
}

const SOURCE_BIBLE = {
  keyRegistry: [
    { id: "bone-key", label: "the Bone Key", opensHint: "opens the crypt", surfaceBand: "early", status: "promised", promisedAtTurn: 1 },
    { id: "ferry-token", label: "a token", opensHint: "", surfaceBand: "mid", status: "planned" },
    { id: "salt-lamp", label: "a lamp", opensHint: "", surfaceBand: "mid", status: "planned" },
    { id: "iron-writ", label: "the Writ", opensHint: "", surfaceBand: "late", status: "planned" },
  ],
  lockPlan: [],
  cast: [],
  twists: [],
  endingHints: [],
  motifs: [],
  source: "llm",
  version: 1,
};

describe("forkTale — bible copy (R2.4)", () => {
  it("copies the source save's ready bible row verbatim (consumption included)", async () => {
    const { ctx, tables, scheduled } = makeCtx(
      forkSeed({
        story_bibles: [
          {
            _id: "bible_src",
            saveId: "save_1",
            status: "ready",
            bible: SOURCE_BIBLE,
            attachedAtTurn: 1,
            lastRefreshAct: 2,
            retryCount: 1,
            createdAt: 1,
            updatedAt: 4,
          },
        ],
      }),
    );
    const fork = await (forkTale as any)._handler(ctx, {
      taleId: "tale_1",
      sourceTurnId: "turn_1",
      accountId: "acct_owner",
      guestTokenHash: "owner_token",
    });
    const rows = (tables.get("story_bibles") ?? []).filter(
      (r) => r.saveId === fork.saveId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "ready",
      attachedAtTurn: 1,
      lastRefreshAct: 2,
      retryCount: 1,
    });
    // Consumption state travels with the copy (the promised key stays promised).
    expect(rows[0]?.bible.keyRegistry[0]).toMatchObject({
      id: "bone-key",
      status: "promised",
      promisedAtTurn: 1,
    });
    // Forks never schedule a fresh bible call (R1.6).
    expect(
      scheduled.filter((j) => j.ref === "llm/storyBible:generateStoryBible"),
    ).toHaveLength(0);
  });

  it("does not copy (and does not fail) when the source has no ready bible", async () => {
    const { ctx, tables } = makeCtx(
      forkSeed({
        story_bibles: [
          {
            _id: "bible_src",
            saveId: "save_1",
            status: "failed",
            retryCount: 1,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      }),
    );
    const fork = await (forkTale as any)._handler(ctx, {
      taleId: "tale_1",
      sourceTurnId: "turn_1",
      accountId: "acct_owner",
      guestTokenHash: "owner_token",
    });
    expect(fork.saveId).toBeDefined();
    expect(
      (tables.get("story_bibles") ?? []).filter((r) => r.saveId === fork.saveId),
    ).toHaveLength(0);
  });
});
