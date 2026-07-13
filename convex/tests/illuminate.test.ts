// Fake-ctx tests for the reader-facing "Illuminate this page" surface
// (convex/media/illuminate.ts). Covers the cosmetic guard (unresolved scene is
// rejected), a single spark charge, idempotent double-tap (no double charge),
// the refund-on-failure path (linked assetId → refundSpark reverses), the dev
// billing bypass, the exhausted-balance degrade, and the getSparkBalance query.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { requestIllumination, getSparkBalance } from "../media/illuminate";
import { refundSpark, ledgerSumForAccount } from "../billing/mediaCredits";
import { MEDIA_SPARK_COSTS } from "../billing/mediaCosts";

type AnyDoc = Record<string, any>;

// A general fake Convex ctx: an id→doc store plus table-aware `query().withIndex`
// that actually filters on the `.eq(...)` keys the handlers pass, so idempotency,
// balance, and dedupe behave for real. Supports `.order().take()` for
// buildBeatTimeline's turn_history read.
function makeCtx(seed: {
  accounts?: AnyDoc[];
  saves?: AnyDoc[];
  scenes?: AnyDoc[];
  assets?: AnyDoc[];
  entitlements?: AnyDoc[];
  ledger?: AnyDoc[];
}) {
  const tables: Record<string, AnyDoc[]> = {
    accounts: [...(seed.accounts ?? [])],
    saves: [...(seed.saves ?? [])],
    scenes: [...(seed.scenes ?? [])],
    assets: [...(seed.assets ?? [])],
    entitlements: [...(seed.entitlements ?? [])],
    media_credits_ledger: [...(seed.ledger ?? [])],
    turn_history: [],
    story_bibles: [],
  };
  const byId = new Map<string, AnyDoc>();
  for (const rows of Object.values(tables)) for (const r of rows) if (r._id) byId.set(String(r._id), r);
  let nextId = 1;
  const scheduled: Array<{ ref: string; args: AnyDoc }> = [];

  const ctx = {
    auth: { async getUserIdentity() { return null; } },
    scheduler: {
      async runAfter(_ms: number, ref: unknown, args: AnyDoc) {
        scheduled.push({ ref: String(ref), args });
      },
    },
    db: {
      async get(id: unknown) {
        return byId.get(String(id)) ?? null;
      },
      query(table: string) {
        const rows = tables[table] ?? [];
        const build = (extra?: (r: AnyDoc) => boolean) => {
          const filters: Record<string, unknown> = {};
          const q = { eq(f: string, val: unknown) { filters[f] = val; return q; } };
          let ordered = rows;
          const api: AnyDoc = {
            withIndex(_name: string, b: (qq: any) => any) {
              b(q);
              return api;
            },
            order(_dir: string) { return api; },
            async first() {
              return applyFilter()[0] ?? null;
            },
            async collect() {
              return applyFilter();
            },
            async take(n: number) {
              return applyFilter().slice(0, n);
            },
          };
          function applyFilter() {
            return ordered.filter(
              (r) =>
                Object.entries(filters).every(([k, v]) => r[k] === v) &&
                (extra ? extra(r) : true),
            );
          }
          void ordered;
          return api;
        };
        return build();
      },
      async insert(table: string, doc: AnyDoc) {
        const id = `${table}_${nextId++}`;
        const row = { _id: id, ...doc };
        (tables[table] ??= []).push(row);
        byId.set(id, row);
        return id;
      },
      async patch(id: unknown, patch: AnyDoc) {
        const row = byId.get(String(id));
        if (row) Object.assign(row, patch);
      },
      async delete(id: unknown) {
        const key = String(id);
        const row = byId.get(key);
        byId.delete(key);
        for (const rows of Object.values(tables)) {
          const i = rows.indexOf(row as AnyDoc);
          if (i >= 0) rows.splice(i, 1);
        }
      },
    },
  };
  return {
    ctx,
    tables: tables as Record<string, AnyDoc[]> & {
      media_credits_ledger: AnyDoc[];
      assets: AnyDoc[];
    },
    scheduled,
  };
}

const GUEST = {
  _id: "acct_reader",
  kind: "guest",
  guestTokenHash: "gth",
  ageBand: "18+",
  matureContentEnabled: false,
  createdAt: 1,
  lastActiveAt: 1,
};

function baseSeed(overrides?: { sceneStatus?: string; ledgerBalance?: number }) {
  return {
    accounts: [GUEST],
    saves: [{ _id: "save_1", accountId: "acct_reader", storyId: "story_1", seedTitle: "The Vault" }],
    scenes: [
      {
        _id: "scene_1",
        saveId: "save_1",
        nodeId: "n1",
        prose: "A candle gutters in the vault.",
        streamStatus: overrides?.sceneStatus ?? "complete",
      },
    ],
    entitlements: [
      { _id: "ent_1", accountId: "acct_reader", tier: "free", status: "active" },
    ],
    ledger:
      overrides?.ledgerBalance === undefined
        ? []
        : [
            {
              _id: "led_seed",
              accountId: "acct_reader",
              delta: overrides.ledgerBalance,
              reason: "pack_purchase",
              idempotencyKey: "seed",
              createdAt: 1,
            },
          ],
  };
}

const authArgs = { accountId: "acct_reader" as any, saveId: "save_1" as any, guestTokenHash: "gth" };

beforeEach(() => {
  delete process.env.CYOA_DEV_FORCE_PRO_MEDIA;
});
afterEach(() => {
  delete process.env.CYOA_DEV_FORCE_PRO_MEDIA;
});

describe("requestIllumination — cosmetic guard", () => {
  it("rejects an unresolved (still-streaming) scene", async () => {
    const { ctx } = makeCtx(baseSeed({ sceneStatus: "streaming", ledgerBalance: 500 }));
    await expect(
      (requestIllumination as any)._handler(ctx, {
        ...authArgs,
        sceneId: "scene_1" as any,
        kind: "still",
      }),
    ).rejects.toThrow("illumination_scene_unresolved");
  });

  it("rejects a scene that belongs to another save", async () => {
    const seed = baseSeed({ ledgerBalance: 500 });
    seed.scenes[0]!.saveId = "save_other";
    const { ctx } = makeCtx(seed);
    await expect(
      (requestIllumination as any)._handler(ctx, {
        ...authArgs,
        sceneId: "scene_1" as any,
        kind: "still",
      }),
    ).rejects.toThrow("illumination_scene_mismatch");
  });
});

describe("requestIllumination — charge + idempotency", () => {
  it("charges exactly one still (15 sparks), queues the asset, schedules the render", async () => {
    const { ctx, tables, scheduled } = makeCtx(baseSeed({ ledgerBalance: 500 }));
    const res = await (requestIllumination as any)._handler(ctx, {
      ...authArgs,
      sceneId: "scene_1" as any,
      kind: "still",
    });
    expect(res.status).toBe("queued");
    expect(res.sparksCharged).toBe(MEDIA_SPARK_COSTS.scene_still);
    expect(res.balanceAfter).toBe(500 - MEDIA_SPARK_COSTS.scene_still);
    // Exactly one spend debit, linked to the asset, keyed illum:<sceneId>:<kind>.
    const debits = tables.media_credits_ledger.filter((r) => r.reason === "reader_spend");
    expect(debits).toHaveLength(1);
    expect(debits[0]).toMatchObject({
      delta: -15,
      assetId: res.assetId,
      idempotencyKey: "illum:scene_1:still",
    });
    // A queued image asset attached to the scene.
    const asset = tables.assets.find((a) => a._id === res.assetId);
    expect(asset).toMatchObject({ kind: "image", status: "queued", sceneId: "scene_1" });
    // The render action was scheduled (not the queue mutation).
    expect(scheduled.map((s) => s.ref)).toContain("media/sceneMedia:runImagenJob");
    expect(scheduled[0]!.args).toMatchObject({ assetId: res.assetId, videoAllowed: false });
  });

  it("is idempotent: a second tap is a no-op, never double-charges", async () => {
    const { ctx, tables } = makeCtx(baseSeed({ ledgerBalance: 500 }));
    const first = await (requestIllumination as any)._handler(ctx, {
      ...authArgs,
      sceneId: "scene_1" as any,
      kind: "still",
    });
    const second = await (requestIllumination as any)._handler(ctx, {
      ...authArgs,
      sceneId: "scene_1" as any,
      kind: "still",
    });
    expect(second.status).toBe("illuminated");
    expect(second.alreadyPresent).toBe(true);
    expect(second.sparksCharged).toBe(0);
    expect(second.assetId).toBe(first.assetId);
    expect(tables.media_credits_ledger.filter((r) => r.reason === "reader_spend")).toHaveLength(1);
  });

  it("charges 240 sparks for a cinematic illumination", async () => {
    const { ctx, tables } = makeCtx(baseSeed({ ledgerBalance: 500 }));
    const res = await (requestIllumination as any)._handler(ctx, {
      ...authArgs,
      sceneId: "scene_1" as any,
      kind: "cinematic",
    });
    expect(res.status).toBe("queued");
    expect(res.sparksCharged).toBe(MEDIA_SPARK_COSTS.omni_cinematic);
    const asset = tables.assets.find((a) => a._id === res.assetId);
    expect(asset).toMatchObject({ kind: "cinematic", status: "queued", cinematicTrigger: "chapter" });
  });
});

describe("requestIllumination — refund on failure", () => {
  it("refunds the charged spark when the asset is later marked failed", async () => {
    const { ctx, tables } = makeCtx(baseSeed({ ledgerBalance: 500 }));
    const res = await (requestIllumination as any)._handler(ctx, {
      ...authArgs,
      sceneId: "scene_1" as any,
      kind: "still",
    });
    expect(await ledgerSumForAccount(ctx, "acct_reader")).toBe(485);
    // The existing mark-failed path calls refundSpark(ctx, assetId); simulate it.
    const refunded = await refundSpark(ctx, res.assetId);
    expect(refunded).toEqual({ refunded: true, sparks: 15 });
    expect(await ledgerSumForAccount(ctx, "acct_reader")).toBe(500);
    expect(tables.media_credits_ledger.filter((r) => r.reason === "refund")).toHaveLength(1);
  });
});

describe("requestIllumination — balance + dev bypass", () => {
  it("degrades (no charge, drops the asset) when the balance can't cover the cost", async () => {
    const { ctx, tables } = makeCtx(baseSeed({ ledgerBalance: 5 }));
    const res = await (requestIllumination as any)._handler(ctx, {
      ...authArgs,
      sceneId: "scene_1" as any,
      kind: "still",
    });
    expect(res.status).toBe("insufficient_sparks");
    expect(res.sparksCharged).toBe(0);
    expect(tables.assets.filter((a) => a.status === "queued")).toHaveLength(0);
    expect(tables.media_credits_ledger.filter((r) => r.reason === "reader_spend")).toHaveLength(0);
  });

  it("records the request but skips the charge under CYOA_DEV_FORCE_PRO_MEDIA", async () => {
    process.env.CYOA_DEV_FORCE_PRO_MEDIA = "1";
    const { ctx, tables } = makeCtx(baseSeed({ ledgerBalance: 0 }));
    const res = await (requestIllumination as any)._handler(ctx, {
      ...authArgs,
      sceneId: "scene_1" as any,
      kind: "still",
    });
    expect(res.status).toBe("queued");
    expect(res.sparksCharged).toBe(0);
    expect(tables.assets.find((a) => a._id === res.assetId)).toMatchObject({ status: "queued" });
    expect(tables.media_credits_ledger.filter((r) => r.reason === "reader_spend")).toHaveLength(0);
  });
});

describe("getSparkBalance", () => {
  it("returns the summed ledger balance for the authorized reader", async () => {
    const { ctx } = makeCtx(baseSeed({ ledgerBalance: 320 }));
    const res = await (getSparkBalance as any)._handler(ctx, {
      accountId: "acct_reader" as any,
      guestTokenHash: "gth",
    });
    expect(res).toEqual({ balance: 320 });
  });

  it("rejects a caller who does not own the session", async () => {
    const { ctx } = makeCtx(baseSeed({ ledgerBalance: 320 }));
    await expect(
      (getSparkBalance as any)._handler(ctx, {
        accountId: "acct_reader" as any,
        guestTokenHash: "wrong",
      }),
    ).rejects.toThrow();
  });
});
