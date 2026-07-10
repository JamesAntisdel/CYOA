// Dev media reset (one-off) + durable orphan cleanup helpers.
//
// The `assets` table's blobs live in Convex file storage (the `_storage`
// system table). Deleting an asset ROW does NOT delete its stored FILE, so
// every abandoned test save / guest purge / rewind has leaked blobs on disk.
// These internal mutations are the sanctioned way to reclaim that space —
// deleting files on disk directly would corrupt Convex's storage index.
//
// Invoked from the CLI in dev:
//   convex run media/mediaCleanup:wipeMediaBatch '{"limit":100}'   (loop until done)
//   convex run media/mediaCleanup:clearAllAnchors '{}'

import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";

import { rewriteToPublicOrigin } from "./imagenClient";

/**
 * Delete a batch of stored files + a batch of asset rows. Idempotent and
 * re-runnable: each call removes the next `limit` of each until `done`. Also a
 * belt-and-braces sweep — deletes EVERY `_storage` file, so orphaned blobs with
 * no asset row go too (the whole point of the reset).
 */
export const wipeMediaBatch = internalMutationGeneric({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;

    // Stored file blobs (images, video, audio, cinematics) — the bulk on disk.
    const files = await ctx.db.system.query("_storage").take(limit);
    for (const file of files) {
      await ctx.storage.delete(file._id);
    }

    // Asset rows (scene stills, anchors, NPC portraits, TTS, cinematics).
    const assets = await ctx.db.query("assets").take(limit);
    for (const asset of assets) {
      await ctx.db.delete(asset._id);
    }

    const done = files.length < limit && assets.length < limit;
    return { deletedFiles: files.length, deletedAssets: assets.length, done };
  },
});

/**
 * Clear the per-save anchor pointers (protagonist/setting) so saves whose anchor
 * assets were just wiped regenerate fresh media on the next turn instead of
 * skipping anchor generation against a now-dangling id. Dev has a bounded number
 * of saves, so a single collect is fine.
 */
export const clearAllAnchors = internalMutationGeneric({
  args: {},
  handler: async (ctx) => {
    const saves = await ctx.db.query("saves").collect();
    let cleared = 0;
    for (const save of saves) {
      const s = save as { anchorProtagonistAssetId?: unknown; anchorSettingAssetId?: unknown };
      if (s.anchorProtagonistAssetId || s.anchorSettingAssetId) {
        await ctx.db.patch(save._id, {
          anchorProtagonistAssetId: undefined,
          anchorSettingAssetId: undefined,
        });
        cleared += 1;
      }
    }
    return { savesCleared: cleared, savesScanned: saves.length };
  },
});

/**
 * Durable leak fix (Requirement: media storage must not grow unbounded).
 *
 * Every asset deletion path — the guest-purge cron, save rewind, tale revoke —
 * deletes asset ROWS but not their stored FILES, orphaning blobs. Rather than
 * thread a `ctx.storage.delete` into each path (and risk missing one), this
 * sweep reconciles from the storage side: it collects every URL still
 * referenced by a live `asset` row or a published-tale lead cinematic, then
 * deletes any `_storage` file whose public URL is in NO live reference.
 *
 * Wired to a daily cron (convex/crons.ts). Bounded per run by `maxDeletes` so a
 * large backlog drains over several days without a runaway mutation. Safe: a
 * file is only deleted when nothing references its URL.
 */
export const sweepOrphanStorage = internalMutationGeneric({
  args: { maxDeletes: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const maxDeletes = args.maxDeletes ?? 500;

    // Every URL still in use: live asset rows + denormalized tale cinematics.
    const referenced = new Set<string>();
    for (const asset of await ctx.db.query("assets").collect()) {
      const url = (asset as { url?: string }).url;
      if (typeof url === "string" && url.length > 0) referenced.add(url);
    }
    for (const tale of await ctx.db.query("published_tales").collect()) {
      const lead = (tale as { leadCinematic?: { url?: string } }).leadCinematic;
      if (lead?.url) referenced.add(lead.url);
    }

    let scanned = 0;
    let deleted = 0;
    let cursor: string | null = null;
    for (;;) {
      const page = await ctx.db.system.query("_storage").paginate({ cursor, numItems: 200 });
      for (const file of page.page) {
        scanned += 1;
        const raw = await ctx.storage.getUrl(file._id);
        if (!raw) continue;
        if (!referenced.has(rewriteToPublicOrigin(raw))) {
          await ctx.storage.delete(file._id);
          deleted += 1;
          if (deleted >= maxDeletes) {
            return { scanned, deleted, referenced: referenced.size, done: false };
          }
        }
      }
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    if (deleted > 0) {
      console.log(`[mediaCleanup] sweepOrphanStorage deleted=${deleted} scanned=${scanned} referenced=${referenced.size}`);
    }
    return { scanned, deleted, referenced: referenced.size, done: true };
  },
});
