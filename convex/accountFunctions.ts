import { mutationGeneric, queryGeneric } from "convex/server";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { v } from "convex/values";

import {
  buildAccountExport,
  createAccountDeletionSummary,
  type AccountDeletionSummary,
  type AccountRecord,
} from "./account";
import type { EntitlementRecord } from "./billing/entitlements";
import { assertAccountSessionAccess } from "./lib/authz";
import { AppError } from "./lib/errors";
import {
  buildAccountProfile,
  buildClaimGuestAccountUpdate,
  buildDefaultEntitlement,
  buildMatureContentAccountUpdate,
} from "./liveCore";

const accountId = v.id("accounts");
const guestTokenHash = v.optional(v.string());

type QueryCtx = GenericQueryCtx<any>;
type MutationCtx = GenericMutationCtx<any>;

export const getProfile = queryGeneric({
  args: { accountId, guestTokenHash },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(account), args.guestTokenHash);
    const entitlement = await ctx.db
      .query("entitlements")
      .withIndex("by_accountId", (q) => q.eq("accountId", args.accountId))
      .first();
    return buildAccountProfile({
      account: accountFromDoc(account),
      entitlement: entitlement ?? buildDefaultEntitlement(args.accountId, account.lastActiveAt),
    });
  },
});

export const exportAccount = queryGeneric({
  args: { accountId, guestTokenHash },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(account), args.guestTokenHash);
    return buildAccountExportBundle(ctx, args.accountId, accountFromDoc(account));
  },
});

export const claimGuest = mutationGeneric({
  args: {
    accountId,
    guestTokenHash,
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(account), args.guestTokenHash);
    const plan = buildClaimGuestAccountUpdate({
      guestAccount: accountFromDoc(account) as AccountRecord & { _id: string },
      userId: args.userId,
      now: Date.now(),
    });
    await ctx.db.patch(args.accountId, cleanDoc(plan.updates));
    return { accountId: args.accountId, userId: plan.userId };
  },
});

export const deleteAccount = mutationGeneric({
  args: {
    accountId,
    guestTokenHash,
    confirm: v.literal("DELETE"),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(account), args.guestTokenHash);

    const now = Date.now();
    const summary = createAccountDeletionSummary(args.accountId);

    const saves = await ctx.db
      .query("saves")
      .withIndex("by_accountId", (q) => q.eq("accountId", args.accountId))
      .collect();
    for (const save of saves) {
      summary.scenesDeleted += await deleteByIndex(ctx, "scenes", "by_save_turn", "saveId", save._id);
      summary.turnHistoryDeleted += await deleteByIndex(ctx, "turn_history", "by_save_turn", "saveId", save._id);
      await ctx.db.delete(save._id);
      summary.savesDeleted += 1;
    }

    summary.endingsDeleted += await deleteByIndex(ctx, "endings_unlocked", "by_account_story", "accountId", args.accountId);
    summary.entitlementsDeleted += await deleteByIndex(ctx, "entitlements", "by_accountId", "accountId", args.accountId);
    summary.usageMetersDeleted += await deleteByIndex(ctx, "usage_meters", "by_account_period", "accountId", args.accountId);
    summary.dailyCountersDeleted += await deleteByIndex(ctx, "daily_turn_counter", "by_account_day", "accountId", args.accountId);
    summary.analyticsDeleted += await deleteByIndex(ctx, "analytics_events", "by_accountId", "accountId", args.accountId);
    summary.assetsDeleted += await deleteByIndex(ctx, "assets", "by_accountId", "accountId", args.accountId);
    summary.taleReadsDeleted += await deleteByIndex(ctx, "tale_reads", "by_accountId", "accountId", args.accountId);
    summary.taleForksDeleted += await deleteByIndex(ctx, "tale_forks", "by_accountId", "accountId", args.accountId);

    const authoredSeeds = await ctx.db
      .query("authored_seeds")
      .withIndex("by_ownerAccountId", (q) => q.eq("ownerAccountId", args.accountId))
      .collect();
    for (const seed of authoredSeeds) {
      await ctx.db.patch(seed._id, { status: "archived", updatedAt: now });
      summary.authoredSeedsArchived += 1;
    }

    const publishedTales = await ctx.db
      .query("published_tales")
      .withIndex("by_ownerAccountId", (q) => q.eq("ownerAccountId", args.accountId))
      .collect();
    for (const tale of publishedTales) {
      await ctx.db.patch(tale._id, { accessRevokedAt: now, updatedAt: now });
      summary.publishedTalesRevoked += 1;
    }

    const hostedRooms = await ctx.db
      .query("coop_rooms")
      .withIndex("by_hostAccountId", (q) => q.eq("hostAccountId", args.accountId))
      .collect();
    for (const room of hostedRooms) {
      await ctx.db.patch(room._id, { status: "closed", updatedAt: now });
    }

    await ctx.db.delete(args.accountId);
    return summary;
  },
});

export const setMatureContent = mutationGeneric({
  args: {
    accountId,
    guestTokenHash,
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(account), args.guestTokenHash);
    const entitlement = await ctx.db
      .query("entitlements")
      .withIndex("by_accountId", (q) => q.eq("accountId", args.accountId))
      .first();
    const update = buildMatureContentAccountUpdate({
      account: accountFromDoc(account),
      entitlement,
      enabled: args.enabled,
      now: Date.now(),
    });
    await ctx.db.patch(args.accountId, cleanDoc(update));
    return { accountId: args.accountId, matureContentEnabled: args.enabled };
  },
});

async function buildAccountExportBundle(ctx: QueryCtx, id: GenericId<"accounts">, account: AccountRecord) {
  const [
    entitlements,
    usageMeters,
    saves,
    turnHistory,
    endings,
    authoredSeeds,
    publishedTales,
    analyticsEvents,
    assets,
    dailyCounters,
  ] = await Promise.all([
    ctx.db.query("entitlements").withIndex("by_accountId", (q) => q.eq("accountId", id)).collect(),
    ctx.db.query("usage_meters").withIndex("by_account_period", (q) => q.eq("accountId", id)).collect(),
    ctx.db.query("saves").withIndex("by_accountId", (q) => q.eq("accountId", id)).collect(),
    ctx.db.query("turn_history").withIndex("by_accountId", (q) => q.eq("accountId", id)).collect(),
    ctx.db.query("endings_unlocked").withIndex("by_account_story", (q) => q.eq("accountId", id)).collect(),
    ctx.db.query("authored_seeds").withIndex("by_ownerAccountId", (q) => q.eq("ownerAccountId", id)).collect(),
    ctx.db.query("published_tales").withIndex("by_ownerAccountId", (q) => q.eq("ownerAccountId", id)).collect(),
    ctx.db.query("analytics_events").withIndex("by_accountId", (q) => q.eq("accountId", id)).collect(),
    ctx.db.query("assets").withIndex("by_accountId", (q) => q.eq("accountId", id)).collect(),
    ctx.db.query("daily_turn_counter").withIndex("by_account_day", (q) => q.eq("accountId", id)).collect(),
  ]);

  return {
    exportedAt: Date.now(),
    account: buildAccountExport(account),
    entitlements: entitlements.map(exportEntitlement),
    usageMeters: usageMeters.map(stripSystemFields),
    saves: saves.map(stripSystemFields),
    turnHistory: turnHistory.map(stripSystemFields),
    endings: endings.map(stripSystemFields),
    authoredSeeds: authoredSeeds.map(stripSystemFields),
    publishedTales: publishedTales.map((tale) => ({
      taleId: String(tale._id),
      title: tale.title,
      synopsis: tale.synopsis,
      privacy: tale.privacy,
      forkPolicy: tale.forkPolicy,
      isMature: tale.isMature,
      accessRevokedAt: tale.accessRevokedAt,
      createdAt: tale.createdAt,
      updatedAt: tale.updatedAt,
    })),
    analyticsEvents: analyticsEvents.map((event) => ({
      eventName: event.eventName,
      storyId: event.storyId,
      turnNumber: event.turnNumber,
      provider: event.provider,
      redacted: event.redacted,
      createdAt: event.createdAt,
    })),
    assets: assets.map((asset) => ({
      assetId: String(asset._id),
      kind: asset.kind,
      provider: asset.provider,
      status: asset.status,
      entitlementRequired: asset.entitlementRequired,
      promptHash: asset.promptHash,
      createdAt: asset.createdAt,
    })),
    dailyCounters: dailyCounters.map(stripSystemFields),
  };
}

async function deleteByIndex(
  ctx: MutationCtx,
  table: string,
  index: string,
  field: string,
  value: string,
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

function exportEntitlement(entitlement: EntitlementRecord & { _id?: unknown; _creationTime?: unknown }) {
  const exported = stripSystemFields(entitlement);
  delete exported.stripeCustomerId;
  delete exported.stripeSubscriptionId;
  return exported;
}

function stripSystemFields(doc: Record<string, unknown>): Record<string, unknown> {
  const { _id, _creationTime, ...rest } = doc;
  return rest;
}

function accountFromDoc(doc: Record<string, unknown>): AccountRecord {
  return { ...doc, _id: String(doc._id) } as AccountRecord;
}

function cleanDoc<T extends Record<string, unknown>>(doc: T): T {
  return Object.fromEntries(Object.entries(doc).filter(([, value]) => value !== undefined)) as T;
}
