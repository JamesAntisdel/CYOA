// Handler-level tests for the community seed shelf (creator-arc; core-read-loop
// Req 22.3/22.6, steering product feature 13): publish metadata + lint gate,
// the public shelf listing (visibility/mature matrix, cursor paging), remix,
// and the cross-account launch path through game:createSave / game:listLibrary.
// Same hand-built ctx style as creatorFunctions.test.ts / createSave.test.ts.

import { describe, expect, it } from "vitest";

import { listPublishedPublic, publish, remix, validateSeed } from "../creatorFunctions";
import { createSave, listLibrary } from "../game";
import { creatorHandle } from "../liveCore";

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
        const rows = () => tables.get(table) ?? [];
        const constraints: Array<[string, unknown]> = [];
        const q = {
          eq(field: string, value: unknown) {
            constraints.push([field, value]);
            return q;
          },
        };
        const filtered = () =>
          rows().filter((row) => constraints.every(([field, value]) => row[field] === value));
        const chain = {
          withIndex(_name: string, build?: (qq: any) => any) {
            if (build) build(q);
            return chain;
          },
          order(_direction: string) {
            return chain;
          },
          async first() {
            return filtered()[0] ?? null;
          },
          async collect() {
            return filtered();
          },
          async take(count: number) {
            return filtered().slice(0, count);
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

function readerAccount(): AnyDoc {
  return { ...ownerAccount(), _id: "acct_reader", guestTokenHash: "reader_token" };
}

/** A claimed 18+ account with an active pro entitlement — the only viewer
 * class `canEnableMatureContent` clears (Req 12.9). */
function matureAccount(): AnyDoc {
  return {
    ...ownerAccount(),
    _id: "acct_mature",
    kind: "user",
    userId: "mature@example.test",
    guestTokenHash: "mature_token",
    matureContentEnabled: true,
  };
}

function matureEntitlement(): AnyDoc {
  return {
    _id: "ent_mature",
    accountId: "acct_mature",
    tier: "pro",
    status: "active",
    overageOptIn: false,
    updatedAt: 1,
  };
}

function storyDoc(): AnyDoc {
  return {
    id: "seed",
    version: 1,
    title: "Seed",
    startNodeId: "start",
    initialState: { vitality: 3, currency: 0, attributes: {}, inventory: [], flags: {} },
    endings: { end: { id: "end", label: "End", kind: "success" } },
    nodes: {
      start: {
        id: "start",
        seed: "A clean opening on a quiet shelf.",
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

function shelfFixture(extra: Record<string, AnyDoc[]> = {}) {
  return {
    accounts: [ownerAccount(), readerAccount(), matureAccount()],
    entitlements: [matureEntitlement()],
    authored_seeds: [
      seedDoc({
        _id: "seed_pub",
        title: "Public One",
        status: "published",
        visibility: "public",
        synopsis: "A short synopsis.",
        tone: "gothic-mystery",
        forkPolicy: "allowed",
        publishedAt: 100,
        updatedAt: 100,
      }),
      seedDoc({
        _id: "seed_pub2",
        title: "Public Two",
        status: "published",
        visibility: "public",
        publishedAt: 200,
        updatedAt: 200,
      }),
      seedDoc({
        _id: "seed_unlisted",
        title: "Unlisted",
        status: "published",
        visibility: "unlisted",
        publishedAt: 150,
        updatedAt: 150,
      }),
      // Legacy published seed — predates the visibility field entirely.
      seedDoc({ _id: "seed_legacy", title: "Legacy", status: "published", updatedAt: 170 }),
      seedDoc({ _id: "seed_draft", title: "Draft", status: "draft", visibility: "public" }),
      seedDoc({
        _id: "seed_mature",
        title: "Mature Public",
        status: "published",
        visibility: "public",
        isMature: true,
        publishedAt: 300,
        updatedAt: 300,
      }),
    ],
    ...extra,
  };
}

async function listPublic(ctx: any, args: Record<string, unknown> = {}) {
  return (listPublishedPublic as any)._handler(ctx, args);
}

describe("creatorFunctions — listPublishedPublic (visibility matrix)", () => {
  it("shows guests explicit-public, non-mature seeds only, newest publish first", async () => {
    const { ctx } = makeCtx(shelfFixture());
    const page = await listPublic(ctx);
    expect(page.seeds.map((s: any) => s.seedId)).toEqual(["seed_pub2", "seed_pub"]);
    expect(page.nextCursor).toBeNull();
    const first = page.seeds[1];
    expect(first.storyId).toBe("authored_seed:seed_pub");
    expect(first.synopsis).toBe("A short synopsis.");
    expect(first.tone).toBe("gothic-mystery");
    expect(first.opening).toContain("A clean opening");
    expect(first.isMature).toBe(false);
    expect(first.forkPolicy).toBe("allowed");
    // The raw account id never crosses the wire — only the pseudonym.
    expect(first.ownerHandle).toBe(creatorHandle("acct_owner"));
    expect(first.ownerHandle).not.toContain("acct_owner");
  });

  it("includes mature seeds for an owned 18+ opted-in session with a paid entitlement", async () => {
    const { ctx } = makeCtx(shelfFixture());
    const page = await listPublic(ctx, {
      accountId: "acct_mature",
      guestTokenHash: "mature_token",
    });
    expect(page.seeds.map((s: any) => s.seedId)).toEqual([
      "seed_mature",
      "seed_pub2",
      "seed_pub",
    ]);
  });

  it("degrades an unowned session to the non-mature list instead of throwing", async () => {
    const { ctx } = makeCtx(shelfFixture());
    const page = await listPublic(ctx, {
      accountId: "acct_mature",
      guestTokenHash: "wrong_token",
    });
    expect(page.seeds.map((s: any) => s.seedId)).toEqual(["seed_pub2", "seed_pub"]);
  });

  it("pages with a publishedAt cursor", async () => {
    const { ctx } = makeCtx(shelfFixture());
    const first = await listPublic(ctx, { limit: 1 });
    expect(first.seeds.map((s: any) => s.seedId)).toEqual(["seed_pub2"]);
    expect(first.nextCursor).toBe(200);
    const second = await listPublic(ctx, { limit: 1, cursor: first.nextCursor });
    expect(second.seeds.map((s: any) => s.seedId)).toEqual(["seed_pub"]);
    expect(second.nextCursor).toBeNull();
  });
});

describe("creatorFunctions — publish metadata (Req 22.6)", () => {
  function publishArgs(overrides: Record<string, unknown> = {}) {
    return {
      accountId: "acct_owner",
      guestTokenHash: "owner_token",
      seedId: "seed1",
      ...overrides,
    };
  }

  it("persists synopsis/tone/visibility/forkPolicy and stamps publishedAt + isMature", async () => {
    const { ctx, tables } = makeCtx({
      accounts: [ownerAccount()],
      authored_seeds: [seedDoc()],
    });
    const result = await (publish as any)._handler(
      ctx,
      publishArgs({
        synopsis: "  A tale of quiet doors.  ",
        tone: "gothic-mystery",
        visibility: "public",
        forkPolicy: "disabled",
      }),
    );
    expect(result.seed.status).toBe("published");
    const row = tables.get("authored_seeds")![0]!;
    expect(row.synopsis).toBe("A tale of quiet doors.");
    expect(row.tone).toBe("gothic-mystery");
    expect(row.visibility).toBe("public");
    expect(row.forkPolicy).toBe("disabled");
    expect(row.isMature).toBe(false);
    expect(typeof row.publishedAt).toBe("number");
  });

  it("defaults a metadata-less publish to unlisted so nothing reaches the shelf implicitly", async () => {
    const { ctx, tables } = makeCtx({
      accounts: [ownerAccount()],
      authored_seeds: [seedDoc()],
    });
    await (publish as any)._handler(ctx, publishArgs());
    const row = tables.get("authored_seeds")![0]!;
    expect(row.visibility).toBe("unlisted");
    expect(row.forkPolicy).toBe("allowed");
  });

  it("rejects an over-long synopsis and a policy-blocked synopsis", async () => {
    const { ctx } = makeCtx({ accounts: [ownerAccount()], authored_seeds: [seedDoc()] });
    await expect(
      (publish as any)._handler(ctx, publishArgs({ synopsis: "x".repeat(201) })),
    ).rejects.toThrow("seed_synopsis_too_long");
    await expect(
      (publish as any)._handler(ctx, publishArgs({ synopsis: "you are worthless" })),
    ).rejects.toThrow("seed_synopsis_blocked");
  });

  it("refuses to publish a seed whose gates can never open (lint errors block)", async () => {
    const story = storyDoc();
    story.nodes.start.choices = [
      {
        id: "locked",
        label: "Open the iron door",
        targetNodeId: "end",
        conditions: [{ kind: "has_item", itemId: "iron-key" }],
      },
    ];
    const { ctx } = makeCtx({
      accounts: [ownerAccount()],
      authored_seeds: [seedDoc({ story })],
    });
    await expect((publish as any)._handler(ctx, publishArgs())).rejects.toThrow(
      /nodes\.start\.choices\.locked\.conditions\.0/,
    );
  });

  it("surfaces non-blocking lint warnings as advisories from validateSeed", async () => {
    const story = storyDoc();
    story.nodes.start.choices = [
      { id: "go", label: "Go", targetNodeId: "end" },
      {
        id: "strong",
        label: "Force it",
        targetNodeId: "end",
        conditions: [{ kind: "stat_at_least", statId: "resolve", value: 99 }],
      },
    ];
    const { ctx } = makeCtx({ accounts: [ownerAccount()], authored_seeds: [seedDoc()] });
    const result = await (validateSeed as any)._handler(ctx, {
      accountId: "acct_owner",
      guestTokenHash: "owner_token",
      story,
    });
    // Warnings never block (the drafts shelf treats issues as field errors).
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.advisories).toHaveLength(1);
    expect(result.advisories[0].severity).toBe("warning");
    expect(result.advisories[0].path).toBe("nodes.start.choices.strong.conditions.0");
  });
});

describe("creatorFunctions — remix", () => {
  async function runRemix(ctx: any, overrides: Record<string, unknown> = {}) {
    return (remix as any)._handler(ctx, {
      accountId: "acct_reader",
      guestTokenHash: "reader_token",
      seedId: "seed_pub",
      ...overrides,
    });
  }

  it("copies a public seed into a new draft credited to the source", async () => {
    const { ctx, tables } = makeCtx(shelfFixture());
    const result = await runRemix(ctx);
    const rows = tables.get("authored_seeds")!;
    const draft = rows.find((row) => row._id === result.seedId)!;
    expect(draft.ownerAccountId).toBe("acct_reader");
    expect(draft.status).toBe("draft");
    expect(draft.title).toBe("Public One (remix)");
    expect(draft.remixOfSeedId).toBe("seed_pub");
    expect(draft.remixOfTitle).toBe("Public One");
    // The source row is untouched.
    expect(rows.find((row) => row._id === "seed_pub")!.status).toBe("published");
  });

  it("honors forkPolicy: disabled refuses non-owners but never the owner", async () => {
    const fixture = shelfFixture();
    fixture.authored_seeds = fixture.authored_seeds.map((row) =>
      row._id === "seed_pub" ? { ...row, forkPolicy: "disabled" } : row,
    );
    const { ctx } = makeCtx(fixture);
    await expect(runRemix(ctx)).rejects.toThrow("creator_seed_remix_disabled");
    const owned = await runRemix(ctx, {
      accountId: "acct_owner",
      guestTokenHash: "owner_token",
    });
    expect(owned.seed.remixOfSeedId).toBe("seed_pub");
    expect(owned.seed.title).toBe("Public One");
  });

  it("refuses drafts for non-owners and mature seeds for non-opted-in readers", async () => {
    const { ctx } = makeCtx(shelfFixture());
    await expect(runRemix(ctx, { seedId: "seed_draft" })).rejects.toThrow(
      "creator_seed_forbidden",
    );
    await expect(runRemix(ctx, { seedId: "seed_mature" })).rejects.toThrow(
      "creator_seed_mature_forbidden",
    );
  });
});

describe("game — cross-account seed launch (Req 22.3)", () => {
  async function launch(ctx: any, overrides: Record<string, unknown> = {}) {
    return (createSave as any)._handler(ctx, {
      accountId: "acct_reader",
      guestTokenHash: "reader_token",
      storyId: "authored_seed:seed_pub",
      mode: "story",
      ...overrides,
    });
  }

  it("launches another creator's public seed as a fresh run", async () => {
    const { ctx, tables } = makeCtx(shelfFixture());
    const result = await launch(ctx);
    expect(result.saveId).toBeTruthy();
    const save = tables.get("saves")![0]!;
    expect(save.accountId).toBe("acct_reader");
    expect(save.storyId).toBe("authored_seed:seed_pub");
    expect(save.currentNodeId).toBe("start");
  });

  it("launches unlisted seeds by direct id (link possession) but never drafts", async () => {
    const { ctx } = makeCtx(shelfFixture());
    await expect(launch(ctx, { storyId: "authored_seed:seed_unlisted" })).resolves.toMatchObject({
      saveId: expect.any(String),
    });
    await expect(launch(ctx, { storyId: "authored_seed:seed_draft" })).rejects.toThrow(
      "creator_seed_forbidden",
    );
  });

  it("blocks mature seeds for readers without the 18+ opt-in and allows opted-in users", async () => {
    const { ctx } = makeCtx(shelfFixture());
    await expect(launch(ctx, { storyId: "authored_seed:seed_mature" })).rejects.toThrow(
      "creator_seed_mature_forbidden",
    );
    await expect(
      launch(ctx, {
        accountId: "acct_mature",
        guestTokenHash: "mature_token",
        storyId: "authored_seed:seed_mature",
      }),
    ).resolves.toMatchObject({ saveId: expect.any(String) });
  });

  it("resolves foreign seed titles in the library so non-owner saves aren't opaque ids", async () => {
    const { ctx } = makeCtx(shelfFixture());
    await launch(ctx);
    const items = await (listLibrary as any)._handler(ctx, {
      accountId: "acct_reader",
      guestTokenHash: "reader_token",
    });
    expect(items).toHaveLength(1);
    expect(items[0].storyId).toBe("authored_seed:seed_pub");
    expect(items[0].title).toBe("Public One");
  });
});
