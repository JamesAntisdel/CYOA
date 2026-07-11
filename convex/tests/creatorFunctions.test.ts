// Handler-level tests for the registered creator iteration-loop wrappers in
// `convex/creatorFunctions.ts` (updateDraft + validateSeed). The pure
// validation/update logic is covered by `creator.test.ts`; these exercise the
// auth + persistence seam with a hand-built ctx mock (same style as
// talesFunctions.test.ts): update a draft in place, reject foreign/immutable
// seeds, and return structured per-field issues from validateSeed.

import { describe, expect, it } from "vitest";

import { archive, updateDraft, validateSeed } from "../creatorFunctions";

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
        const q = {
          eq(field: string, value: unknown) {
            constraints.push([field, value]);
            return q;
          },
        };
        const filtered = () =>
          rows.filter((row) => constraints.every(([field, value]) => row[field] === value));
        const chain = {
          withIndex(_name: string, build?: (qq: any) => any) {
            if (build) build(q);
            return chain;
          },
          async first() {
            return filtered()[0] ?? null;
          },
          async collect() {
            return filtered();
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

function otherAccount(): AnyDoc {
  return { ...ownerAccount(), _id: "acct_other", guestTokenHash: "other_token" };
}

function storyDoc() {
  return {
    id: "seed",
    version: 1,
    title: "Seed",
    startNodeId: "start",
    initialState: { vitality: 3, currency: 0 },
    endings: { end: { id: "end", label: "End", kind: "success" } },
    nodes: {
      start: {
        id: "start",
        seed: "A clean opening.",
        choices: [{ id: "go", label: "Go", targetNodeId: "end" }],
      },
      end: { id: "end", endingId: "end", choices: [] },
    },
  };
}

function seedDoc(overrides: AnyDoc = {}): AnyDoc {
  return {
    _id: "seed1",
    ownerAccountId: "acct_owner",
    title: "Seed",
    status: "draft",
    story: storyDoc(),
    safetySummary: { action: "allow", safetyCategories: [], matureCategories: [], redacted: false },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function baseSeed(extra: Record<string, AnyDoc[]> = {}) {
  return {
    accounts: [ownerAccount(), otherAccount()],
    authored_seeds: [seedDoc()],
    ...extra,
  };
}

async function update(ctx: any, overrides: Partial<Record<string, unknown>> = {}) {
  return (updateDraft as any)._handler(ctx, {
    accountId: "acct_owner",
    guestTokenHash: "owner_token",
    seedId: "seed1",
    title: "Seed II",
    story: { ...storyDoc(), title: "Seed II" },
    ...overrides,
  });
}

describe("creatorFunctions — updateDraft", () => {
  it("re-saves the draft row in place instead of inserting a new one", async () => {
    const { ctx, tables } = makeCtx(baseSeed());
    const result = await update(ctx);

    expect(result.seedId).toBe("seed1");
    expect(result.seed.status).toBe("draft");
    const rows = tables.get("authored_seeds")!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Seed II");
    expect(rows[0]!.story.title).toBe("Seed II");
    expect(rows[0]!.createdAt).toBe(1);
    expect(rows[0]!.updatedAt).toBeGreaterThan(1);
    // The stringified _id stamped by seedFromDoc must not ride into the patch.
    expect(rows[0]!._id).toBe("seed1");
  });

  it("rejects updates from a caller who does not own the seed", async () => {
    const { ctx } = makeCtx(baseSeed());
    await expect(
      update(ctx, { accountId: "acct_other", guestTokenHash: "other_token" }),
    ).rejects.toThrow("creator_seed_forbidden");
  });

  it("rejects a session token that does not match the owner account", async () => {
    const { ctx } = makeCtx(baseSeed());
    await expect(update(ctx, { guestTokenHash: "wrong_token" })).rejects.toThrow("resource_not_owned");
  });

  it("refuses to mutate published seeds", async () => {
    const { ctx } = makeCtx(baseSeed({ authored_seeds: [seedDoc({ status: "published" })] }));
    await expect(update(ctx)).rejects.toThrow("creator_seed_not_draft");
  });

  it("rejects unknown seeds and structurally invalid stories", async () => {
    const { ctx } = makeCtx(baseSeed());
    await expect(update(ctx, { seedId: "missing" })).rejects.toThrow("creator_seed_not_found");
    // `creator_seed_invalid` is the AppError code; the message carries the
    // flattened `path: message` list.
    await expect(
      update(ctx, { story: { ...storyDoc(), startNodeId: "missing" } }),
    ).rejects.toThrow("startNodeId: Start node does not exist");
  });

  it("blocks unsafe updates with the offending field named in the error", async () => {
    const { ctx, tables } = makeCtx(baseSeed());
    await expect(
      update(ctx, { story: { ...storyDoc(), title: "you are worthless" } }),
    ).rejects.toThrow(/content_blocked: title/);
    // Failed gate must not leave partial writes behind.
    expect(tables.get("authored_seeds")![0]!.title).toBe("Seed");
  });
});

describe("creatorFunctions — validateSeed", () => {
  it("returns structured per-field issues instead of a flattened error", async () => {
    const { ctx } = makeCtx(baseSeed());
    const result = await (validateSeed as any)._handler(ctx, {
      accountId: "acct_owner",
      guestTokenHash: "owner_token",
      story: {
        ...storyDoc(),
        startNodeId: "missing",
        nodes: {
          ...storyDoc().nodes,
          start: {
            id: "start",
            seed: "you are worthless",
            choices: [{ id: "go", label: "Go", targetNodeId: "end" }],
          },
        },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      path: "startNodeId",
      message: "Start node does not exist",
      kind: "structure",
    });
    expect(result.issues).toContainEqual({
      path: "nodes.start.seed",
      message: "Blocked by content policy (player_directed_despair)",
      kind: "safety",
    });
  });

  it("returns valid with no issues for a clean story", async () => {
    const { ctx } = makeCtx(baseSeed());
    const result = await (validateSeed as any)._handler(ctx, {
      accountId: "acct_owner",
      guestTokenHash: "owner_token",
      story: storyDoc(),
    });
    expect(result).toEqual({ valid: true, issues: [] });
  });
});

describe("creatorFunctions — archive (shelf action)", () => {
  it("archives an owned seed so it drops off the drafts shelf", async () => {
    const { ctx, tables } = makeCtx(baseSeed());
    const result = await (archive as any)._handler(ctx, {
      accountId: "acct_owner",
      guestTokenHash: "owner_token",
      seedId: "seed1",
    });
    expect(result.seed.status).toBe("archived");
    expect(tables.get("authored_seeds")![0]!.status).toBe("archived");
  });
});
