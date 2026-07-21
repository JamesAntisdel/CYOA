import { mutationGeneric, queryGeneric } from "convex/server";

import { librarianRank, rankProgress, type RankProgress } from "@cyoa/engine";

import { accountFromDoc, cleanDoc } from "./lib/docs";
import { dedupeKeepsakes, type Keepsake } from "./keepsakes";
import type { GenericQueryCtx } from "convex/server";
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
import { cascadeAccountData, deleteByIndex } from "./lib/accountCascade";
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

/** Newest-N cap the profile returns for the mementos shelf (R2.4). */
const MEMENTO_PROJECTION_CAP = 12;

/** Shape the client reads for each memento card (design §3 wire shape). */
type MementoProjectionItem = {
  act: number;
  label: string;
  description: string;
  storyTitle: string;
  createdAt: number;
};

/**
 * Compute the profile additions:
 *
 * - **W3 (Requirement 12.3):** the Librarian Rank + the account's deduped owned
 *   keepsakes. Gathered from `endings_unlocked` (count + carried keepsakes),
 *   `published_tales` (active tale count), and the account's saves (lifetime arc
 *   beats fired).
 * - **Act-mementos (R3.2):** the `rankProgress` ticker — the NEXT tier and the
 *   per-metric deficits — computed by the pure engine helper from the SAME
 *   `librarianRank` value the chip renders (AM3: one count, not two), so chip
 *   and ticker never disagree. Null at the top tier.
 * - **Act-mementos (R2.4):** the newest `MEMENTO_PROJECTION_CAP` mementos plus a
 *   `total` count, via `by_accountId`. Null when the shelf is empty (R4.2).
 *
 * All four reads are account-indexed so this stays a bounded read (AM4 — this is
 * a query, so it is read-only: no analytics, no writes).
 */
async function buildProfileMetaAdditions(
  ctx: QueryCtx,
  accountIdValue: GenericId<"accounts">,
): Promise<{
  librarianRank: ReturnType<typeof librarianRank>;
  keepsakes: Keepsake[];
  rankProgress: RankProgress | null;
  mementos: { total: number; items: MementoProjectionItem[] } | null;
}> {
  const [endingRows, taleRows, saveRows, mementoRows] = await Promise.all([
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
    ctx.db
      .query("mementos")
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

  // AM3: the rank the chip shows AND the ticker's progression are derived from
  // one `librarianRank` result — never a second metric count.
  const rank = librarianRank({ endings, beats, tales });

  // R2.4: total from the full account read; items are the newest cap, sorted by
  // `createdAt` descending. Null-for-absent when there are no mementos (R4.2 —
  // the client shelf self-hides).
  const total = mementoRows.length;
  const items = mementoRows
    .map(projectMemento)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MEMENTO_PROJECTION_CAP);

  return {
    librarianRank: rank,
    keepsakes,
    // Null at the top tier (engine returns null) — the client falls back to the
    // existing totals line.
    rankProgress: rankProgress(rank),
    mementos: total === 0 ? null : { total, items },
  };
}

function projectMemento(row: unknown): MementoProjectionItem {
  const memento = (row ?? {}) as Partial<MementoProjectionItem>;
  return {
    act: typeof memento.act === "number" ? memento.act : 0,
    label: typeof memento.label === "string" ? memento.label : "",
    description: typeof memento.description === "string" ? memento.description : "",
    storyTitle: typeof memento.storyTitle === "string" ? memento.storyTitle : "",
    createdAt: typeof memento.createdAt === "number" ? memento.createdAt : 0,
  };
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

    // Shared hard-delete cascade (saves + scenes/turn_history/story_bibles,
    // endings, metering, analytics, assets, tale reads/forks, leaderboard,
    // daily_results). Kept in lockstep with purgeExpiredGuests via one helper.
    const cascade = await cascadeAccountData(ctx, args.accountId);
    summary.savesDeleted += cascade.savesDeleted;
    summary.scenesDeleted += cascade.scenesDeleted;
    summary.turnHistoryDeleted += cascade.turnHistoryDeleted;
    summary.endingsDeleted += cascade.endingsDeleted;
    summary.entitlementsDeleted += cascade.entitlementsDeleted;
    summary.usageMetersDeleted += cascade.usageMetersDeleted;
    summary.dailyCountersDeleted += cascade.dailyCountersDeleted;
    summary.analyticsDeleted += cascade.analyticsDeleted;
    summary.assetsDeleted += cascade.assetsDeleted;
    summary.taleReadsDeleted += cascade.taleReadsDeleted;
    summary.taleForksDeleted += cascade.taleForksDeleted;

    // Act-mementos (R2.3): purge the account's mementos on full-account erasure
    // (parity with `endings_unlocked`). Save deletion / rewind / hardcore
    // permadeath deliberately do NOT touch mementos (R2.1) — only whole-account
    // deletion does.
    await deleteByIndex(ctx, "mementos", "by_accountId", "accountId", args.accountId);

    // daily-killcam (design §5, NFR Security): purge the account's killcam rows
    // on full-account erasure via the account-scoped `by_accountId` index (the
    // `by_daily_account` index leads with `dailyId`, so it can't front an
    // account-only scan). Mirrors the `daily_results` purge posture.
    await deleteByIndex(ctx, "daily_choice_results", "by_accountId", "accountId", args.accountId);

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
        // Reading-modes R3 (Illustrated Book, OQ7 distinct strategy). MUST be
        // accepted here or Convex rejects the picker's coupled write and the
        // still-guaranteeing strategy never persists (the reader keeps the
        // dev-Pro `endpoint_cinematic` default — an opening cinematic video).
        v.literal("illustrated_book"),
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
    mementos,
    dailyChoiceResults,
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
    ctx.db.query("mementos").withIndex("by_accountId", (q) => q.eq("accountId", id)).collect(),
    ctx.db.query("daily_choice_results").withIndex("by_accountId", (q) => q.eq("accountId", id)).collect(),
  ]);

  // story_bibles is save-scoped (only by_saveId), so gather it by iterating the
  // account's saves — mirrors the deletion cascade. BC10: the `bible` payload is
  // server-only planning (spoilers) and must never reach the client, so the
  // export carries only the non-spoiler bookkeeping fields, not `bible`.
  const storyBibles: Array<Record<string, unknown>> = [];
  for (const save of saves) {
    const bibles = await ctx.db
      .query("story_bibles")
      .withIndex("by_saveId", (q) => q.eq("saveId", save._id))
      .collect();
    for (const bible of bibles) {
      storyBibles.push({
        saveId: String(bible.saveId),
        status: bible.status,
        attachedAtTurn: bible.attachedAtTurn,
        lastRefreshAct: bible.lastRefreshAct,
        retryCount: bible.retryCount,
        createdAt: bible.createdAt,
        updatedAt: bible.updatedAt,
      });
    }
  }

  return {
    exportedAt: Date.now(),
    account: buildAccountExport(account),
    entitlements: entitlements.map(exportEntitlement),
    usageMeters: usageMeters.map(stripSystemFields),
    saves: saves.map(stripSystemFields),
    storyBibles,
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
    // Act-mementos (R2.3): mementos ride into the export bundle, same posture as
    // `endings`.
    mementos: mementos.map(stripSystemFields),
    // daily-killcam (design §5): killcam rows ride into the export bundle, same
    // posture as `daily_results` / `mementos`. `choiceKey` is a normalized slug
    // or the reserved `free-form` key — never the reader's typed text (DK4).
    dailyChoiceResults: dailyChoiceResults.map(stripSystemFields),
  };
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

