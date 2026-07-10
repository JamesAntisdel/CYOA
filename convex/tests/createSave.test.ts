// Tests for the seedNpcs validation + persistence path on `createSave`.
//
// The Seed-an-Adventure flow's "Optional cast" UI posts an array of
// {name, role, description} objects as `seedNpcs`. createSave validates
// them (allowlist name regex, length-bounded description, content policy
// gate, dedupe, hard cap at 8), converts each to an NpcState, and
// splices them into the story's `initialNpcs` map BEFORE invoking
// `createSaveRecord`. The engine's `createInitialState` then seeds the
// roster into `state.npcs`, which downstream pipelines (portrait queue,
// prompt sheets, roster UI) pick up automatically.
//
// These tests exercise the handler with a hand-built ctx mock — the same
// pattern used by `beginStreamingChoice.test.ts`. The "open-canvas"
// llm-driven starter is the simplest path through createSave (no media
// queue for llm-driven; the streaming completion handles it).

import { describe, expect, it } from "vitest";

import { createSave } from "../game";

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
    // createSave on llm-driven stories does NOT call runMutation or
    // scheduler in the createSave path; the streaming completion mutation
    // is what queues media. Tests don't need to stub either.
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

describe("createSave — seedNpcs validation", () => {
  it("populates state.npcs when seedNpcs holds valid entries", async () => {
    const { ctx, inserted } = makeCtx({
      account: makeAccountDoc(),
      entitlement: null,
    });

    await (createSave as any)._handler(
      ctx,
      baseArgs({
        seedNpcs: [
          { name: "Anya Vex", role: "companion", description: "A wry navigator who hates surprises." },
          { name: "Captain Drosk", role: "rival", description: "A ruthless prize-hunter from the inner ring." },
        ],
      }),
    );

    const saveInsert = inserted.find((row) => row.table === "saves");
    expect(saveInsert).toBeTruthy();
    const npcs = (saveInsert!.doc.state as { npcs: Record<string, any> }).npcs;
    const ids = Object.keys(npcs).sort();
    expect(ids).toEqual(["anya-vex", "captain-drosk"]);
    expect(npcs["anya-vex"]).toMatchObject({
      id: "anya-vex",
      name: "Anya Vex",
      role: "companion",
      disposition: 0,
      knownFacts: ["A wry navigator who hates surprises."],
    });
    expect(npcs["captain-drosk"]).toMatchObject({
      id: "captain-drosk",
      name: "Captain Drosk",
      role: "rival",
    });
  });

  it("leaves state.npcs empty when seedNpcs is omitted", async () => {
    const { ctx, inserted } = makeCtx({
      account: makeAccountDoc(),
      entitlement: null,
    });

    await (createSave as any)._handler(ctx, baseArgs({}));

    const saveInsert = inserted.find((row) => row.table === "saves");
    expect(saveInsert).toBeTruthy();
    const npcs = (saveInsert!.doc.state as { npcs: Record<string, any> }).npcs;
    expect(npcs).toEqual({});
  });

  it("rejects a name containing forbidden characters", async () => {
    const { ctx } = makeCtx({ account: makeAccountDoc(), entitlement: null });

    await expect(
      (createSave as any)._handler(
        ctx,
        baseArgs({
          seedNpcs: [
            // `<` and `>` are explicitly outside the allowlist (anti-injection).
            { name: "<script>x</script>", role: "ally", description: "A short bio for tests." },
          ],
        }),
      ),
    ).rejects.toThrow(/seed_npc_name_invalid/);
  });

  it("rejects a description that is too short", async () => {
    const { ctx } = makeCtx({ account: makeAccountDoc(), entitlement: null });

    await expect(
      (createSave as any)._handler(
        ctx,
        baseArgs({
          seedNpcs: [
            // 7 chars — below the 8-char floor.
            { name: "Rin", role: "ally", description: "tooshrt" },
          ],
        }),
      ),
    ).rejects.toThrow(/seed_npc_description_invalid/);
  });

  it("rejects a description blocked by the content policy", async () => {
    const { ctx } = makeCtx({ account: makeAccountDoc(), entitlement: null });

    await expect(
      (createSave as any)._handler(
        ctx,
        baseArgs({
          seedNpcs: [
            // "kill myself" is in safetyPatterns (suicide category) — the
            // publishing surface maps a hit there to a hard block.
            { name: "Sad NPC", role: "neutral", description: "I want to kill myself badly." },
          ],
        }),
      ),
    ).rejects.toThrow(/seed_npc_blocked/);
  });

  it("rejects duplicate names that slugify to the same id", async () => {
    const { ctx } = makeCtx({ account: makeAccountDoc(), entitlement: null });

    await expect(
      (createSave as any)._handler(
        ctx,
        baseArgs({
          seedNpcs: [
            { name: "Anya Vex", role: "companion", description: "First Anya in the cast." },
            // Punctuation/case differences all collapse to the same slug.
            { name: "anya vex", role: "rival", description: "Second Anya — collides on id." },
          ],
        }),
      ),
    ).rejects.toThrow(/seed_npc_duplicate_name/);
  });

  it("rejects more than 8 seed NPCs", async () => {
    const { ctx } = makeCtx({ account: makeAccountDoc(), entitlement: null });

    const tooMany = Array.from({ length: 9 }, (_, i) => ({
      name: `Cast Member ${i + 1}`,
      role: "ally" as const,
      description: `Fully-formed bio number ${i + 1} for cast cap test.`,
    }));

    await expect(
      (createSave as any)._handler(ctx, baseArgs({ seedNpcs: tooMany })),
    ).rejects.toThrow(/seed_npcs_too_many/);
  });
});
