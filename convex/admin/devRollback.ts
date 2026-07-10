// Dev-only repair mutation. Rolls a save back to its most recent
// COMPLETE scene when the current scene is stuck in `streamStatus:
// "failed"` from an LLM payload that didn't parse. The fail-loud
// behavior in `completeSceneStream` intentionally keeps these scenes
// around so the client can surface them and retry — but when the LLM
// truncated mid-JSON (the old 4096-token cap issue) the retry chain
// can wedge if the underlying state has already advanced.
//
// This bypasses the engine deliberately and patches the save
// + scene records directly. NOT a player-facing surface.
//
// Usage from the convex CLI (inside the convex container):
//   pnpm exec convex run admin/devRollback:rollbackFailedScene '{"saveId":"<id>"}'
//
// Or via HTTP:
//   curl -X POST http://localhost:3210/api/mutation \
//     -H "content-type: application/json" \
//     -d '{"path":"admin/devRollback:rollbackFailedScene","args":{"saveId":"<id>"},"format":"json"}'

import { v } from "convex/values";
import { mutationGeneric } from "convex/server";

import { AppError } from "../lib/errors";

const saveIdValidator = v.id("saves");

type SceneDoc = {
  _id: string;
  saveId: string;
  nodeId: string;
  turnNumber: number;
  streamStatus: "pending" | "streaming" | "complete" | "failed" | "blocked";
  prose?: string;
};

/**
 * Inspect a save's recent scenes — read-only diagnostic. Returns the last
 * N scenes with their turn number + streamStatus + first prose line so
 * we can decide how far to roll back.
 */
export const inspectSaveScenes = mutationGeneric({
  args: { saveId: saveIdValidator, limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const saveDoc = await ctx.db.get(args.saveId);
    if (!saveDoc) throw new AppError("save_not_found");
    const currentSceneId = (saveDoc as { currentSceneId?: string }).currentSceneId;
    const currentTurn = (saveDoc as { turnNumber?: number }).turnNumber;
    const activeTurn = (saveDoc as { activeTurnRequestId?: string }).activeTurnRequestId;
    const scenes = (await ctx.db
      .query("scenes")
      .withIndex("by_save_turn", (q: any) => q.eq("saveId", args.saveId))
      .order("desc")
      .take(args.limit ?? 10)) as Array<{
      _id: string;
      turnNumber: number;
      streamStatus: string;
      prose?: string;
    }>;
    return {
      saveId: args.saveId,
      currentSceneId,
      currentTurnNumber: currentTurn,
      activeTurnRequestId: activeTurn,
      scenes: scenes.map((s) => ({
        sceneId: s._id,
        turnNumber: s.turnNumber,
        streamStatus: s.streamStatus,
        proseHead: typeof s.prose === "string" ? s.prose.slice(0, 80) : "",
        isCurrent: s._id === currentSceneId,
      })),
    };
  },
});

/**
 * Roll back to a SPECIFIC turn number. Deletes every scene + turn_history
 * row + asset row for turns AFTER the target turn, then patches the save
 * cursor to the target scene. Pass `targetTurn: 0` to fully reset to the
 * opening scene.
 */
export const rollbackToTurn = mutationGeneric({
  args: { saveId: saveIdValidator, targetTurn: v.number() },
  handler: async (ctx, args) => {
    const saveDoc = await ctx.db.get(args.saveId);
    if (!saveDoc) throw new AppError("save_not_found");

    // Find the target scene by exact turn number.
    const targetScene = (await ctx.db
      .query("scenes")
      .withIndex("by_save_turn", (q: any) =>
        q.eq("saveId", args.saveId).eq("turnNumber", args.targetTurn),
      )
      .first()) as { _id: string; nodeId: string; turnNumber: number } | null;

    if (!targetScene) throw new AppError("target_turn_not_found");

    // Find every scene AFTER the target.
    const laterScenes = (await ctx.db
      .query("scenes")
      .withIndex("by_save_turn", (q: any) => q.eq("saveId", args.saveId))
      .filter((q: any) => q.gt(q.field("turnNumber"), args.targetTurn))
      .collect()) as Array<{ _id: string; turnNumber: number }>;

    let deletedScenes = 0;
    let deletedHistory = 0;
    let deletedAssets = 0;
    for (const sc of laterScenes) {
      const turnRows = await ctx.db
        .query("turn_history")
        .withIndex("by_save_turn", (q: any) => q.eq("saveId", args.saveId))
        .filter((q: any) => q.eq(q.field("turnNumber"), sc.turnNumber))
        .collect();
      for (const row of turnRows) {
        await ctx.db.delete(row._id);
        deletedHistory += 1;
      }
      const sceneAssets = await ctx.db
        .query("assets")
        .withIndex("by_scene", (q: any) => q.eq("sceneId", sc._id))
        .collect();
      for (const asset of sceneAssets) {
        await ctx.db.delete(asset._id);
        deletedAssets += 1;
      }
      await ctx.db.delete(sc._id as any);
      deletedScenes += 1;
    }

    await ctx.db.patch(args.saveId, {
      currentSceneId: targetScene._id as any,
      currentNodeId: targetScene.nodeId,
      turnNumber: targetScene.turnNumber,
      activeTurnRequestId: undefined,
      updatedAt: Date.now(),
    });

    return {
      ok: true as const,
      rolledBackTo: {
        sceneId: targetScene._id,
        nodeId: targetScene.nodeId,
        turnNumber: targetScene.turnNumber,
      },
      deleted: { scenes: deletedScenes, history: deletedHistory, assets: deletedAssets },
    };
  },
});

/** Read-only: full prose of the save's current scene, plus the
 *  visualDescription and the proposal that produced it. Use to verify the
 *  LLM is writing fresh content vs regurgitating the premise. */
export const inspectCurrentScene = mutationGeneric({
  args: { saveId: saveIdValidator },
  handler: async (ctx, args) => {
    const saveDoc = await ctx.db.get(args.saveId);
    if (!saveDoc) throw new AppError("save_not_found");
    const sid = (saveDoc as { currentSceneId?: string }).currentSceneId;
    if (!sid) return { ok: false as const, reason: "no_current_scene" };
    const scene = (await ctx.db.get(sid as any)) as
      | {
          _id: string;
          turnNumber: number;
          streamStatus: string;
          prose?: string;
          proposal?: { prose?: string; visualDescription?: string; choices?: Array<{ label?: string }> };
        }
      | null;
    if (!scene) return { ok: false as const, reason: "scene_missing" };
    return {
      ok: true as const,
      turnNumber: scene.turnNumber,
      streamStatus: scene.streamStatus,
      proseLen: scene.prose?.length ?? 0,
      proseFull: scene.prose ?? "",
      proposalProseFull: scene.proposal?.prose ?? "",
      visualDescription: scene.proposal?.visualDescription ?? "",
      choiceLabels: scene.proposal?.choices?.map((c) => c.label ?? "") ?? [],
    };
  },
});

export const rollbackFailedScene = mutationGeneric({
  args: { saveId: saveIdValidator },
  handler: async (ctx, args) => {
    const saveDoc = await ctx.db.get(args.saveId);
    if (!saveDoc) throw new AppError("save_not_found");

    const currentSceneId = (saveDoc as { currentSceneId?: string }).currentSceneId;
    if (!currentSceneId) {
      return { ok: true as const, reason: "no_current_scene", action: "noop" };
    }

    const currentScene = (await ctx.db.get(currentSceneId as any)) as SceneDoc | null;
    if (!currentScene) {
      return { ok: true as const, reason: "current_scene_missing", action: "clear_active_turn" };
    }

    // Only roll back from a wedged scene. If the current scene is
    // healthy, just clearing activeTurnRequestId is sufficient.
    const wedged =
      currentScene.streamStatus === "failed" ||
      currentScene.streamStatus === "pending" ||
      currentScene.streamStatus === "streaming";

    if (!wedged) {
      await ctx.db.patch(args.saveId, { activeTurnRequestId: undefined, updatedAt: Date.now() });
      return { ok: true as const, reason: "current_scene_healthy", action: "clear_active_turn" };
    }

    // Find the most recent COMPLETE scene before this one. Walk
    // turn_history backwards via the by_save_turn index.
    const priorScenes = (await ctx.db
      .query("scenes")
      .withIndex("by_save_turn", (q: any) => q.eq("saveId", args.saveId))
      .order("desc")
      .take(20)) as SceneDoc[];

    const priorComplete = priorScenes.find(
      (s) =>
        s._id !== currentScene._id &&
        (s.streamStatus === "complete" || s.streamStatus === "blocked"),
    );

    if (!priorComplete) {
      // No good fallback. Clear the wedge but leave the save where it is.
      await ctx.db.patch(args.saveId, { activeTurnRequestId: undefined, updatedAt: Date.now() });
      return {
        ok: true as const,
        reason: "no_prior_complete_scene",
        action: "clear_active_turn_only",
      };
    }

    // Delete the wedged scene + its turn_history row + any assets
    // queued for it so the next render starts clean.
    const turnRows = await ctx.db
      .query("turn_history")
      .withIndex("by_save_turn", (q: any) => q.eq("saveId", args.saveId))
      .filter((q: any) => q.eq(q.field("turnNumber"), currentScene.turnNumber))
      .collect();
    for (const row of turnRows) {
      await ctx.db.delete(row._id);
    }

    const sceneAssets = await ctx.db
      .query("assets")
      .withIndex("by_scene", (q: any) => q.eq("sceneId", currentScene._id))
      .collect();
    for (const asset of sceneAssets) {
      await ctx.db.delete(asset._id);
    }

    await ctx.db.delete(currentScene._id as any);

    // Roll the save cursor back to the prior complete scene.
    await ctx.db.patch(args.saveId, {
      currentSceneId: priorComplete._id as any,
      currentNodeId: priorComplete.nodeId,
      turnNumber: priorComplete.turnNumber,
      activeTurnRequestId: undefined,
      updatedAt: Date.now(),
    });

    return {
      ok: true as const,
      reason: "rolled_back_to_prior_complete",
      action: "deleted_failed_scene",
      rolledBackTo: {
        sceneId: priorComplete._id,
        nodeId: priorComplete.nodeId,
        turnNumber: priorComplete.turnNumber,
      },
    };
  },
});
