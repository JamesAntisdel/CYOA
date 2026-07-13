// Tests for `game:restartRun` (panel-2 ranked idea 1 — server-side "Begin
// again"). restartRun reads an ended save and copies its SEED IDENTITY onto a
// fresh save with the same storyId, so a seeded open-canvas run restarts as the
// SAME story instead of a blank canvas (the old client-side restart resolved
// the title via listStarterStories(), which excludes the open-canvas shell and
// authored_seed:<id>).
//
// Same hand-built ctx pattern as createSave.test.ts. We create a seeded save,
// then restart it against the SAME ctx (so the ended save doc is retrievable
// via ctx.db.get) and assert the new save reproduces the premise + cast.

import { describe, expect, it } from "vitest";

import { createSave, restartRun, reconstructSeedNpcs } from "../game";

type Insert = { table: string; doc: any; id: string };

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
  const account = makeAccountDoc();
  docs.set(String(account._id), account);
  const inserted: Insert[] = [];
  let nextId = 1;

  const ctx = {
    db: {
      async get(id: any) {
        return docs.get(String(id)) ?? null;
      },
      query(_table: string) {
        const chain = {
          withIndex(_name: string, _build: (q: any) => any) {
            return chain;
          },
          filter(_build: (q: any) => any) {
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
        docs.set(id, { ...doc, _id: id });
        return id;
      },
      async patch(id: any, patch: any) {
        const existing = docs.get(String(id));
        if (existing) docs.set(String(id), { ...existing, ...patch });
      },
    },
  };
  return { ctx, inserted };
}

describe("game:restartRun", () => {
  it("copies premise + reconstructed cast from an ended seeded run into a fresh save", async () => {
    const { ctx, inserted } = makeCtx();

    // 1. A seeded open-canvas run (premise + optional cast + tone).
    const created: any = await (createSave as any)._handler(ctx, {
      accountId: "acct_1",
      guestTokenHash: "guest_hash",
      storyId: "open-canvas",
      mode: "story",
      seedPremise: "A haunted lighthouse keeper hunts the thing in the fog.",
      seedTitle: "The Fog Keeper",
      seedTone: "gothic",
      seedNpcs: [
        { name: "Anya Vex", role: "companion", description: "A wry navigator who hates surprises." },
      ],
    });
    const endedSaveId: string = created.saveId;

    // 2. Restart it — same ctx, so the ended save is retrievable.
    const restarted: any = await (restartRun as any)._handler(ctx, {
      accountId: "acct_1",
      saveId: endedSaveId,
      guestTokenHash: "guest_hash",
    });

    expect(restarted.saveId).not.toBe(endedSaveId);
    const saveInserts = inserted.filter((row) => row.table === "saves");
    expect(saveInserts).toHaveLength(2);
    const fresh = saveInserts[1]!.doc;
    expect(fresh.storyId).toBe("open-canvas");
    expect(fresh.seedPremise).toBe("A haunted lighthouse keeper hunts the thing in the fog.");
    expect(fresh.seedTitle).toBe("The Fog Keeper");
    expect(fresh.seedTone).toBe("gothic");
    // The reader-authored cast is reconstructed (never persisted as a field).
    const npcs = (fresh.state as { npcs: Record<string, any> }).npcs;
    expect(Object.keys(npcs)).toContain("anya-vex");
    expect(npcs["anya-vex"]).toMatchObject({ name: "Anya Vex", role: "companion", disposition: 0 });
  });

  it("throws save_not_found for an unknown saveId", async () => {
    const { ctx } = makeCtx();
    await expect(
      (restartRun as any)._handler(ctx, {
        accountId: "acct_1",
        saveId: "saves_missing",
        guestTokenHash: "guest_hash",
      }),
    ).rejects.toThrow(/save_not_found/);
  });
});

describe("reconstructSeedNpcs (pure)", () => {
  const state = (npcs: Record<string, any>) => ({ npcs }) as any;

  it("reconstructs createSave-seeded NPCs (description in knownFacts, no description field)", () => {
    const out = reconstructSeedNpcs(
      state({
        mira: {
          id: "mira",
          name: "Mira",
          role: "companion",
          disposition: 40,
          attributes: {},
          knownFacts: ["A ferrywoman who guards a secret."],
          flags: {},
        },
      }),
    );
    expect(out).toEqual([
      { name: "Mira", role: "companion", description: "A ferrywoman who guards a secret." },
    ]);
  });

  it("skips LLM-spawned NPCs (they carry a `description` field) and fact-less rosters", () => {
    const out = reconstructSeedNpcs(
      state({
        spawned: {
          id: "spawned",
          name: "Rook",
          role: "ally",
          disposition: 0,
          attributes: {},
          knownFacts: ["Rook appeared in the market."],
          flags: {},
          description: "An LLM-spawned bystander.",
        },
        factless: {
          id: "factless",
          name: "Silent One",
          role: "neutral",
          disposition: 0,
          attributes: {},
          knownFacts: [],
          flags: {},
        },
      }),
    );
    expect(out).toEqual([]);
  });
});
