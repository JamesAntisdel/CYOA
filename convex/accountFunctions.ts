import { mutationGeneric, queryGeneric } from "convex/server";

import { librarianRank } from "@cyoa/engine";

import { accountFromDoc, cleanDoc } from "./lib/docs";
import { dedupeKeepsakes, type Keepsake } from "./keepsakes";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { v } from "convex/values";

import {
  buildAccountExport,
  buildMediaPrefsUpdate,
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
    const profile = buildAccountProfile({
      account: accountFromDoc(account),
      entitlement: entitlement ?? buildDefaultEntitlement(args.accountId, account.lastActiveAt),
    });
    // W3 (R12.3): widen the profile projection with the Librarian Rank +
    // owned keepsakes (BC3/BC4). Both are display-only, derived from what's
    // cheaply queryable per account. Server emits concrete values (never null)
    // so the client adapter maps them straight through.
    const meta = await buildProfileMetaAdditions(ctx, args.accountId);
    return { ...profile, ...meta };
  },
});

/**
 * Compute the W3 profile additions (Requirement 12.3): the Librarian Rank +
 * the account's deduped owned keepsakes. Gathered from `endings_unlocked`
 * (count + carried keepsakes), `published_tales` (active tale count), and the
 * account's saves (lifetime arc beats fired). All three are account-indexed so
 * this stays a bounded read.
 */
async function buildProfileMetaAdditions(
  ctx: QueryCtx,
  accountIdValue: GenericId<"accounts">,
): Promise<{
  librarianRank: ReturnType<typeof librarianRank>;
  keepsakes: Keepsake[];
}> {
  const [endingRows, taleRows, saveRows] = await Promise.all([
    ctx.db
      .query("endings_unlocked")
      .withIndex("by_account_story", (q) => q.eq("accountId", accountIdValue))
      .collect(),
    ctx.db
      .query("published_tales")
      .withIndex("by_ownerAccountId", (q) => q.eq("ownerAccountId", accountIdValue))
      .collect(),
    ctx.db
      .query("saves")
      .withIndex("by_accountId", (q) => q.eq("accountId", accountIdValue))
      .collect(),
  ]);

  const endings = endingRows.length;
  // Active (non-revoked) published tales only — a revoked tale no longer counts
  // toward the rank.
  const tales = taleRows.filter(
    (tale) => (tale as { accessRevokedAt?: unknown }).accessRevokedAt === undefined,
  ).length;
  // Lifetime arc beats fired: sum the `fired` beats inside each save's arc.
  // Read structurally so the projection tolerates legacy / arc-less saves.
  const beats = saveRows.reduce((sum, save) => sum + countFiredBeats(save), 0);

  const keepsakes = dedupeKeepsakes(
    endingRows
      .map((row) => (row as { keepsake?: unknown }).keepsake)
      .filter(isKeepsake),
  );

  return { librarianRank: librarianRank({ endings, beats, tales }), keepsakes };
}

function countFiredBeats(save: unknown): number {
  const beats = (save as { state?: { arc?: { beats?: unknown } } })?.state?.arc?.beats;
  if (!Array.isArray(beats)) return 0;
  return beats.reduce(
    (n, beat) => (beat && (beat as { status?: unknown }).status === "fired" ? n + 1 : n),
    0,
  );
}

function isKeepsake(value: unknown): value is Keepsake {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Keepsake).id === "string" &&
    typeof (value as Keepsake).label === "string" &&
    typeof (value as Keepsake).description === "string"
  );
}

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

// Per-account media-generation gates. Mirrors the auth pattern of
// setMatureContent: validate the session, then patch the row. The matching
// gate enforcement lives in `convex/media/sceneMedia.ts` — when a modality
// is false, the queue mutations short-circuit before scheduling Imagen /
// Veo / Google TTS so the provider bill matches the reader's preference.
//
// Returns the projection (via the shared profile-builder path) so the
// client can swap the new value into its local cache in one round-trip
// without re-fetching getProfile.
export const setMediaPrefs = mutationGeneric({
  args: {
    accountId,
    guestTokenHash,
    imagesEnabled: v.boolean(),
    audioEnabled: v.boolean(),
    videoEnabled: v.boolean(),
    // omni-cinematics media-strategy selector. Optional so pre-feature clients
    // keep working. MUST be accepted here (Convex rejects unknown args) AND
    // persisted, so the server `resolveMediaStrategy` sees the reader's choice.
    cinematicMode: v.optional(
      v.union(
        v.literal("off"),
        v.literal("stills_only"),
        v.literal("endpoint_cinematic"),
        v.literal("per_scene_legacy"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new AppError("account_not_found");
    await assertAccountSessionAccess(ctx, accountFromDoc(account), args.guestTokenHash);
    const update = buildMediaPrefsUpdate({
      imagesEnabled: args.imagesEnabled,
      audioEnabled: args.audioEnabled,
      videoEnabled: args.videoEnabled,
      ...(args.cinematicMode ? { cinematicMode: args.cinematicMode } : {}),
    });
    await ctx.db.patch(args.accountId, update);
    const entitlement = await ctx.db
      .query("entitlements")
      .withIndex("by_accountId", (q) => q.eq("accountId", args.accountId))
      .first();
    const updatedAccount = await ctx.db.get(args.accountId);
    if (!updatedAccount) throw new AppError("account_not_found");
    return buildAccountProfile({
      account: accountFromDoc(updatedAccount),
      entitlement: entitlement ?? buildDefaultEntitlement(args.accountId, account.lastActiveAt),
    });
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

