// Reader-facing "Illuminate this page" surface (Iris proposal, product-readiness
// review 2026-07-12). The consumer entry into the already-shipped spark ledger:
// a reader taps a candle on a resolved scene and pays sparks to ATTACH cosmetic
// media (a still, or an endpoint cinematic) to that page.
//
// Product principle 7 ("pay for joy, not entry"): this is COSMETIC-ONLY. It may
// only decorate an ALREADY-RESOLVED scene — it can never influence story/choice
// generation, and the free text+still read path always works without it. The
// cosmetic guard below (assert the scene is `streamStatus === "complete"`) is
// the load-bearing enforcement of that principle.
//
// Design shape (house rules): a PUBLIC mutation `requestIllumination` that
//   1. authorizes the caller owns the save (loadAndAuthorizeAccount + assertCanAccessSave),
//   2. asserts the target scene is resolved and belongs to that save,
//   3. dedupes — a scene that already carries non-failed media of that kind is a
//      no-op ("already illuminated"), so a second tap never double-charges,
//   4. inserts the queued asset row (tagged so it attaches to the scene) and
//      charges sparks via `assertAndReserveSpark`, keyed `illum:<sceneId>:<kind>`
//      and LINKED to the asset id — so the existing mark-failed refund path
//      (`markFailed` / `_markCinematicFailed` → `refundSpark(assetId)`) reverses
//      the debit on a render failure with zero new plumbing,
//   5. schedules the existing render action directly (`runImagenJob` /
//      `runOmniCinematicJob`) — NOT the queue mutations, which Pro-gate and
//      charge again; the reader here may be a free-tier account paying sparks.
//
// `CYOA_DEV_FORCE_PRO_MEDIA=1` bypasses billing: the request is still recorded
// (asset inserted + render scheduled) but no spark is charged.
//
// Tolerant + idempotent: a second tap is a no-op; a scheduler hiccup never
// blocks the reader (text is always the contract). Never throws into the read
// loop except for the ownership / cosmetic guards, which are deliberate client
// errors (like `save_forbidden`).

import { v } from "convex/values";
import { mutationGeneric, queryGeneric } from "convex/server";

import { AppError } from "../lib/errors";
import { loadAndAuthorizeAccount } from "../lib/authz";
import { assertCanAccessSave } from "../saves";
import { hashPrompt } from "../assets";
import { assertAndReserveSpark, ledgerSumForAccount } from "../billing/mediaCredits";
import { MEDIA_SPARK_COSTS, type MediaSparkKind } from "../billing/mediaCosts";
import { devForceProMedia } from "./proMediaGate";
import { buildBeatTimeline } from "./cinematics";

const accountId = v.id("accounts");
const saveId = v.id("saves");

/** Reader-facing illumination kinds → the priced media product they draw on. */
const KIND_TO_SPARK: Record<"still" | "cinematic", MediaSparkKind> = {
  still: "scene_still",
  cinematic: "omni_cinematic",
};

/** The asset `kind` a given illumination produces (for the dedupe scan). */
const KIND_TO_ASSET_KIND: Record<"still" | "cinematic", "image" | "cinematic"> = {
  still: "image",
  cinematic: "cinematic",
};

type SceneDoc = {
  _id: string;
  saveId?: string;
  nodeId?: string;
  prose?: string;
  streamStatus?: string;
};

type AssetLite = { _id: string; kind?: string; status?: string };

/** Cosmetic guard: a scene may be illuminated only once its prose has fully
 * resolved. `pending` / `streaming` scenes are still being written; illuminating
 * them would let reader spend touch generation, which principle 7 forbids. A
 * `blocked` scene has no imagery to attach; `failed` will be retried. Only a
 * `complete` scene is a stable, already-resolved page. */
function isResolvedScene(scene: SceneDoc | null): scene is SceneDoc {
  return !!scene && scene.streamStatus === "complete";
}

/** Short, reference-less render prompt from the scene's own resolved prose.
 * Cosmetic-only: the prose already exists, so this reads it, never shapes it. */
function illuminationPrompt(scene: SceneDoc): string {
  const prose = (scene.prose ?? "").trim();
  return (prose.slice(0, 480) || "an illustrated scene").trim();
}

export const requestIllumination = mutationGeneric({
  args: {
    accountId,
    saveId,
    sceneId: v.id("scenes"),
    kind: v.union(v.literal("still"), v.literal("cinematic")),
    guestTokenHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Ownership. loadAndAuthorizeAccount throws on a bad session; assertCanAccessSave
    //    throws `save_forbidden` when the save isn't this account's.
    await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);
    const saveDoc = (await ctx.db.get(args.saveId)) as
      | (Record<string, unknown> & { accountId?: string })
      | null;
    if (!saveDoc) throw new AppError("save_not_found");
    assertCanAccessSave(args.accountId, saveDoc as any);

    // 2. Cosmetic guard — the scene must be resolved AND belong to this save.
    const scene = (await ctx.db.get(args.sceneId)) as SceneDoc | null;
    if (!scene) throw new AppError("illumination_scene_not_found");
    if (scene.saveId && scene.saveId !== args.saveId) {
      throw new AppError("illumination_scene_mismatch");
    }
    if (!isResolvedScene(scene)) {
      // The cosmetic-only invariant: never attach media to an unresolved page.
      throw new AppError("illumination_scene_unresolved");
    }

    const assetKind = KIND_TO_ASSET_KIND[args.kind];
    const sparkKind = KIND_TO_SPARK[args.kind];
    const costSparks = MEDIA_SPARK_COSTS[sparkKind];

    // 3. Idempotent dedupe — a non-failed asset of this kind already on the scene
    //    means the page is (being) illuminated; a second tap is a clean no-op.
    const existing = (await ctx.db
      .query("assets")
      .withIndex("by_scene", (q: any) => q.eq("sceneId", args.sceneId))
      .collect()) as AssetLite[];
    const present = existing.find(
      (a) => a.kind === assetKind && a.status !== "failed",
    );
    if (present) {
      return {
        status: "illuminated" as const,
        alreadyPresent: true,
        kind: args.kind,
        assetId: present._id,
        sparksCharged: 0,
      };
    }

    // 4. Insert the queued asset FIRST so the spend can be linked to its id — the
    //    existing mark-failed path (`markFailed` / `_markCinematicFailed`) then
    //    refunds via `refundSpark(assetId)` with no new refund plumbing here.
    const now = Date.now();
    const promptText = illuminationPrompt(scene);
    const promptHash = hashPrompt(promptText);
    const alt =
      args.kind === "cinematic" ? "Illuminated scene cinematic" : "Illuminated scene";

    let assetId: string;
    if (args.kind === "cinematic") {
      assetId = (await ctx.db.insert("assets", {
        accountId: args.accountId,
        saveId: args.saveId,
        sceneId: args.sceneId,
        ...(scene.nodeId ? { nodeId: scene.nodeId } : {}),
        kind: "cinematic" as const,
        provider: "gemini-omni" as const,
        url: "",
        status: "queued" as const,
        entitlementRequired: "pro" as const,
        cinematicTrigger: "chapter" as const,
        hasAudio: false,
        promptHash,
        provenance: {
          provider: "gemini-omni",
          promptHash,
          promptRedacted: true,
          source: "reader_illumination",
          trigger: "chapter",
        },
        safety: { action: "allow", categories: [], reason: "" },
        alt,
        tags: ["illumination", "illum:cinematic"],
        createdAt: now,
        updatedAt: now,
      })) as unknown as string;
    } else {
      assetId = (await ctx.db.insert("assets", {
        accountId: args.accountId,
        saveId: args.saveId,
        sceneId: args.sceneId,
        ...(scene.nodeId ? { nodeId: scene.nodeId } : {}),
        kind: "image" as const,
        provider: "vertex-imagen" as const,
        url: "",
        status: "queued" as const,
        entitlementRequired: "pro" as const,
        promptHash,
        provenance: {
          provider: "vertex-imagen",
          model: process.env.GEMINI_IMAGE_MODEL ?? "imagen-4.0-fast-generate-001",
          promptHash,
          promptRedacted: true,
          source: "reader_illumination",
        },
        safety: { action: "allow", categories: [], reason: "" },
        alt,
        tags: ["illumination", "illum:still"],
        createdAt: now,
        updatedAt: now,
      })) as unknown as string;
    }

    // 5. Charge sparks — idempotent on `illum:<sceneId>:<kind>` (belt-and-braces
    //    with the dedupe above), linked to `assetId` for the refund path. In dev
    //    (CYOA_DEV_FORCE_PRO_MEDIA) billing is bypassed: record the request, skip
    //    the charge. On an exhausted balance we drop the queued asset and report
    //    it (the free text+still read is untouched — cosmetic never hard-fails).
    let sparksCharged = 0;
    let balanceAfter: number | undefined;
    if (!devForceProMedia()) {
      try {
        const reserved = await assertAndReserveSpark(
          ctx,
          args.accountId,
          costSparks,
          `illum:${args.sceneId}:${args.kind}`,
          assetId,
        );
        sparksCharged = reserved.sparks;
        balanceAfter = reserved.balanceAfter;
      } catch (err) {
        if (err instanceof AppError && err.code === "insufficient_sparks") {
          await ctx.db.delete(assetId as any);
          return {
            status: "insufficient_sparks" as const,
            kind: args.kind,
            costSparks,
            balance: await ledgerSumForAccount(ctx, args.accountId),
            sparksCharged: 0,
          };
        }
        throw err;
      }
    }

    // 6. Schedule the existing render action directly (bypasses the queue
    //    mutations' Pro-gate + second charge). Best-effort: a scheduling hiccup
    //    leaves the asset queued rather than crashing the tap. The render's own
    //    mark-failed path handles refunds.
    try {
      if (args.kind === "cinematic") {
        const beatTimeline = await buildBeatTimeline(ctx, {
          saveId: args.saveId,
          accountId: args.accountId,
          ...(typeof saveDoc.storyId === "string" ? { storyId: saveDoc.storyId } : {}),
          ...(typeof saveDoc.seedTitle === "string" ? { seedTitle: saveDoc.seedTitle } : {}),
          ...(typeof saveDoc.storySummary === "string"
            ? { storySummary: saveDoc.storySummary }
            : {}),
          currentSceneId: args.sceneId,
        });
        const referenceAssetIds = {
          ...(typeof saveDoc.anchorProtagonistAssetId === "string"
            ? { protagonist: saveDoc.anchorProtagonistAssetId }
            : {}),
          ...(typeof saveDoc.anchorSettingAssetId === "string"
            ? { setting: saveDoc.anchorSettingAssetId }
            : {}),
        };
        await ctx.scheduler.runAfter(
          0,
          ("media/cinematics:runOmniCinematicJob" as unknown) as any,
          {
            assetId,
            accountId: args.accountId,
            saveId: args.saveId,
            trigger: "chapter" as const,
            beatTimeline,
            ...(referenceAssetIds.protagonist || referenceAssetIds.setting
              ? { referenceAssetIds }
              : {}),
          },
        );
      } else {
        await ctx.scheduler.runAfter(
          0,
          ("media/sceneMedia:runImagenJob" as unknown) as any,
          {
            assetId,
            prompt: promptText,
            accountId: args.accountId,
            saveId: args.saveId,
            sceneId: args.sceneId,
            ...(scene.nodeId ? { nodeId: scene.nodeId } : {}),
            alt,
            // Illumination is a single cosmetic still — never chain a per-scene
            // Veo clip off the back of it.
            videoAllowed: false,
          },
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "illumination_schedule_failed";
      console.warn(
        `[illuminate] render schedule failed asset=${assetId} kind=${args.kind} error=${message}`,
      );
    }

    return {
      status: "queued" as const,
      kind: args.kind,
      assetId,
      sparksCharged,
      ...(balanceAfter === undefined ? {} : { balanceAfter }),
      costSparks,
    };
  },
});

// Reader-facing spark balance for the illumination sheet ("N sparks · balance
// M"). A pure READ — `ledgerSumForAccount` sums the append-only ledger without
// the mirror write `balanceForAccount` does (a query can't patch). Authorized
// the same as every other reader surface.
export const getSparkBalance = queryGeneric({
  args: {
    accountId,
    guestTokenHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);
    const balance = await ledgerSumForAccount(ctx, args.accountId);
    return { balance };
  },
});

// One-round-trip state for the IlluminateButton + sheet: resolves the save's
// CURRENT scene db id (the client only knows the engine nodeId), reports whether
// that page is resolved (illuminable), whether media of each kind is already
// attached (button reads "illuminated" and no-ops), the spark balance, and the
// per-kind costs. The button feeds `sceneId` straight back into
// `requestIllumination`. Read-only + authorized like every reader surface.
export const getReaderIlluminationState = queryGeneric({
  args: {
    accountId,
    saveId,
    guestTokenHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await loadAndAuthorizeAccount(ctx, args.accountId, args.guestTokenHash);
    const saveDoc = (await ctx.db.get(args.saveId)) as
      | (Record<string, unknown> & { accountId?: string; currentSceneId?: string })
      | null;
    if (!saveDoc) throw new AppError("save_not_found");
    assertCanAccessSave(args.accountId, saveDoc as any);

    const balance = await ledgerSumForAccount(ctx, args.accountId);
    const costs = {
      still: MEDIA_SPARK_COSTS[KIND_TO_SPARK.still],
      cinematic: MEDIA_SPARK_COSTS[KIND_TO_SPARK.cinematic],
    };

    const sceneId =
      typeof saveDoc.currentSceneId === "string" ? saveDoc.currentSceneId : null;
    if (!sceneId) {
      return {
        sceneId: null,
        resolved: false,
        balance,
        costs,
        still: { present: false },
        cinematic: { present: false },
      };
    }

    const scene = (await ctx.db.get(sceneId as any)) as SceneDoc | null;
    const resolved = isResolvedScene(scene);
    const assets = (await ctx.db
      .query("assets")
      .withIndex("by_scene", (q: any) => q.eq("sceneId", sceneId))
      .collect()) as Array<AssetLite & { url?: string }>;
    const pick = (assetKind: "image" | "cinematic") => {
      const rows = assets.filter((a) => a.kind === assetKind && a.status !== "failed");
      const ready = rows.find((a) => a.status === "ready");
      const any = ready ?? rows[0];
      if (!any) return { present: false } as const;
      return {
        present: true,
        status: any.status ?? "queued",
        ...(typeof any.url === "string" && any.url.length > 0 ? { url: any.url } : {}),
      };
    };

    return {
      sceneId,
      resolved,
      balance,
      costs,
      still: pick("image"),
      cinematic: pick("cinematic"),
    };
  },
});
