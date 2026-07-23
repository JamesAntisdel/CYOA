// Reading-modes R3 (Illustrated Book) — the MODE-SCOPED still-guarantee
// fallback in `queueSceneImage` + the `outOfCredits` signal on `getSceneMedia`.
//
// The pipeline the still rides on is UNCHANGED (RM8 — the still already fires
// under every Pro strategy). The only new server behavior is what happens when
// `chargeMediaSpend` fails (credit exhaustion):
//   - Illustrated Book (`illustrated_book` strategy) ONLY: keep a lightweight,
//     UNMETERED placeholder asset (tagged) and let `getSceneMedia` emit
//     `outOfCredits: true` so MediaPlate degrades to a stylized plate instead of
//     a permanent bare skeleton (R3.4/R3.5).
//   - Every OTHER reader: BYTE-IDENTICAL delete-and-skeleton (regression pin).
//
// Same lightweight fake-ctx pattern as media/npcMedia/history tests: an
// in-memory doc map + table arrays, index stubs that match on eq() filters, and
// `_handler` direct invocation to bypass the Convex validator. The runImagenJob
// action is never reached (the failure path returns before scheduling it).

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  OUT_OF_CREDITS_PLACEHOLDER_TAG,
  getSceneMedia,
  queueSceneImage,
} from "../media/sceneMedia";

type Row = Record<string, unknown>;

const ACCOUNT_ID = "acct_1";
const SAVE_ID = "save_1";
const SCENE_ID = "scene_1";
const GUEST_HASH = "guest_hash";

function proEntitlement(overrides: Row = {}): Row {
  return {
    _id: "ent_1",
    accountId: ACCOUNT_ID,
    tier: "pro",
    status: "active",
    // Zero monthly allowance so chargeMediaSpend falls through to the spark
    // path, which then finds an empty ledger and returns charged:false.
    includedImages: 0,
    includedVideos: 0,
    ...overrides,
  };
}

function accountDoc(cinematicMode: string | undefined): Row {
  return {
    _id: ACCOUNT_ID,
    kind: "guest",
    ageBand: "18+",
    matureContentEnabled: false,
    guestTokenHash: GUEST_HASH,
    createdAt: 1,
    lastActiveAt: 1,
    mediaPrefs: {
      imagesEnabled: true,
      audioEnabled: true,
      videoEnabled: true,
      ...(cinematicMode ? { cinematicMode } : {}),
    },
  };
}

function saveDoc(): Row {
  return { _id: SAVE_ID, accountId: ACCOUNT_ID, currentSceneId: SCENE_ID, turnNumber: 2 };
}

function sceneDoc(): Row {
  return { _id: SCENE_ID, saveId: SAVE_ID, nodeId: "open-canvas:llm:2" };
}

function makeCtx(input: {
  cinematicMode?: string | undefined;
  entitlement?: Row | null;
  assets?: Row[];
  ledger?: Row[];
}) {
  const docs = new Map<string, Row>();
  const tables: Record<string, Row[]> = {
    entitlements: input.entitlement === null ? [] : [input.entitlement ?? proEntitlement()],
    assets: [...(input.assets ?? [])],
    media_credits_ledger: [...(input.ledger ?? [])],
    story_bibles: [],
  };

  const account = accountDoc(input.cinematicMode);
  docs.set(ACCOUNT_ID, account);
  docs.set(SAVE_ID, saveDoc());
  docs.set(SCENE_ID, sceneDoc());
  for (const t of Object.values(tables)) for (const row of t) docs.set(String(row._id), row);

  let nextId = 1;
  const scheduled: Array<{ fnRef: unknown; args: Row }> = [];

  const ctx = {
    db: {
      async get(id: unknown) {
        return docs.get(String(id)) ?? null;
      },
      query(table: string) {
        const rows = tables[table] ?? [];
        const filters: Record<string, unknown> = {};
        const chain: any = {
          withIndex(_name: string, build: (q: any) => any) {
            build({
              eq(field: string, value: unknown) {
                filters[field] = value;
                return this;
              },
            });
            return chain;
          },
          async first() {
            return (
              rows.find((row) => Object.entries(filters).every(([k, v]) => row[k] === v)) ?? null
            );
          },
          async collect() {
            return rows.filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v));
          },
        };
        return chain;
      },
      async insert(table: string, doc: Row) {
        const id = `${table}_${nextId++}`;
        const stored = { _id: id, ...doc };
        (tables[table] ??= []).push(stored);
        docs.set(id, stored);
        return id;
      },
      async patch(id: unknown, patch: Row) {
        const doc = docs.get(String(id));
        if (doc) Object.assign(doc, patch);
      },
      async delete(id: unknown) {
        const key = String(id);
        docs.delete(key);
        for (const t of Object.values(tables)) {
          const idx = t.findIndex((row) => String(row._id) === key);
          if (idx >= 0) t.splice(idx, 1);
        }
      },
    },
    scheduler: {
      async runAfter(_ms: number, fnRef: unknown, args: Row) {
        scheduled.push({ fnRef, args });
      },
    },
    auth: {
      async getUserIdentity() {
        return null;
      },
    },
  };

  return { ctx, tables, scheduled };
}

const baseImageArgs = {
  accountId: ACCOUNT_ID,
  saveId: SAVE_ID,
  sceneId: SCENE_ID,
  prompt: "A candlelit archive with rain at the windows.",
  alt: "A candlelit archive.",
};

describe("queueSceneImage — mode-scoped still-guarantee fallback (RM8, R3.4/R3.5)", () => {
  const prior = process.env.CYOA_DEV_FORCE_PRO_MEDIA;
  beforeEach(() => {
    // The fallback lives past the dev-force bypass; keep the real billing path.
    delete process.env.CYOA_DEV_FORCE_PRO_MEDIA;
  });
  afterEach(() => {
    if (prior === undefined) delete process.env.CYOA_DEV_FORCE_PRO_MEDIA;
    else process.env.CYOA_DEV_FORCE_PRO_MEDIA = prior;
  });

  it("keeps an unmetered placeholder (not delete) and does NOT bill for the illustrated_book mode", async () => {
    const { ctx, tables, scheduled } = makeCtx({ cinematicMode: "illustrated_book" });

    const result = await (queueSceneImage as any)._handler(ctx, baseImageArgs);

    // Placeholder kept, not deleted; a distinct return shape from the silent drop.
    expect(result).toEqual({ queued: false, reason: "insufficient_sparks", placeholder: true });

    // The asset row survives, marked failed + tagged so getSceneMedia can signal.
    const assetRows = tables.assets ?? [];
    expect(assetRows).toHaveLength(1);
    const placeholder = assetRows[0]!;
    expect(placeholder.status).toBe("failed");
    expect(placeholder.tags).toEqual([OUT_OF_CREDITS_PLACEHOLDER_TAG]);

    // Nothing was billed — no spend debit written to the ledger (charge failed).
    expect(tables.media_credits_ledger).toHaveLength(0);

    // The turn never blocks on media: no runImagenJob was scheduled.
    expect(scheduled).toHaveLength(0);
  });

  it("honors an explicit guaranteedStill override even under a non-illustrated strategy", async () => {
    // The integrator MAY thread guaranteedStill; when it does, the placeholder
    // fires regardless of the resolved strategy.
    const { ctx, tables } = makeCtx({ cinematicMode: "stills_only" });

    const result = await (queueSceneImage as any)._handler(ctx, {
      ...baseImageArgs,
      guaranteedStill: true,
    });

    expect(result).toEqual({ queued: false, reason: "insufficient_sparks", placeholder: true });
    const overrideRows = tables.assets ?? [];
    expect(overrideRows).toHaveLength(1);
    expect(overrideRows[0]!.tags).toEqual([OUT_OF_CREDITS_PLACEHOLDER_TAG]);
  });

  it("REGRESSION: every other mode still deletes and holds at skeleton (byte-identical)", async () => {
    for (const cinematicMode of ["stills_only", "per_scene_legacy", "endpoint_cinematic", undefined]) {
      const { ctx, tables, scheduled } = makeCtx({ cinematicMode });

      const result = await (queueSceneImage as any)._handler(ctx, baseImageArgs);

      // Byte-identical to today: delete the queued row, return the silent-drop
      // shape with NO `placeholder` key.
      expect(result).toEqual({ queued: false, reason: "insufficient_sparks" });
      expect(tables.assets).toHaveLength(0); // deleted
      expect(tables.media_credits_ledger).toHaveLength(0); // nothing billed
      expect(scheduled).toHaveLength(0); // no imagen job
    }
  });
});

describe("getSceneMedia — outOfCredits signal (RM8, R3.4)", () => {
  const prior = process.env.CYOA_DEV_FORCE_PRO_MEDIA;
  beforeEach(() => {
    delete process.env.CYOA_DEV_FORCE_PRO_MEDIA;
  });
  afterEach(() => {
    if (prior === undefined) delete process.env.CYOA_DEV_FORCE_PRO_MEDIA;
    else process.env.CYOA_DEV_FORCE_PRO_MEDIA = prior;
  });

  const readArgs = {
    accountId: ACCOUNT_ID,
    saveId: SAVE_ID,
    sceneId: SCENE_ID,
    guestTokenHash: GUEST_HASH,
  };

  it("emits outOfCredits:true after the illustrated_book placeholder is kept", async () => {
    const { ctx } = makeCtx({ cinematicMode: "illustrated_book" });

    // 1) Exhaust credits → placeholder kept on the same ctx.
    await (queueSceneImage as any)._handler(ctx, baseImageArgs);
    // 2) The client poll now surfaces the out-of-credits signal.
    const media = await (getSceneMedia as any)._handler(ctx, readArgs);

    expect(media).not.toBeNull();
    expect(media.outOfCredits).toBe(true);
    // Still a projection (not a bare null) so the layout has something to render.
    expect(media.kind).toBe("image");
  });

  it("does NOT emit outOfCredits for a normal ready still (no placeholder tag)", async () => {
    const readyImage: Row = {
      _id: "asset_ready",
      accountId: ACCOUNT_ID,
      saveId: SAVE_ID,
      sceneId: SCENE_ID,
      kind: "image",
      provider: "vertex-imagen",
      url: "https://cdn/still.png",
      status: "ready",
      entitlementRequired: "pro",
      promptHash: "p_ready",
      provenance: { provider: "vertex-imagen", promptHash: "p_ready", promptRedacted: true, source: "generated" },
      safety: { action: "allow", categories: [], reason: "" },
      alt: "A ready still.",
      tags: [],
      createdAt: 1,
      updatedAt: 1,
      readyAt: 1,
    };
    const { ctx } = makeCtx({ cinematicMode: "illustrated_book", assets: [readyImage] });

    const media = await (getSceneMedia as any)._handler(ctx, readArgs);

    expect(media).not.toBeNull();
    expect(media.outOfCredits).toBeUndefined();
    expect(media.status).toBe("ready");
    expect(media.imageUri).toBe("https://cdn/still.png");
  });
});
