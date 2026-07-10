// Handler-level tests for the endpoint-cinematics queue mutation + the pure
// fallback selector. Fake-ctx style (mirrors npcMedia.test.ts / coopFunctions
// .test.ts): a hand-built db/scheduler mock exercises the real handler so we
// cover the strategy gate, the dedupe (C5), the queued asset shape, and the
// scheduled Omni job — without a live Convex deployment.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  queueEndpointCinematic,
  selectCinematicFallback,
  selectCinematicReferences,
  rankCompanionReferences,
  pickSpacedBeatStills,
  type ReferenceCandidate,
  type RawReferenceCandidates,
} from "../media/cinematics";
import { queueSceneVideo } from "../media/sceneMedia";

type AnyDoc = Record<string, unknown>;

const ACCOUNT_ID = "acct_1";
const SAVE_ID = "save_1";
const SCENE_ID = "scene_1";

function endpointCinematicAccount(): AnyDoc {
  return {
    _id: ACCOUNT_ID,
    kind: "user",
    ageBand: "18+",
    matureContentEnabled: false,
    createdAt: 1,
    lastActiveAt: 1,
    mediaPrefs: {
      imagesEnabled: true,
      audioEnabled: true,
      videoEnabled: true,
      cinematicMode: "endpoint_cinematic",
    },
  };
}

function legacyAccount(): AnyDoc {
  return {
    _id: ACCOUNT_ID,
    kind: "user",
    ageBand: "18+",
    matureContentEnabled: false,
    createdAt: 1,
    lastActiveAt: 1,
    // No cinematicMode → resolver defaults to per_scene_legacy.
    mediaPrefs: { imagesEnabled: true, audioEnabled: true, videoEnabled: true },
  };
}

function saveDoc(): AnyDoc {
  return {
    _id: SAVE_ID,
    accountId: ACCOUNT_ID,
    storyId: "story-omni",
    seedTitle: "The Long Dusk",
    storySummary: "The hero crossed the salt flats and bargained with the toll-keeper.",
    currentSceneId: SCENE_ID,
    anchorProtagonistAssetId: "anchor_pro",
    anchorSettingAssetId: "anchor_set",
    turnNumber: 5,
  };
}

function makeCtx(seed: {
  account: AnyDoc;
  entitlement?: AnyDoc | null;
  save?: AnyDoc | null;
  assets?: AnyDoc[];
}) {
  const docs = new Map<string, AnyDoc>();
  docs.set(ACCOUNT_ID, seed.account);
  if (seed.save !== null) docs.set(SAVE_ID, seed.save ?? saveDoc());
  docs.set(SCENE_ID, { _id: SCENE_ID, prose: "The gate of the last city yawns open." });

  const entitlements = seed.entitlement === null ? [] : [seed.entitlement ?? { accountId: ACCOUNT_ID, tier: "pro", status: "active" }];
  const assets = [...(seed.assets ?? [])];
  const inserted: Array<{ table: string; doc: AnyDoc; id: string }> = [];
  const scheduled: Array<{ fnRef: unknown; args: AnyDoc }> = [];
  let nextId = 1;

  const ctx = {
    db: {
      async get(id: unknown) {
        return docs.get(String(id)) ?? null;
      },
      query(table: string) {
        const rows: AnyDoc[] = table === "entitlements" ? entitlements : table === "assets" ? assets : [];
        return {
          withIndex(_name: string, _build: (q: any) => any) {
            return {
              async first() {
                return rows[0] ?? null;
              },
              async collect() {
                return rows;
              },
            };
          },
        };
      },
      async insert(table: string, doc: AnyDoc) {
        const id = `${table}_${nextId++}`;
        inserted.push({ table, doc, id });
        if (table === "assets") assets.push({ _id: id, ...doc });
        docs.set(id, { _id: id, ...doc });
        return id;
      },
      async patch() {
        /* not exercised */
      },
    },
    scheduler: {
      async runAfter(_ms: number, fnRef: unknown, args: AnyDoc) {
        scheduled.push({ fnRef, args });
      },
    },
  };

  return { ctx, inserted, scheduled, assets };
}

describe("selectCinematicFallback", () => {
  it("falls back to the poster still when one exists", () => {
    expect(selectCinematicFallback({ posterUrl: "https://cdn/x.png" })).toEqual({
      kind: "still",
      url: "https://cdn/x.png",
    });
  });

  it("marks failed when there is no poster still", () => {
    expect(selectCinematicFallback({ posterUrl: null })).toEqual({ kind: "failed" });
    expect(selectCinematicFallback({})).toEqual({ kind: "failed" });
    expect(selectCinematicFallback({ posterUrl: "" })).toEqual({ kind: "failed" });
  });
});

describe("reference selection (Req 4.1–4.4)", () => {
  const companion = (id: string, role: string, rank: number): ReferenceCandidate => ({
    assetId: id,
    source: "companion",
    role,
    rank,
    url: `https://cdn/${id}.png`,
  });
  const beat = (id: string, rank: number): ReferenceCandidate => ({
    assetId: id,
    source: "beat",
    rank,
    url: `https://cdn/${id}.png`,
  });

  it("ranks companions by role priority then recency", () => {
    const ranked = rankCompanionReferences([
      companion("rival", "rival", 100),
      companion("ally-old", "ally", 1),
      companion("ally-new", "ally", 9),
      companion("comp", "companion", 5),
    ]);
    // companion first, then allies newest-first, then rival.
    expect(ranked.map((c) => c.assetId)).toEqual(["comp", "ally-new", "ally-old"]);
    // Default cap trims to MAX_COMPANION_REFERENCES (3).
    expect(ranked.length).toBe(3);
  });

  it("picks the terminal beat plus spaced earlier beats, newest-first", () => {
    const beats = [beat("t0", 0), beat("t1", 1), beat("t2", 2), beat("t3", 3), beat("t4", 4)];
    const picked = pickSpacedBeatStills(beats, 3);
    // Terminal (t4) leads; earliest (t0) and a middle beat span the run.
    expect(picked[0]!.assetId).toBe("t4");
    expect(picked).toHaveLength(3);
    expect(picked.map((c) => c.assetId)).toContain("t0");
    // Fewer beats than max → all returned newest-first, no dupes.
    expect(pickSpacedBeatStills([beat("a", 0), beat("b", 1)], 3).map((c) => c.assetId)).toEqual([
      "b",
      "a",
    ]);
  });

  it("orders protagonist + setting first, then companions, then beats", () => {
    const candidates: RawReferenceCandidates = {
      protagonist: { assetId: "pro", source: "protagonist", storageId: "s-pro" },
      setting: { assetId: "set", source: "setting", storageId: "s-set" },
      companions: [companion("c1", "companion", 5)],
      beats: [beat("b1", 1)],
    };
    const { selected, dropped } = selectCinematicReferences({ candidates });
    expect(selected.map((c) => c.source)).toEqual(["protagonist", "setting", "companion", "beat"]);
    expect(dropped).toHaveLength(0);
  });

  it("caps at the reference limit and reports the dropped tail", () => {
    const candidates: RawReferenceCandidates = {
      protagonist: { assetId: "pro", source: "protagonist" },
      setting: { assetId: "set", source: "setting" },
      companions: [
        companion("c1", "companion", 3),
        companion("c2", "companion", 2),
        companion("c3", "companion", 1),
      ],
      beats: [beat("b1", 3), beat("b2", 2), beat("b3", 1)],
    };
    // 2 anchors + 3 companions + 3 beats = 8 candidates; limit 6 → 2 dropped.
    const { selected, dropped } = selectCinematicReferences({ candidates, limit: 6 });
    expect(selected).toHaveLength(6);
    expect(dropped).toHaveLength(2);
    // Protagonist + setting are always retained (highest salience).
    expect(selected.map((c) => c.assetId).slice(0, 2)).toEqual(["pro", "set"]);
    // The dropped tail is the lowest-salience beats.
    expect(dropped.every((c) => c.source === "beat")).toBe(true);
  });
});

describe("queueEndpointCinematic", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-omni-key";
    // Omni is now explicit opt-in (dark by default) — enable it for the tests
    // that exercise the endpoint_cinematic path.
    process.env.OMNI_ENABLED = "1";
    delete process.env.CYOA_DEV_FORCE_PRO_MEDIA;
  });
  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.OMNI_ENABLED;
  });

  it("queues an ending cinematic + schedules the Omni job under endpoint_cinematic + Pro", async () => {
    const { ctx, inserted, scheduled } = makeCtx({ account: endpointCinematicAccount() });
    const result = await (queueEndpointCinematic as any)._handler(ctx, {
      accountId: ACCOUNT_ID,
      saveId: SAVE_ID,
      trigger: "ending",
      endingId: "ending-dusk",
    });

    expect(result.queued).toBe(true);
    const assetInsert = inserted.find((i) => i.table === "assets");
    expect(assetInsert).toBeDefined();
    expect(assetInsert!.doc).toMatchObject({
      accountId: ACCOUNT_ID,
      saveId: SAVE_ID,
      kind: "cinematic",
      provider: "gemini-omni",
      status: "queued",
      entitlementRequired: "pro",
      cinematicTrigger: "ending",
      endingId: "ending-dusk",
      hasAudio: false,
    });
    expect(assetInsert!.doc.provenance).toMatchObject({ provider: "gemini-omni", referenceCount: 2 });

    // Scheduled the Omni job and emitted the requested analytics.
    const job = scheduled.find((s) => String(s.fnRef).includes("runOmniCinematicJob"));
    expect(job).toBeDefined();
    expect(job!.args).toMatchObject({ trigger: "ending", endingId: "ending-dusk" });
    expect(typeof job!.args.beatTimeline).toBe("string");
    const analytics = inserted.find(
      (i) => i.table === "analytics_events" && i.doc.eventName === "cinematic.requested",
    );
    expect(analytics).toBeDefined();
  });

  it("skips (no insert) when the strategy is not endpoint_cinematic", async () => {
    const { ctx, inserted } = makeCtx({ account: legacyAccount() });
    const result = await (queueEndpointCinematic as any)._handler(ctx, {
      accountId: ACCOUNT_ID,
      saveId: SAVE_ID,
      trigger: "ending",
      endingId: "ending-dusk",
    });
    expect(result.queued).toBe(false);
    expect(result.reason).toBe("strategy_per_scene_legacy");
    expect(inserted.find((i) => i.table === "assets")).toBeUndefined();
  });

  it("dedupes against an existing non-failed cinematic for the same (trigger, endingId)", async () => {
    const existing: AnyDoc = {
      _id: "assets_existing",
      saveId: SAVE_ID,
      kind: "cinematic",
      status: "ready",
      cinematicTrigger: "ending",
      endingId: "ending-dusk",
    };
    const { ctx, inserted } = makeCtx({ account: endpointCinematicAccount(), assets: [existing] });
    const result = await (queueEndpointCinematic as any)._handler(ctx, {
      accountId: ACCOUNT_ID,
      saveId: SAVE_ID,
      trigger: "ending",
      endingId: "ending-dusk",
    });
    expect(result.queued).toBe(false);
    expect(result.reason).toBe("already_queued");
    expect(inserted.find((i) => i.table === "assets")).toBeUndefined();
  });

  it("gates on Pro: no active paid entitlement → per_scene_legacy strategy → skip", async () => {
    const { ctx, inserted } = makeCtx({
      account: endpointCinematicAccount(),
      entitlement: { accountId: ACCOUNT_ID, tier: "free", status: "active" },
    });
    const result = await (queueEndpointCinematic as any)._handler(ctx, {
      accountId: ACCOUNT_ID,
      saveId: SAVE_ID,
      trigger: "ending",
      endingId: "ending-dusk",
    });
    // desired endpoint_cinematic without Pro degrades to per_scene_legacy in
    // the resolver, so the cinematic queue skips.
    expect(result.queued).toBe(false);
    expect(inserted.find((i) => i.table === "assets")).toBeUndefined();
  });

  it("opening reschedules itself while turn-1 anchors have not landed (C3)", async () => {
    const anchorlessSave: AnyDoc = { ...saveDoc(), anchorProtagonistAssetId: undefined, anchorSettingAssetId: undefined };
    const { ctx, inserted, scheduled } = makeCtx({ account: endpointCinematicAccount(), save: anchorlessSave });
    const result = await (queueEndpointCinematic as any)._handler(ctx, {
      accountId: ACCOUNT_ID,
      saveId: SAVE_ID,
      trigger: "opening",
      attempt: 0,
    });
    expect(result.queued).toBe(false);
    expect(result.reason).toBe("awaiting_anchors");
    // Rescheduled itself with an incremented attempt; no asset inserted yet.
    const reschedule = scheduled.find((s) => String(s.fnRef).includes("queueEndpointCinematic"));
    expect(reschedule).toBeDefined();
    expect(reschedule!.args).toMatchObject({ trigger: "opening", attempt: 1 });
    expect(inserted.find((i) => i.table === "assets")).toBeUndefined();
  });

  it("queues a CHAPTER cinematic keyed to the current scene (no endingId)", async () => {
    const { ctx, inserted } = makeCtx({ account: endpointCinematicAccount() });
    const result = await (queueEndpointCinematic as any)._handler(ctx, {
      accountId: ACCOUNT_ID,
      saveId: SAVE_ID,
      trigger: "chapter",
    });
    expect(result.queued).toBe(true);
    const assetInsert = inserted.find((i) => i.table === "assets");
    expect(assetInsert!.doc).toMatchObject({
      kind: "cinematic",
      cinematicTrigger: "chapter",
      sceneId: SCENE_ID,
    });
    expect(assetInsert!.doc.endingId).toBeUndefined();
  });

  it("caps chapter cinematics per run (Req 8.2)", async () => {
    const twoChapters: AnyDoc[] = [
      { _id: "cin_a", saveId: SAVE_ID, kind: "cinematic", status: "ready", cinematicTrigger: "chapter", sceneId: "scene_a" },
      { _id: "cin_b", saveId: SAVE_ID, kind: "cinematic", status: "ready", cinematicTrigger: "chapter", sceneId: "scene_b" },
    ];
    const { ctx, inserted } = makeCtx({ account: endpointCinematicAccount(), assets: twoChapters });
    const result = await (queueEndpointCinematic as any)._handler(ctx, {
      accountId: ACCOUNT_ID,
      saveId: SAVE_ID,
      trigger: "chapter",
    });
    expect(result.queued).toBe(false);
    expect(result.reason).toBe("chapter_cap_reached");
    expect(inserted.find((i) => i.table === "assets")).toBeUndefined();
  });

  it("dedupes a chapter re-fire at the same scene", async () => {
    const sameScene: AnyDoc[] = [
      { _id: "cin_here", saveId: SAVE_ID, kind: "cinematic", status: "ready", cinematicTrigger: "chapter", sceneId: SCENE_ID },
    ];
    const { ctx, inserted } = makeCtx({ account: endpointCinematicAccount(), assets: sameScene });
    const result = await (queueEndpointCinematic as any)._handler(ctx, {
      accountId: ACCOUNT_ID,
      saveId: SAVE_ID,
      trigger: "chapter",
    });
    expect(result.queued).toBe(false);
    expect(result.reason).toBe("already_queued");
    expect(inserted.find((i) => i.table === "assets")).toBeUndefined();
  });
});

describe("per-scene video retirement by strategy (Req 1.2)", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.OMNI_ENABLED = "1";
    delete process.env.CYOA_DEV_FORCE_PRO_MEDIA;
  });
  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.OMNI_ENABLED;
  });

  it("skips the per-scene Veo clip under endpoint_cinematic", async () => {
    const { ctx, inserted } = makeCtx({ account: endpointCinematicAccount() });
    const result = await (queueSceneVideo as any)._handler(ctx, {
      accountId: ACCOUNT_ID,
      saveId: SAVE_ID,
      sceneId: SCENE_ID,
      prompt: "a windswept cliff",
    });
    expect(result.queued).toBe(false);
    expect(result.reason).toBe("strategy_endpoint_cinematic");
    expect(inserted.find((i) => i.table === "assets")).toBeUndefined();
  });

  it("still queues the per-scene Veo clip under per_scene_legacy (unchanged)", async () => {
    const { ctx, inserted } = makeCtx({ account: legacyAccount() });
    const result = await (queueSceneVideo as any)._handler(ctx, {
      accountId: ACCOUNT_ID,
      saveId: SAVE_ID,
      sceneId: SCENE_ID,
      prompt: "a windswept cliff",
    });
    expect(result.queued).toBe(true);
    expect(inserted.find((i) => i.table === "assets")!.doc).toMatchObject({ kind: "video" });
  });
});
