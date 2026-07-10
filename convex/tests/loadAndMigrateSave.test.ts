// Tests for `loadAndMigrateSave` (convex/game.ts).
//
// The bug we're guarding against: legacy v1 saves don't carry `state.npcs`.
// The engine's `cloneState` calls `cloneNpcRoster(state.npcs)` unconditionally
// and `Object.entries(undefined)` throws TypeError — that fired on every
// turn until this loader was wired in. The loader runs `migrateSaveIfNeeded`
// (which backfills `npcs: {}` for v1 saves) and then patches the migrated
// state back to the canonical doc so subsequent reads don't pay the
// migration cost.

import { describe, expect, it } from "vitest";

import { loadAndMigrateSave } from "../game";

type DocPatch = { id: string; patch: Record<string, unknown> };

function makeLegacyV1SaveDoc(): Record<string, unknown> {
  // Hand-rolled v1 payload — no `npcs`, schemaVersion === 1. Mirrors what
  // saves written before Requirement 31 (NPCs and Companions) look like in
  // production.
  return {
    _id: "save_legacy_v1",
    accountId: "acct_1",
    storyId: "open-canvas",
    mode: "story",
    status: "active",
    engineVersion: 1,
    storyVersion: 1,
    state: {
      storyId: "open-canvas",
      mode: "story",
      vitality: 5,
      currency: 0,
      attributes: {},
      inventory: [],
      flags: {},
      currentNodeId: "start",
      turnNumber: 0,
      path: ["start"],
      delayed: [],
      endingsUnlocked: {},
      // intentionally omitting `npcs` to simulate a pre-Requirement-31 save
      schemaVersion: 1,
    },
    currentNodeId: "start",
    turnNumber: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeV2SaveDoc(): Record<string, unknown> {
  return {
    ...makeLegacyV1SaveDoc(),
    _id: "save_modern_v2",
    engineVersion: 2,
    state: {
      ...(makeLegacyV1SaveDoc().state as Record<string, unknown>),
      npcs: {},
      schemaVersion: 2,
    },
  };
}

function makeCtx(initialDocs: Array<Record<string, unknown>>) {
  const docs = new Map<string, Record<string, unknown>>(
    initialDocs.map((d) => [String(d._id), d]),
  );
  const patches: DocPatch[] = [];
  const ctx = {
    db: {
      async get(id: any) {
        return docs.get(String(id)) ?? null;
      },
      async patch(id: any, patch: Record<string, unknown>) {
        patches.push({ id: String(id), patch });
        const existing = docs.get(String(id));
        if (existing) docs.set(String(id), { ...existing, ...patch });
      },
    },
  };
  return { ctx, docs, patches };
}

describe("loadAndMigrateSave", () => {
  it("migrates a legacy v1 save to v2 with npcs:{} on first read", async () => {
    const { ctx } = makeCtx([makeLegacyV1SaveDoc()]);
    const save = await loadAndMigrateSave(ctx, "save_legacy_v1");
    expect(save).not.toBeNull();
    const state = save!.state as Record<string, unknown>;
    expect(state.schemaVersion).toBe(2);
    expect(state.npcs).toEqual({});
    expect(save!.engineVersion).toBe(2);
  });

  it("patches the canonical doc when migration runs so later reads see v2", async () => {
    const { ctx, patches, docs } = makeCtx([makeLegacyV1SaveDoc()]);
    await loadAndMigrateSave(ctx, "save_legacy_v1");
    expect(patches).toHaveLength(1);
    const patch = patches[0]!;
    expect(patch.id).toBe("save_legacy_v1");
    expect(patch.patch).toMatchObject({ engineVersion: 2 });
    const patchState = patch.patch.state as Record<string, unknown>;
    expect(patchState.schemaVersion).toBe(2);
    expect(patchState.npcs).toEqual({});
    expect(typeof patch.patch.updatedAt).toBe("number");

    // Subsequent read hits the migrated doc (no second patch).
    const second = await loadAndMigrateSave(ctx, "save_legacy_v1");
    expect(patches).toHaveLength(1);
    expect((second!.state as Record<string, unknown>).schemaVersion).toBe(2);
    const docAfter = docs.get("save_legacy_v1")!;
    expect((docAfter.state as Record<string, unknown>).schemaVersion).toBe(2);
  });

  it("returns the save unchanged (no patch) for an already-v2 save", async () => {
    const { ctx, patches } = makeCtx([makeV2SaveDoc()]);
    const save = await loadAndMigrateSave(ctx, "save_modern_v2");
    expect(save).not.toBeNull();
    expect((save!.state as Record<string, unknown>).schemaVersion).toBe(2);
    expect(patches).toHaveLength(0);
  });

  it("returns null for a missing save id (caller throws domain error)", async () => {
    const { ctx } = makeCtx([]);
    const save = await loadAndMigrateSave(ctx, "save_does_not_exist");
    expect(save).toBeNull();
  });
});
