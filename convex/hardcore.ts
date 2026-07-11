// story-engagement Wave 3 (R15) — Hardcore mode server hooks.
//
// Hardcore raises the stakes at the engine layer (clock max −25%, every skill
// check one band harder — both wired in game.ts via the pure engine helpers)
// and makes death PERMANENT: a hardcore run that reaches a `death` terminal is
// purged from existence ("the tome closes forever").
//
// The purge is SCHEDULED, not inline. The terminal mutation must return the
// death scene so the client can render the hardcore death variant; only after
// that does the scheduled purge wipe the run. Deleting the save + scenes +
// turn_history + asset ROWS for this one save is enough — the asset FILES are
// reclaimed by the existing daily `media/mediaCleanup:sweepOrphanStorage`
// orphan sweep (orphan-safe). The unlocked ending row is intentionally KEPT so
// the trophy crypt still shows the hardcore death the reader earned.
import { internalMutationGeneric } from "convex/server";
import type { GenericMutationCtx } from "convex/server";
import { v } from "convex/values";

type MutationCtx = GenericMutationCtx<any>;

export const HARDCORE_PURGE_DELAY_MS = 6_000;

export const purgeHardcoreSave = internalMutationGeneric({
  args: { saveId: v.string() },
  handler: async (ctx, args) => {
    const saveId = args.saveId as any;
    const save = await ctx.db.get(saveId);
    // Already gone, or (defensively) not a hardcore save — never purge a
    // normal "story" run even if this were somehow scheduled against one.
    if (!save || (save as any).mode !== "hardcore") return;
    await deleteByIndex(ctx, "scenes", "by_save_turn", "saveId", saveId);
    await deleteByIndex(ctx, "turn_history", "by_save_turn", "saveId", saveId);
    await deleteByIndex(ctx, "assets", "by_saveId", "saveId", saveId);
    await ctx.db.delete(saveId);
  },
});

// Small local mirror of the lifecycle/account cascade helper (kept private per
// file, matching the existing duplication in convex/lifecycle.ts + accountFunctions.ts).
async function deleteByIndex(
  ctx: MutationCtx,
  table: string,
  index: string,
  field: string,
  value: unknown,
): Promise<number> {
  const docs = await ctx.db
    .query(table as any)
    .withIndex(index as any, (q: any) => q.eq(field, value))
    .collect();
  for (const doc of docs) {
    await ctx.db.delete(doc._id);
  }
  return docs.length;
}
