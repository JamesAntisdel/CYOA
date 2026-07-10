// Handler-level tests for the registered publish/read/fork wrappers in
// `convex/talesFunctions.ts`. The pure snapshot/fork/projection logic is
// covered by `tales.test.ts`; these exercise the auth + persistence seam with
// a hand-built ctx mock (same style as coopFunctions.test.ts): publish a save
// as a tale, read it back (recording a tale_reads row), edit metadata, enforce
// mature-discovery exclusion, fork from a decision, and unpublish.

import { describe, expect, it } from "vitest";

import {
  editTaleMetadata,
  forkTale,
  listPublicTales,
  publishTale,
  readTale,
  unpublishTale,
} from "../talesFunctions";

type AnyDoc = Record<string, any>;

function makeCtx(seed: Record<string, AnyDoc[]>) {
  const tables = new Map<string, AnyDoc[]>();
  const byId = new Map<string, AnyDoc>();
  for (const [table, rows] of Object.entries(seed)) {
    const copy = rows.map((row) => ({ ...row }));
    tables.set(table, copy);
    for (const row of copy) byId.set(String(row._id), row);
  }
  let nextId = 1;

  const ctx = {
    auth: { getUserIdentity: async () => null },
    db: {
      async get(id: any) {
        return byId.get(String(id)) ?? null;
      },
      query(table: string) {
        const rows = tables.get(table) ?? [];
        const constraints: Array<[string, unknown]> = [];
        let direction: "asc" | "desc" = "asc";
        const q = {
          eq(field: string, value: unknown) {
            constraints.push([field, value]);
            return q;
          },
        };
        const filtered = () =>
          rows
            .filter((row) => constraints.every(([field, value]) => row[field] === value))
            .sort((a, b) =>
              direction === "asc"
                ? Number(a.turnNumber ?? 0) - Number(b.turnNumber ?? 0)
                : Number(b.turnNumber ?? 0) - Number(a.turnNumber ?? 0),
            );
        const chain = {
          withIndex(_name: string, build?: (qq: any) => any) {
            if (build) build(q);
            return chain;
          },
          order(dir: "asc" | "desc") {
            direction = dir;
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
  };
  return { ctx, tables };
}

function ownerAccount(): AnyDoc {
  return {
    _id: "acct_owner",
    kind: "guest",
    guestTokenHash: "owner_token",
    ageBand: "18+",
    matureContentEnabled: false,
    createdAt: 1,
    lastActiveAt: 1,
  };
}

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

function seedDoc(): AnyDoc {
  return { _id: "seed1", ownerAccountId: "acct_owner", status: "published", story: AUTHORED_STORY };
}

function saveDoc(): AnyDoc {
  return {
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
  };
}

function turnDoc(): AnyDoc {
  return {
    _id: "turn_1",
    saveId: "save_1",
    accountId: "acct_owner",
    requestId: "req-abcdefgh",
    turnNumber: 1,
    fromNodeId: "start",
    choiceId: "go",
    engineDiffs: [],
    engineEvents: [],
    provider: "deterministic",
    latency: { engineMs: 1, llmMs: 0 },
    createdAt: 2,
  };
}

function sceneDoc(): AnyDoc {
  return {
    _id: "scene_1",
    saveId: "save_1",
    nodeId: "hall",
    turnNumber: 1,
    stateFingerprint: "authored_seed:seed1:1:2:hall:1",
    prose: "The door opens onto a quiet hall.",
    streamStatus: "complete",
    choiceViews: [],
    engineEvents: [],
    safety: { risk: "normal", reasons: [] },
    provider: "deterministic",
    createdAt: 2,
  };
}

function baseSeed(extra: Record<string, AnyDoc[]> = {}) {
  return {
    accounts: [ownerAccount()],
    authored_seeds: [seedDoc()],
    saves: [saveDoc()],
    turn_history: [turnDoc()],
    scenes: [sceneDoc()],
    entitlements: [],
    ...extra,
  };
}

async function publish(ctx: any, overrides: Partial<Record<string, unknown>> = {}) {
  return (publishTale as any)._handler(ctx, {
    accountId: "acct_owner",
    guestTokenHash: "owner_token",
    saveId: "save_1",
    title: "The Quiet Hall",
    synopsis: "A small door and a quiet hall.",
    privacy: "public",
    forkPolicy: "any_decision",
    ...overrides,
  });
}

describe("talesFunctions — publish/read/fork lifecycle", () => {
  it("publishes a save into published_tales with a turn snapshot", async () => {
    const { ctx, tables } = makeCtx(baseSeed());
    const result = await publish(ctx);

    expect(result.turnCount).toBe(1);
    expect(result.isMature).toBe(false);
    const tale = tables.get("published_tales")?.[0];
    expect(tale?.snapshotTurnIds).toEqual(["turn_1"]);
    expect(tale?.sourceSaveId).toBe("save_1");
    // Denormalized: the doc now persists storyId + the full snapshot turns so
    // it survives the source save being rewound/purged.
    expect(tale?.storyId).toBe("authored_seed:seed1");
    expect(tale?.snapshotTurns).toHaveLength(1);
    expect(tale?.snapshotTurns?.[0]?.sourceTurnId).toBe("turn_1");
  });

  it("rejects publishing a save that is not owned by the caller", async () => {
    const { ctx } = makeCtx(baseSeed({ saves: [{ ...saveDoc(), accountId: "acct_other" }] }));
    await expect(publish(ctx)).rejects.toThrow("save_forbidden");
  });

  it("refuses to publish an empty save with no turns", async () => {
    const { ctx } = makeCtx(baseSeed({ turn_history: [] }));
    await expect(publish(ctx)).rejects.toThrow("tale_snapshot_empty");
  });

  it("reads a published tale, records a tale_reads row, and returns the prose", async () => {
    const { ctx, tables } = makeCtx(baseSeed());
    const { taleId } = await publish(ctx);

    const projection = await (readTale as any)._handler(ctx, { taleId });
    expect(projection.readOnly).toBe(true);
    expect(projection.turns[0].prose).toContain("quiet hall");
    expect(tables.get("tale_reads")?.length).toBe(1);
  });

  it("stops read-along immediately after unpublish (Req 21.6)", async () => {
    const { ctx } = makeCtx(baseSeed());
    const { taleId } = await publish(ctx);

    const unp = await (unpublishTale as any)._handler(ctx, {
      accountId: "acct_owner",
      guestTokenHash: "owner_token",
      taleId,
    });
    expect(unp.revoked).toBe(true);
    await expect((readTale as any)._handler(ctx, { taleId })).rejects.toThrow("tale_revoked");
  });

  it("edits metadata without rewriting the snapshot (Req 21.4)", async () => {
    const { ctx, tables } = makeCtx(baseSeed());
    const { taleId } = await publish(ctx);

    await (editTaleMetadata as any)._handler(ctx, {
      accountId: "acct_owner",
      guestTokenHash: "owner_token",
      taleId,
      title: "Renamed Hall",
      privacy: "friends",
    });
    const tale = tables.get("published_tales")?.[0];
    expect(tale?.title).toBe("Renamed Hall");
    expect(tale?.privacy).toBe("friends");
    expect(tale?.snapshotTurnIds).toEqual(["turn_1"]);
  });

  it("forks from a decision into a new save and records lineage (Req 21.3)", async () => {
    const { ctx, tables } = makeCtx(baseSeed());
    const { taleId } = await publish(ctx);

    const fork = await (forkTale as any)._handler(ctx, {
      taleId,
      sourceTurnId: "turn_1",
      accountId: "acct_owner",
      guestTokenHash: "owner_token",
    });
    expect(fork.saveId).toMatch(/^saves_/u);
    const forkedSave = tables.get("saves")?.find((s) => String(s._id) === String(fork.saveId));
    // Replayed engine state lands on the decision-point node.
    expect(forkedSave?.currentNodeId).toBe("hall");
    expect(tables.get("tale_forks")?.length).toBe(1);
    expect(tables.get("tale_forks")?.[0]?.newSaveId).toBe(fork.saveId);
  });

  it("refuses to fork when the publisher disabled forking", async () => {
    const { ctx } = makeCtx(baseSeed());
    const { taleId } = await publish(ctx, { forkPolicy: "disabled" });
    await expect(
      (forkTale as any)._handler(ctx, {
        taleId,
        sourceTurnId: "turn_1",
        accountId: "acct_owner",
        guestTokenHash: "owner_token",
      }),
    ).rejects.toThrow("forking_disabled");
  });
});

describe("talesFunctions — mature discovery exclusion (Req 12.9)", () => {
  function maturePublishedTale(): AnyDoc {
    return {
      _id: "tale_mature",
      ownerAccountId: "acct_owner",
      sourceSaveId: "save_1",
      storyId: "authored_seed:seed1",
      title: "Mature Tale",
      synopsis: "adult",
      privacy: "public",
      forkPolicy: "any_decision",
      isMature: true,
      safetySummary: {},
      snapshotTurnIds: ["turn_1"],
      createdAt: 1,
      updatedAt: 5,
    };
  }
  function generalPublishedTale(): AnyDoc {
    return { ...maturePublishedTale(), _id: "tale_general", title: "General Tale", isMature: false, updatedAt: 6 };
  }

  it("hides mature tales from anonymous and non-opted-in readers", async () => {
    const { ctx } = makeCtx({
      accounts: [ownerAccount()],
      entitlements: [],
      published_tales: [maturePublishedTale(), generalPublishedTale()],
    });
    const anon = await (listPublicTales as any)._handler(ctx, {});
    expect(anon.map((t: any) => t.taleId)).toEqual(["tale_general"]);
  });

  it("shows mature tales to an opted-in paid 18+ reader", async () => {
    const matureReader: AnyDoc = {
      _id: "acct_paid",
      kind: "user",
      userId: "paid@example.com",
      // Claimed account still carries a guest token (SSO not live) — the reader
      // authenticates via it. listPublicTales now requires a valid session
      // before honoring the account's 18+ opt-in, so the call must present it.
      guestTokenHash: "paid_token",
      ageBand: "18+",
      matureContentEnabled: true,
      createdAt: 1,
      lastActiveAt: 1,
    };
    const { ctx } = makeCtx({
      accounts: [matureReader],
      entitlements: [{ _id: "ent_1", accountId: "acct_paid", tier: "pro", status: "active" }],
      published_tales: [maturePublishedTale(), generalPublishedTale()],
    });
    const list = await (listPublicTales as any)._handler(ctx, {
      accountId: "acct_paid",
      guestTokenHash: "paid_token",
    });
    expect(list.map((t: any) => t.taleId).sort()).toEqual(["tale_general", "tale_mature"]);
  });

  it("excludes revoked tales from discovery", async () => {
    const { ctx } = makeCtx({
      accounts: [ownerAccount()],
      entitlements: [],
      published_tales: [{ ...generalPublishedTale(), accessRevokedAt: 99 }],
    });
    const list = await (listPublicTales as any)._handler(ctx, {});
    expect(list).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Req 10.1 — lead cinematic denormalization at publish
// ---------------------------------------------------------------------------
function cinematicAsset(overrides: Partial<AnyDoc> = {}): AnyDoc {
  return {
    _id: "asset_cine_1",
    accountId: "acct_owner",
    saveId: "save_1",
    kind: "cinematic",
    provider: "gemini-omni",
    cinematicTrigger: "ending",
    endingId: "ending_hall",
    status: "ready",
    url: "https://cdn.example/cinematic.mp4",
    hasAudio: true,
    provenance: { synthId: true },
    safety: { action: "allow" },
    createdAt: 10,
    readyAt: 12,
    ...overrides,
  };
}

describe("talesFunctions — lead cinematic (Req 10.1)", () => {
  it("denormalizes a ready ending cinematic onto the tale at publish", async () => {
    const { ctx, tables } = makeCtx(baseSeed({ assets: [cinematicAsset()] }));
    const result = await publish(ctx);
    expect(result.hasLeadCinematic).toBe(true);

    const tale = tables.get("published_tales")?.[0];
    expect(tale?.leadCinematic).toMatchObject({
      assetId: "asset_cine_1",
      url: "https://cdn.example/cinematic.mp4",
      hasAudio: true,
      synthId: true,
      endingId: "ending_hall",
    });
  });

  it("surfaces the lead cinematic on the read-along projection", async () => {
    const { ctx } = makeCtx(baseSeed({ assets: [cinematicAsset()] }));
    const { taleId } = await publish(ctx);
    const projection = await (readTale as any)._handler(ctx, { taleId });
    expect(projection.leadCinematic?.url).toBe("https://cdn.example/cinematic.mp4");
  });

  it("omits the cinematic when the save has none ready (still generating)", async () => {
    const { ctx, tables } = makeCtx(
      baseSeed({ assets: [cinematicAsset({ status: "generating", url: "" })] }),
    );
    const result = await publish(ctx);
    expect(result.hasLeadCinematic).toBe(false);
    expect(tables.get("published_tales")?.[0]?.leadCinematic).toBeUndefined();
  });

  it("omits the cinematic when the owner opts out (featureCinematic: false)", async () => {
    const { ctx, tables } = makeCtx(baseSeed({ assets: [cinematicAsset()] }));
    const result = await publish(ctx, { featureCinematic: false });
    expect(result.hasLeadCinematic).toBe(false);
    expect(tables.get("published_tales")?.[0]?.leadCinematic).toBeUndefined();
  });

  it("does not feature a cinematic the safety gate blocked", async () => {
    const { ctx } = makeCtx(
      baseSeed({ assets: [cinematicAsset({ safety: { action: "block" } })] }),
    );
    const result = await publish(ctx);
    expect(result.hasLeadCinematic).toBe(false);
  });

  it("ignores an opening cinematic — only endings are featured", async () => {
    const { ctx } = makeCtx(
      baseSeed({
        assets: [cinematicAsset({ cinematicTrigger: "opening", endingId: undefined })],
      }),
    );
    const result = await publish(ctx);
    expect(result.hasLeadCinematic).toBe(false);
  });
});
