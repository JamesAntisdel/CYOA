import { mutationGeneric, queryGeneric } from "convex/server";

import { accountFromDoc, cleanDoc } from "./lib/docs";
import { v } from "convex/values";

import type { AccountRecord } from "./account";
// updateDraft / validateSeed import their pure logic straight from ./creator
// (liveCore only wraps the original create/publish/archive plans).
import {
  updateAuthoredSeedDraft,
  validateCreatorSeedSubmission,
  type AuthoredSeedRecord,
} from "./creator";
import { assertAccountSessionAccess } from "./lib/authz";
import { AppError } from "./lib/errors";
import {
  buildArchiveAuthoredSeedPlan,
  buildCreatorSeedLibraryItems,
  buildCreateAuthoredSeedPlan,
  buildPublishAuthoredSeedPlan,
} from "./liveCore";

const accountId = v.id("accounts");
const seedId = v.id("authored_seeds");
const guestTokenHash = v.optional(v.string());

export const listMine = queryGeneric({
  args: { accountId, guestTokenHash },
  handler: async (ctx, args) => {
    const owner = await ctx.db.get(args.accountId);
    if (!owner) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(owner), args.guestTokenHash);
    return ctx.db
      .query("authored_seeds")
      .withIndex("by_ownerAccountId", (q) => q.eq("ownerAccountId", args.accountId))
      .collect();
  },
});

export const listPublishedMine = queryGeneric({
  args: { accountId, guestTokenHash },
  handler: async (ctx, args) => {
    const owner = await ctx.db.get(args.accountId);
    if (!owner) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(owner), args.guestTokenHash);
    const seeds = await ctx.db
      .query("authored_seeds")
      .withIndex("by_ownerAccountId", (q) => q.eq("ownerAccountId", args.accountId))
      .collect();
    return buildCreatorSeedLibraryItems({ seeds: seeds.map(seedFromDoc) });
  },
});

export const createDraft = mutationGeneric({
  args: {
    accountId,
    guestTokenHash,
    title: v.string(),
    story: v.any(),
  },
  handler: async (ctx, args) => {
    const owner = await ctx.db.get(args.accountId);
    if (!owner) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(owner), args.guestTokenHash);
    const draft = buildCreateAuthoredSeedPlan({
      owner: accountFromDoc(owner) as AccountRecord & { _id: string },
      title: args.title,
      story: args.story,
      now: Date.now(),
    });
    const id = await ctx.db.insert("authored_seeds", cleanDoc(draft));
    return { seedId: id, seed: { ...draft, _id: id } };
  },
});

/**
 * Re-save an existing draft in place instead of inserting a new row per save
 * (the old client behavior orphaned a draft on every "Save draft" press).
 * Ownership/session checks mirror `archive`; only `status: "draft"` seeds are
 * updatable — the pure plan throws `creator_seed_not_draft` otherwise.
 */
export const updateDraft = mutationGeneric({
  args: {
    accountId,
    seedId,
    guestTokenHash,
    title: v.string(),
    story: v.any(),
  },
  handler: async (ctx, args) => {
    const owner = await ctx.db.get(args.accountId);
    if (!owner) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(owner), args.guestTokenHash);
    const seed = await ctx.db.get(args.seedId);
    if (!seed) throw new AppError("creator_seed_not_found");
    const updated = updateAuthoredSeedDraft({
      seed: seedFromDoc(seed),
      owner: accountFromDoc(owner) as AccountRecord & { _id: string },
      title: args.title,
      story: args.story,
      now: Date.now(),
    });
    // seedFromDoc stamps a stringified _id onto the record; strip it so the
    // patch only carries real field updates.
    const patch = { ...updated };
    delete patch._id;
    await ctx.db.patch(args.seedId, cleanDoc(patch));
    return { seedId: args.seedId, seed: { ...updated, _id: args.seedId } };
  },
});

/**
 * Structured pre-flight validation for the creator form. Returns every
 * structural + per-field safety issue as `{ path, message, kind }` (instead
 * of the flattened `creator_seed_invalid` AppError string the mutations
 * throw) so the client can render errors next to the fields they belong to.
 */
export const validateSeed = queryGeneric({
  args: {
    accountId,
    guestTokenHash,
    story: v.any(),
  },
  handler: async (ctx, args) => {
    const owner = await ctx.db.get(args.accountId);
    if (!owner) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(owner), args.guestTokenHash);
    return validateCreatorSeedSubmission({
      story: args.story,
      owner: accountFromDoc(owner) as AccountRecord & { _id: string },
    });
  },
});

export const publish = mutationGeneric({
  args: { accountId, seedId, guestTokenHash },
  handler: async (ctx, args) => {
    const owner = await ctx.db.get(args.accountId);
    if (!owner) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(owner), args.guestTokenHash);
    const seed = await ctx.db.get(args.seedId);
    if (!seed) throw new AppError("creator_seed_not_found");
    const published = buildPublishAuthoredSeedPlan({
      seed: seedFromDoc(seed),
      owner: accountFromDoc(owner) as AccountRecord & { _id: string },
      now: Date.now(),
    });
    await ctx.db.patch(args.seedId, cleanDoc(published));
    return { seedId: args.seedId, seed: { ...published, _id: args.seedId } };
  },
});

export const archive = mutationGeneric({
  args: { accountId, seedId, guestTokenHash },
  handler: async (ctx, args) => {
    const owner = await ctx.db.get(args.accountId);
    if (!owner) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(owner), args.guestTokenHash);
    const seed = await ctx.db.get(args.seedId);
    if (!seed) throw new AppError("creator_seed_not_found");
    const archived = buildArchiveAuthoredSeedPlan({
      seed: seedFromDoc(seed),
      owner: accountFromDoc(owner) as AccountRecord & { _id: string },
      now: Date.now(),
    });
    await ctx.db.patch(args.seedId, cleanDoc(archived));
    return { seedId: args.seedId, seed: { ...archived, _id: args.seedId } };
  },
});


function seedFromDoc(doc: Record<string, unknown>): AuthoredSeedRecord {
  return { ...doc, _id: String(doc._id) } as AuthoredSeedRecord;
}

