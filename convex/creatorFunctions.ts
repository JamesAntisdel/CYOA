import { mutationGeneric, queryGeneric } from "convex/server";

import { accountFromDoc, cleanDoc } from "./lib/docs";
import { v } from "convex/values";
import { lintStoryGates } from "@cyoa/stories";

import { canEnableMatureContent, type AccountRecord } from "./account";
import { evaluateTextPolicy } from "./contentPolicy";
// updateDraft / validateSeed import their pure logic straight from ./creator
// (liveCore only wraps the original create/publish/archive plans).
import {
  updateAuthoredSeedDraft,
  validateCreatorSeedSubmission,
  type AuthoredSeedRecord,
} from "./creator";
import { assertAccountSessionAccess } from "./lib/authz";
import { loadEntitlementLite } from "./lib/entitlement";
import { AppError } from "./lib/errors";
import {
  buildArchiveAuthoredSeedPlan,
  buildCommunitySeedShelfItem,
  buildCreatorSeedLibraryItems,
  buildCreateAuthoredSeedPlan,
  buildPublishAuthoredSeedPlan,
  creatorHandle,
  normalizeSeedPublishMetadata,
  seedForkPolicy,
  seedIsMature,
  seedPublishedAt,
  seedVisibility,
  type AuthoredSeedShelfRecord,
  type CommunitySeedShelfItem,
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
    const validation = validateCreatorSeedSubmission({
      story: args.story,
      owner: accountFromDoc(owner) as AccountRecord & { _id: string },
    });
    // Non-blocking lint advisories (creator-arc publish gate: errors block —
    // they're already inside validation.issues via validateCreatorSeedStory —
    // while warnings/info surface here for the publish panel's confirmation
    // copy). ADDITIVE field: the drafts-shelf save path ignores it, so an
    // advisory still never blocks a draft save. Tolerant of a malformed story
    // (the structural issues above are the real report in that case).
    let advisories: Array<{ path: string; message: string; severity: "warning" | "info" }> = [];
    try {
      advisories = lintStoryGates(args.story)
        .filter((issue) => issue.severity !== "error")
        .map((issue) => ({
          path: issue.path,
          message: issue.message,
          severity: issue.severity as "warning" | "info",
        }));
    } catch {
      advisories = [];
    }
    return { ...validation, advisories };
  },
});

export const publish = mutationGeneric({
  args: {
    accountId,
    seedId,
    guestTokenHash,
    // Publish-step metadata (creator-arc, Req 22.6 / product feature 13).
    // All optional so pre-panel clients keep working; a metadata-less publish
    // lands UNLISTED (the community shelf only lists explicit "public").
    synopsis: v.optional(v.string()),
    tone: v.optional(v.string()),
    visibility: v.optional(v.union(v.literal("public"), v.literal("unlisted"))),
    forkPolicy: v.optional(v.union(v.literal("allowed"), v.literal("disabled"))),
  },
  handler: async (ctx, args) => {
    const owner = await ctx.db.get(args.accountId);
    if (!owner) throw new AppError("account_not_found");
    const ownerRecord = accountFromDoc(owner) as AccountRecord & { _id: string };
    await assertAccountSessionAccess(ctx, ownerRecord, args.guestTokenHash);
    // L2: publishing to the public shelf is a claimed-account action. Drafts
    // stay guest-open (createDraft), but a guest can't push to the shelf —
    // there'd be no durable owner behind the byline.
    if (ownerRecord.kind !== "user") throw new AppError("account_required_to_publish");
    const seed = await ctx.db.get(args.seedId);
    if (!seed) throw new AppError("creator_seed_not_found");
    const metadata = normalizeSeedPublishMetadata({
      ...(args.synopsis !== undefined ? { synopsis: args.synopsis } : {}),
      ...(args.tone !== undefined ? { tone: args.tone } : {}),
      ...(args.visibility !== undefined ? { visibility: args.visibility } : {}),
      ...(args.forkPolicy !== undefined ? { forkPolicy: args.forkPolicy } : {}),
    });
    // Synopsis is reader-facing free text on a public surface — run it through
    // the same publishing-surface gate the seed's own fields go through
    // (mirrors game.ts's seedPremise handling). Block, don't rewrite.
    if (metadata.synopsis) {
      const policy = evaluateTextPolicy({
        text: metadata.synopsis,
        context: {
          accountId: ownerRecord._id,
          ageBand: ownerRecord.ageBand,
          entitlementTier: "free",
          matureContentEnabled: false,
          surface: "publishing",
        },
      });
      if (policy.action !== "allow") throw new AppError("seed_synopsis_blocked");
    }
    // Tone is reader-facing free text on the same public surface as the
    // synopsis (M1 — it was ungated). Same publishing-surface gate; block,
    // don't rewrite.
    if (metadata.tone) {
      const policy = evaluateTextPolicy({
        text: metadata.tone,
        context: {
          accountId: ownerRecord._id,
          ageBand: ownerRecord.ageBand,
          entitlementTier: "free",
          matureContentEnabled: false,
          surface: "publishing",
        },
      });
      if (policy.action !== "allow") throw new AppError("seed_tone_blocked");
    }
    const published = buildPublishAuthoredSeedPlan({
      seed: seedFromDoc(seed),
      owner: ownerRecord,
      now: Date.now(),
      metadata,
    });
    await ctx.db.patch(args.seedId, cleanDoc(published));
    return { seedId: args.seedId, seed: { ...published, _id: args.seedId } };
  },
});

// ---------------------------------------------------------------------------
// Community shelf (creator-arc; Req 22.3/22.6, product feature 13)
// ---------------------------------------------------------------------------

/** Bounded scan over published seeds per shelf read (listPublicTales pattern). */
const LIST_PUBLIC_SEEDS_DEFAULT_LIMIT = 30;
const LIST_PUBLIC_SEEDS_SCAN_CAP = 500;

/**
 * Public community shelf: PUBLISHED seeds with explicit `visibility:"public"`,
 * newest publish first, mature-excluded for guests and readers without an
 * active 18+ opt-in (Req 12.9 — same viewer resolution as
 * `talesFunctions:listPublicTales`), cursor-paged.
 *
 * Wire shape (BC2 — null-for-absent; adapted in apps/app/lib/seedShelfApi.ts):
 *
 *   {
 *     seeds: [{
 *       seedId: string,
 *       storyId: string,          // "authored_seed:<seedId>" — launchable via game:createSave
 *       title: string,
 *       synopsis: string | null,
 *       tone: string | null,
 *       opening: string,          // start-node seed text (turn-0 content only, BC10)
 *       ownerHandle: string,      // deterministic pseudonym, never the account id
 *       isMature: boolean,
 *       forkPolicy: "allowed" | "disabled",
 *       remixOfTitle: string | null,
 *       publishedAt: number,
 *     }],
 *     nextCursor: number | null,  // pass back as `cursor` for the next page
 *   }
 *
 * `cursor` is the previous page's oldest `publishedAt`; items strictly older
 * are returned. Ties are broken by scanning order, so a duplicate timestamp
 * can at worst re-show one card — acceptable for a browse shelf.
 */
export const listPublishedPublic = queryGeneric({
  args: {
    accountId: v.optional(accountId),
    guestTokenHash,
    cursor: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Viewer mature resolution — degrade (never throw) on an unowned session:
    // discovery is a public surface (same posture as listPublicTales).
    let matureAllowed = false;
    if (args.accountId) {
      const accountDoc = await ctx.db.get(args.accountId);
      if (accountDoc) {
        const account = accountFromDoc(accountDoc);
        let sessionOwned = false;
        try {
          await assertAccountSessionAccess(ctx, account, args.guestTokenHash);
          sessionOwned = true;
        } catch {
          sessionOwned = false;
        }
        if (sessionOwned) {
          const entitlement = await loadEntitlementLite(ctx, args.accountId);
          matureAllowed =
            account.matureContentEnabled && canEnableMatureContent(account, entitlement);
        }
      }
    }

    const limit = Math.max(
      1,
      Math.min(args.limit ?? LIST_PUBLIC_SEEDS_DEFAULT_LIMIT, LIST_PUBLIC_SEEDS_SCAN_CAP),
    );
    const docs = await ctx.db
      .query("authored_seeds")
      .withIndex("by_status", (q) => q.eq("status", "published"))
      .take(LIST_PUBLIC_SEEDS_SCAN_CAP);

    const eligible = (docs as Array<Record<string, unknown>>)
      .map((doc) => shelfSeedFromDoc(doc))
      // Explicit public only — legacy published seeds (no visibility) stay
      // unlisted so nothing leaks retroactively.
      .filter((seed) => seedVisibility(seed) === "public")
      .filter((seed) => matureAllowed || !seedIsMature(seed))
      .sort((left, right) => seedPublishedAt(right) - seedPublishedAt(left))
      .filter((seed) => args.cursor === undefined || seedPublishedAt(seed) < args.cursor);

    const page = eligible.slice(0, limit);
    const seeds: CommunitySeedShelfItem[] = page.map((seed) =>
      buildCommunitySeedShelfItem({
        seed,
        ownerHandle: creatorHandle(seed.ownerAccountId),
      }),
    );
    const last = page[page.length - 1];
    const nextCursor = eligible.length > page.length && last ? seedPublishedAt(last) : null;
    return { seeds, nextCursor };
  },
});

/**
 * Remix (creator-arc, Req 22.6): copy a published seed's story graph into a
 * NEW draft owned by the caller, crediting the source (remixOfSeedId +
 * denormalized remixOfTitle). Honors the seed's forkPolicy (mirroring
 * TaleForkPolicy semantics: "disabled" refuses for everyone but the owner,
 * who always retains copy rights over their own work). Non-owners can remix
 * public and unlisted (link-shared) published seeds only; mature seeds
 * require the viewer's active 18+ opt-in (Req 12.9). The copy re-runs the
 * full create-draft validation + safety gates under the CALLER's account.
 */
export const remix = mutationGeneric({
  args: { accountId, seedId, guestTokenHash },
  handler: async (ctx, args) => {
    const accountDoc = await ctx.db.get(args.accountId);
    if (!accountDoc) throw new AppError("account_not_found");
    const account = accountFromDoc(accountDoc) as AccountRecord & { _id: string };
    await assertAccountSessionAccess(ctx, account, args.guestTokenHash);
    // L2: remixing copies a published seed onto the public creator surface, so
    // it's a claimed-account action too (parity with publish).
    if (account.kind !== "user") throw new AppError("account_required_to_publish");

    const seedDoc = await ctx.db.get(args.seedId);
    if (!seedDoc) throw new AppError("creator_seed_not_found");
    const source = shelfSeedFromDoc(seedDoc as Record<string, unknown>);
    const isOwner = source.ownerAccountId === args.accountId;
    if (!isOwner) {
      if (source.status !== "published") throw new AppError("creator_seed_forbidden");
      if (seedForkPolicy(source) === "disabled") {
        throw new AppError("creator_seed_remix_disabled");
      }
      if (seedIsMature(source)) {
        const entitlement = await loadEntitlementLite(ctx, args.accountId);
        const matureAllowed =
          account.matureContentEnabled && canEnableMatureContent(account, entitlement);
        if (!matureAllowed) throw new AppError("creator_seed_mature_forbidden");
      }
    }

    const now = Date.now();
    const draft = buildCreateAuthoredSeedPlan({
      owner: account,
      title: isOwner ? source.title : `${source.title} (remix)`,
      story: source.story,
      now,
    });
    const credited = {
      ...draft,
      remixOfSeedId: String(args.seedId),
      remixOfTitle: source.title,
    };
    const id = await ctx.db.insert("authored_seeds", cleanDoc(credited));
    return { seedId: id, seed: { ...credited, _id: id } };
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

/** Shelf-typed variant of seedFromDoc (the optional community fields ride
 * along untyped in the raw doc either way). */
function shelfSeedFromDoc(doc: Record<string, unknown>): AuthoredSeedShelfRecord & { _id: string } {
  return { ...doc, _id: String(doc._id) } as AuthoredSeedShelfRecord & { _id: string };
}

