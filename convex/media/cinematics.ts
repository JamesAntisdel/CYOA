// Endpoint-cinematics orchestration (omni-cinematics P1). Owns:
//
//   1. `buildCinematicReferences(ctx, save)` — the bounded reference set for a
//      save. P1 = protagonist + setting anchors (companions / key beats are
//      P2). Loads the underlying storage bytes as `OmniReference`s. Missing /
//      un-ready anchors are skipped, never fatal (Req 4.4).
//   2. `buildBeatTimeline(ctx, save)` — a compact, ordered, SAFETY-CLASSIFIED
//      summary of the run (storySummary + the ending/opening scene prose). Runs
//      through the narrative-safety classifier before it can reach Omni, exactly
//      as scene prompts do (Req 5.1 / 5.3 / 11.1).
//   3. `queueEndpointCinematic` (internalMutation) — the guarded queue entry.
//      Gates on strategy=endpoint_cinematic (encodes Pro) + omniConfigured();
//      dedupes by (saveId, trigger[, endingId]); inserts the queued
//      `kind:"cinematic"` asset; schedules the job; emits `cinematic.requested`.
//   4. `runOmniCinematicJob` / `pollOmniCinematicJob` (actions) — submit + poll
//      Omni (poll-reschedule like Veo), persist video+audio + provenance, or
//      fall back to a poster still. NEVER throw into the read loop.
//
// Design invariant: cinematics are strictly ADDITIVE. Every failure path
// degrades to a still or a failed asset — the read loop, endings, and trophy
// crypt always render (Req 3.4 / 11.3).

import { v } from "convex/values";
import {
  actionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";

import { accountFromDoc } from "../lib/docs";
import { hashPrompt } from "../assets";
import { chargeMediaSpend, refundSpark } from "../billing/mediaCredits";
import { devForceProMedia } from "./proMediaGate";
import {
  buildAnalyticsEvent,
  type AnalyticsMetricName,
} from "../analytics";
import { evaluateTextPolicy, matureContextForAccount } from "../contentPolicy";
import { decodeBase64ToUint8Array, rewriteToPublicOrigin } from "./imagenClient";
import {
  cinematicAlreadyExists,
  chapterCinematicExistsForScene,
  countChapterCinematics,
  shouldFireOpeningCinematic,
  MAX_CHAPTER_CINEMATICS_PER_RUN,
} from "./cinematicTriggers";
import { resolveMediaStrategy } from "./mediaStrategy";
import {
  omniConfigured,
  resolveOmniModel,
  submitOmniCinematic,
  pollOmniCinematic,
  type OmniReference,
  type OmniCinematicRequest,
} from "./omniClient";

const accountId = v.id("accounts");
const saveId = v.id("saves");

// Omni Flash preview: single ~8-10s shot in P1 (C7). Env-overridable to mirror
// the Veo config knobs; defaults are the safe 720p / 16:9 / 8s.
const OMNI_DEFAULT_DURATION_S = 8;
const OMNI_DEFAULT_RESOLUTION: "720p" | "1080p" = "720p";
const OMNI_DEFAULT_ASPECT: "16:9" | "9:16" = "16:9";
// ~$0.10/sec preview estimate (C7 — verify on a live key before pricing).
const OMNI_CENTS_PER_SECOND = 10;

const OMNI_POLL_INTERVAL_MS = 6_000;
// ~5 min of polling. Omni video generation routinely takes 1–3 min; a tight
// window silently times out to the still fallback (verified: submit succeeds but
// the render isn't ready within 2 min).
const OMNI_MAX_POLLS = 50;

// Reference set caps (Req 4.1–4.4). Omni accepts a bounded number of subject
// references; `CINEMATIC_REFERENCE_LIMIT` is the hard cap on the loaded set.
// Salience order (highest first): protagonist + setting ALWAYS, then companion
// NPC portraits (role/recency ranked), then key-beat stills. `MAX_COMPANION_*`
// / `MAX_BEAT_*` bound how many of each are *considered* before the overall cap
// trims the tail; dropped references are logged (Req 4.3).
const CINEMATIC_REFERENCE_LIMIT = 6;
const MAX_COMPANION_REFERENCES = 3;
const MAX_BEAT_STILL_REFERENCES = 3;
// Companion role salience for reference ranking (Req 4.3 — "companions by
// role/recency"). Lower rank = higher priority. Roles absent from the map sort
// after all known roles.
const COMPANION_ROLE_PRIORITY: Record<string, number> = {
  companion: 0,
  ally: 1,
  rival: 2,
  neutral: 3,
  antagonist: 4,
};

// How many recent turns' choiceLabels feed the enriched beat timeline (Req 5.1).
const BEAT_TIMELINE_MAX_TURNS = 12;

/** Which endpoint produced a cinematic. `chapter` added in P2 (C1 cadence). */
type CinematicTrigger = "opening" | "ending" | "chapter";

// Opening-cinematic anchor-settle loop (C3). The opening fires only once the
// turn-1 anchors have landed; when the queue call arrives before they do we
// reschedule ourselves a bounded number of times, then proceed anyway with
// whatever references exist (Req 4.4).
const OPENING_ANCHOR_RETRY_MS = 10_000;
const OPENING_ANCHOR_MAX_ATTEMPTS = 6;

type CinematicAssetDoc = {
  _id: string;
  accountId: string;
  saveId?: string;
  sceneId?: string;
  kind: string;
  provider: string;
  url: string;
  status: string;
  cinematicTrigger?: CinematicTrigger;
  endingId?: string;
  hasAudio?: boolean;
  provenance: Record<string, unknown>;
  safety: Record<string, unknown>;
  createdAt: number;
  updatedAt?: number;
  readyAt?: number;
};

// ---------------------------------------------------------------------------
// Pure fallback selection (unit-tested). When Omni can't produce a clip we
// fall back — in P1 — to the endpoint's poster still (the CinematicMoment
// renders it as a poster frame, Req 7.2). A richer Veo i2v clip fallback
// (Req 3.4) is a P2 enhancement; the hook is `veoEnabled`.
// ---------------------------------------------------------------------------
export function selectCinematicFallback(input: {
  posterUrl?: string | null | undefined;
  veoEnabled?: boolean | undefined;
}): { kind: "still"; url: string } | { kind: "failed" } {
  if (typeof input.posterUrl === "string" && input.posterUrl.length > 0) {
    return { kind: "still", url: input.posterUrl };
  }
  return { kind: "failed" };
}

/** Accessible alt text for a cinematic, by trigger. */
function cinematicAltText(trigger: CinematicTrigger): string {
  if (trigger === "opening") return "Opening cinematic";
  if (trigger === "chapter") return "Chapter cinematic";
  return "Ending cinematic";
}

// ---------------------------------------------------------------------------
// Beat timeline (safety-classified). Ordered, compact spine of the run.
// ---------------------------------------------------------------------------
export async function buildBeatTimeline(
  ctx: { db: any },
  save: {
    _id?: string;
    saveId?: string;
    accountId?: string;
    storyId?: string;
    seedTitle?: string;
    storySummary?: string;
    currentSceneId?: string;
  },
): Promise<string> {
  const parts: string[] = [];
  const summary = (save.storySummary ?? "").trim();
  if (summary.length > 0) parts.push(summary);

  // The ordered spine of the run: the reader's key decisions, oldest→newest
  // (Req 5.1). Pull the recent turn_history choiceLabels for the save and
  // stitch them into a single "chose X; then Y; then Z" line so Omni depicts a
  // progression, not a single disconnected shot. Best-effort — a summary-only
  // timeline is still a fine spine when history can't be read.
  const saveIdValue = save.saveId ?? save._id;
  try {
    if (saveIdValue) {
      const rows = (await ctx.db
        .query("turn_history")
        .withIndex("by_save_turn", (q: any) => q.eq("saveId", saveIdValue))
        .order("desc")
        .take(BEAT_TIMELINE_MAX_TURNS)) as Array<{ choiceLabel?: string }>;
      // `order("desc")` returns newest-first; reverse for chronological order.
      const labels = rows
        .slice()
        .reverse()
        .map((r) => (typeof r.choiceLabel === "string" ? r.choiceLabel.trim() : ""))
        .filter((label) => label.length > 0);
      if (labels.length > 0) {
        parts.push(`The reader's key decisions, in order: ${labels.join("; ")}.`);
      }
    }
  } catch {
    // Best-effort — the summary alone is a fine timeline.
  }

  // The ending/opening scene prose is the freshest beat — pull it off the
  // current scene row when present.
  try {
    if (save.currentSceneId) {
      const scene = (await ctx.db.get(save.currentSceneId)) as { prose?: string } | null;
      const prose = (scene?.prose ?? "").trim();
      if (prose.length > 0) parts.push(prose.slice(0, 800));
    }
  } catch {
    // Best-effort — the summary alone is a fine timeline.
  }

  const raw = parts.join("\n\n").slice(0, 1800);
  const title = (save.seedTitle ?? "").trim();
  const neutral =
    title.length > 0
      ? `A cinematic montage of the tale "${title}".`
      : "A cinematic montage of the reader's journey.";
  if (raw.length === 0) return neutral;

  // Req 5.3 / 11.1: classify before it can reach Omni. Build the context from
  // the reader's own account so a mature Pro reader's ending isn't wrongly
  // scrubbed; fall back to a conservative general-audience context when the
  // account can't be loaded.
  let context;
  try {
    const account = save.accountId ? await ctx.db.get(save.accountId) : null;
    if (account) {
      // entitlement tier only widens mature gating; null keeps the classifier
      // conservative (general-audience) for the beat-timeline summary.
      context = matureContextForAccount({
        account: accountFromDoc(account),
        entitlement: null,
        surface: "generation",
      });
    }
  } catch {
    context = undefined;
  }
  if (!context) {
    context = {
      accountId: save.accountId ?? "unknown",
      ageBand: "13-17" as const,
      entitlementTier: "free" as const,
      matureContentEnabled: false,
      surface: "generation" as const,
    };
  }

  const policy = evaluateTextPolicy({ text: raw, context });
  if (policy.action === "allow" || policy.action === "rewrite") {
    return raw;
  }
  // Blocked / safe-forced → don't send the unsafe spine to Omni; use the
  // neutral montage line so the cinematic still frames the tale abstractly.
  return neutral;
}

// ---------------------------------------------------------------------------
// Reference set (Req 4.1–4.4). Salience-ranked, bounded, multi-subject:
// protagonist + setting anchors ALWAYS, then companion NPC portraits, then
// key-beat stills; capped at CINEMATIC_REFERENCE_LIMIT with dropped refs
// logged. Loads storage bytes (anchors via storageId, companions/beats via
// their CDN url). Missing / un-ready refs are skipped, never fatal.
// ---------------------------------------------------------------------------

type ReferenceSource = "protagonist" | "setting" | "companion" | "beat";

/** A candidate reference before byte-loading. Carries load + ranking hints. */
export type ReferenceCandidate = {
  assetId: string;
  source: ReferenceSource;
  // Load hints: prefer storageId (anchors — direct storage.get), else url fetch.
  storageId?: string;
  url?: string;
  mime?: string;
  // Ranking hints. `role` orders companions; `rank` is a recency proxy (higher
  // = more recent / more salient).
  role?: string;
  rank?: number;
};

/** Raw candidate pools gathered from the DB, pre-selection. */
export type RawReferenceCandidates = {
  protagonist?: ReferenceCandidate;
  setting?: ReferenceCandidate;
  companions: ReferenceCandidate[];
  beats: ReferenceCandidate[];
};

/**
 * Rank companion portrait candidates by role salience then recency (Req 4.3).
 * PURE + exported for unit testing. `max` bounds how many companions are
 * considered before the overall reference cap trims the tail.
 */
export function rankCompanionReferences(
  companions: ReadonlyArray<ReferenceCandidate>,
  max: number = MAX_COMPANION_REFERENCES,
): ReferenceCandidate[] {
  return companions
    .slice()
    .sort((a, b) => {
      const ra = COMPANION_ROLE_PRIORITY[a.role ?? ""] ?? 99;
      const rb = COMPANION_ROLE_PRIORITY[b.role ?? ""] ?? 99;
      if (ra !== rb) return ra - rb;
      // Same role → most recent first.
      return (b.rank ?? 0) - (a.rank ?? 0);
    })
    .slice(0, Math.max(0, max));
}

/**
 * Pick key-beat stills from the run: the terminal (most recent) beat plus a few
 * evenly-spaced earlier beats (Req 4.1). Input is ordered OLDEST→NEWEST; output
 * is NEWEST-first (the climax leads). PURE + exported for unit testing.
 */
export function pickSpacedBeatStills(
  beatsOldestFirst: ReadonlyArray<ReferenceCandidate>,
  max: number = MAX_BEAT_STILL_REFERENCES,
): ReferenceCandidate[] {
  const n = beatsOldestFirst.length;
  if (n === 0 || max <= 0) return [];
  if (n <= max) return beatsOldestFirst.slice().reverse();
  if (max === 1) return [beatsOldestFirst[n - 1]!];
  // Evenly spaced indices across [0, n-1] inclusive; i=0→oldest, last→terminal.
  const idxs = new Set<number>();
  for (let i = 0; i < max; i++) {
    idxs.add(Math.round((i * (n - 1)) / (max - 1)));
  }
  return [...idxs]
    .sort((a, b) => b - a) // newest-first
    .map((i) => beatsOldestFirst[i]!)
    .filter((c): c is ReferenceCandidate => Boolean(c));
}

/**
 * Select the final, salience-ordered, capped reference set (Req 4.3). Order:
 * protagonist → setting → companions (ranked) → beats (spaced). Everything past
 * `limit` is returned as `dropped` so the caller can log it. PURE + exported.
 */
export function selectCinematicReferences(input: {
  candidates: RawReferenceCandidates;
  limit?: number;
  maxCompanions?: number;
  maxBeats?: number;
}): { selected: ReferenceCandidate[]; dropped: ReferenceCandidate[] } {
  const limit = input.limit ?? CINEMATIC_REFERENCE_LIMIT;
  const { candidates } = input;
  const ordered: ReferenceCandidate[] = [];
  if (candidates.protagonist) ordered.push(candidates.protagonist);
  if (candidates.setting) ordered.push(candidates.setting);
  ordered.push(...rankCompanionReferences(candidates.companions, input.maxCompanions));
  ordered.push(...pickSpacedBeatStills(candidates.beats, input.maxBeats));
  return { selected: ordered.slice(0, limit), dropped: ordered.slice(limit) };
}

/**
 * Gather the raw reference candidate pools for a save from a DB-style ctx
 * (`ctx.db.get` + `ctx.db.query`). Shared by the mutation (which has ctx.db)
 * and the `_getCinematicReferenceCandidates` query (which the action calls).
 * Never throws — a missing pool just yields fewer candidates (Req 4.4).
 */
export async function gatherReferenceCandidatesFromDb(
  ctx: { db: any },
  saveDoc: {
    anchorProtagonistAssetId?: string;
    anchorSettingAssetId?: string;
    state?: { npcs?: Record<string, { role?: string; portraitAssetId?: string }> };
  },
  saveIdValue: string,
): Promise<RawReferenceCandidates> {
  let assets: any[] = [];
  try {
    assets = (await ctx.db
      .query("assets")
      .withIndex("by_saveId", (q: any) => q.eq("saveId", saveIdValue))
      .collect()) as any[];
  } catch {
    assets = [];
  }
  const byId = new Map<string, any>();
  for (const a of assets) byId.set(String(a._id), a);

  const anchorCandidate = (
    id: string | undefined,
    source: "protagonist" | "setting",
  ): ReferenceCandidate | undefined => {
    if (!id) return undefined;
    const a = byId.get(String(id));
    if (!a || a.status !== "ready") return undefined;
    const prov = (a.provenance ?? {}) as Record<string, unknown>;
    return {
      assetId: String(id),
      source,
      ...(typeof prov.storageId === "string" ? { storageId: prov.storageId } : {}),
      ...(typeof a.url === "string" && a.url.length > 0 ? { url: a.url } : {}),
      mime: typeof prov.mime === "string" ? prov.mime : "image/png",
    };
  };

  const protagonist = anchorCandidate(saveDoc.anchorProtagonistAssetId, "protagonist");
  const setting = anchorCandidate(saveDoc.anchorSettingAssetId, "setting");

  // Companion NPC portraits: read the save's engine NPC state, resolve each
  // NPC's portraitAssetId to a READY image row, tag with its role + recency.
  const companions: ReferenceCandidate[] = [];
  const npcs = saveDoc.state?.npcs;
  if (npcs && typeof npcs === "object") {
    for (const npc of Object.values(npcs)) {
      const pid = npc?.portraitAssetId;
      if (!pid) continue;
      const a = byId.get(String(pid));
      if (!a || a.kind !== "image" || a.status !== "ready") continue;
      if (typeof a.url !== "string" || a.url.length === 0) continue;
      companions.push({
        assetId: String(pid),
        source: "companion",
        url: a.url,
        mime: "image/png",
        role: typeof npc?.role === "string" ? npc.role : "companion",
        rank: typeof a.createdAt === "number" ? a.createdAt : 0,
      });
    }
  }

  // Key-beat stills: ready scene images for the save (exclude NPC portraits and
  // the anchors — those are their own sources), ordered oldest→newest by
  // createdAt (a stable turn-order proxy that avoids a scenes join).
  const beats: ReferenceCandidate[] = assets
    .filter(
      (a) =>
        a.kind === "image" &&
        a.status === "ready" &&
        typeof a.url === "string" &&
        a.url.length > 0 &&
        a.sceneId &&
        !a.npcId &&
        !a.referenceKind,
    )
    .sort((x, y) => (x.createdAt ?? 0) - (y.createdAt ?? 0))
    .map((a) => ({
      assetId: String(a._id),
      source: "beat" as const,
      url: a.url as string,
      mime: "image/png",
      rank: typeof a.createdAt === "number" ? a.createdAt : 0,
    }));

  return { ...(protagonist ? { protagonist } : {}), ...(setting ? { setting } : {}), companions, beats };
}

/**
 * Load one candidate's bytes as an `OmniReference`. Prefers the storage id
 * (anchors — no HTTP), falls back to a CDN url fetch (companions / beats).
 * Returns null on any failure so the reference is simply skipped (Req 4.4).
 */
async function loadReferenceBytesForCandidate(
  ctx: { storage: { get: (id: any) => Promise<Blob | null> } },
  cand: ReferenceCandidate,
): Promise<OmniReference | null> {
  try {
    if (cand.storageId) {
      const blob = await ctx.storage.get(cand.storageId);
      if (blob) {
        const buffer = await blob.arrayBuffer();
        return {
          bytesBase64: encodeUint8ArrayToBase64(new Uint8Array(buffer)),
          mimeType: cand.mime || blob.type || "image/png",
        };
      }
    }
    if (cand.url) {
      const res = await fetch(cand.url);
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        return {
          bytesBase64: encodeUint8ArrayToBase64(new Uint8Array(buffer)),
          mimeType: res.headers.get("content-type") || cand.mime || "image/png",
        };
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "reference_load_failed";
    console.warn(
      `[cinematics] reference load skip source=${cand.source} asset=${cand.assetId} error=${message}`,
    );
  }
  return null;
}

/**
 * Build the bounded, salience-ranked reference set for a cinematic (Req 4).
 * Gathers candidates for the save (protagonist + setting + companions + key-beat
 * stills) via the `_getCinematicReferenceCandidates` query, selects the top
 * `CINEMATIC_REFERENCE_LIMIT` by salience, logs any dropped, and loads bytes.
 * Never throws — degrades to whatever references loaded (Req 4.4).
 */
export async function buildCinematicReferences(
  ctx: {
    runQuery: (ref: any, args: any) => Promise<any>;
    storage: { get: (id: any) => Promise<Blob | null> };
  },
  save: { saveId?: string; anchorProtagonistAssetId?: string; anchorSettingAssetId?: string },
): Promise<OmniReference[]> {
  let candidates: RawReferenceCandidates = { companions: [], beats: [] };
  try {
    if (save.saveId) {
      candidates = (await ctx.runQuery(
        ("media/cinematics:_getCinematicReferenceCandidates" as unknown) as any,
        { saveId: save.saveId },
      )) as RawReferenceCandidates;
    } else {
      // No saveId (defensive) → anchors only, via the sceneMedia reference query.
      candidates = await gatherAnchorOnlyCandidates(ctx, save);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "candidate_gather_failed";
    console.warn(`[cinematics] reference candidate gather failed error=${message}`);
    candidates = await gatherAnchorOnlyCandidates(ctx, save);
  }

  const { selected, dropped } = selectCinematicReferences({ candidates });
  if (dropped.length > 0) {
    console.warn(
      `[cinematics] reference set capped at ${CINEMATIC_REFERENCE_LIMIT}; dropped ${dropped.length}: ${dropped
        .map((d) => `${d.source}:${d.assetId}`)
        .join(", ")}`,
    );
  }

  const out: OmniReference[] = [];
  for (const cand of selected) {
    const ref = await loadReferenceBytesForCandidate(ctx, cand);
    if (ref) out.push(ref);
  }
  return out;
}

/**
 * Fallback candidate gather when no saveId is available: resolve just the two
 * anchors through the sceneMedia reference query (storageId path). Mirrors the
 * P1 behavior so an action scheduled before this change still works.
 */
async function gatherAnchorOnlyCandidates(
  ctx: { runQuery: (ref: any, args: any) => Promise<any> },
  save: { anchorProtagonistAssetId?: string; anchorSettingAssetId?: string },
): Promise<RawReferenceCandidates> {
  const resolve = async (
    id: string | undefined,
    source: "protagonist" | "setting",
  ): Promise<ReferenceCandidate | undefined> => {
    if (!id) return undefined;
    try {
      const meta = (await ctx.runQuery(
        ("media/sceneMedia:_getAssetForReference" as unknown) as any,
        { assetId: id },
      )) as { status?: string; storageId?: string; mime?: string } | null;
      if (!meta || meta.status !== "ready" || !meta.storageId) return undefined;
      return { assetId: id, source, storageId: meta.storageId, mime: meta.mime || "image/png" };
    } catch {
      return undefined;
    }
  };
  const protagonist = await resolve(save.anchorProtagonistAssetId, "protagonist");
  const setting = await resolve(save.anchorSettingAssetId, "setting");
  return {
    ...(protagonist ? { protagonist } : {}),
    ...(setting ? { setting } : {}),
    companions: [],
    beats: [],
  };
}

/**
 * Registered query the Omni action calls to gather reference candidates for a
 * save (the action has no `ctx.db`). Thin wrapper over
 * `gatherReferenceCandidatesFromDb`.
 */
export const _getCinematicReferenceCandidates = queryGeneric({
  args: { saveId: v.id("saves") },
  handler: async (ctx, args) => {
    const saveDoc = (await ctx.db.get(args.saveId)) as
      | {
          anchorProtagonistAssetId?: string;
          anchorSettingAssetId?: string;
          state?: { npcs?: Record<string, { role?: string; portraitAssetId?: string }> };
        }
      | null;
    if (!saveDoc) return { companions: [], beats: [] } as RawReferenceCandidates;
    return gatherReferenceCandidatesFromDb(ctx, saveDoc, args.saveId);
  },
});

// ---------------------------------------------------------------------------
// Queue entry (internalMutation).
// ---------------------------------------------------------------------------
export const queueEndpointCinematic = internalMutationGeneric({
  args: {
    accountId,
    saveId,
    trigger: v.union(v.literal("opening"), v.literal("ending"), v.literal("chapter")),
    endingId: v.optional(v.string()),
    // Anchor-settle reschedule counter for the opening trigger (C3).
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) return { queued: false, reason: "account_not_found" } as const;

    // Strategy gate (Req 1.1/1.2, C4). endpoint_cinematic already encodes the
    // Pro requirement + the videoEnabled cap in the resolver; anything else
    // means no cinematics here.
    const strategy = await resolveMediaStrategy(ctx, args.accountId);
    console.log(
      `[cinematics] queueEndpointCinematic save=${args.saveId} trigger=${args.trigger} strategy=${strategy} omniConfigured=${omniConfigured()} attempt=${args.attempt ?? 0}`,
    );
    if (strategy !== "endpoint_cinematic") {
      return { queued: false, reason: `strategy_${strategy}` } as const;
    }
    // Belt-and-braces Pro check for the dev-force path parity with the other
    // queue mutations (resolver already requires Pro for endpoint_cinematic).
    if (!devForceProMedia()) {
      const entitlement = await ctx.db
        .query("entitlements")
        .withIndex("by_accountId", (q: any) => q.eq("accountId", args.accountId))
        .first();
      if (!entitlement || entitlement.tier !== "pro" || entitlement.status !== "active") {
        return { queued: false, reason: "pro_entitlement_required" } as const;
      }
    }
    // Omni unconfigured → degrade silently (the resolver should already have
    // steered away from endpoint_cinematic; this is the last guard, Req 1.6).
    if (!omniConfigured()) {
      return { queued: false, reason: "omni_unconfigured" } as const;
    }

    const saveDoc = (await ctx.db.get(args.saveId)) as
      | {
          accountId?: string;
          storyId?: string;
          seedTitle?: string;
          storySummary?: string;
          currentSceneId?: string;
          anchorProtagonistAssetId?: string;
          anchorSettingAssetId?: string;
          state?: { npcs?: Record<string, { role?: string; portraitAssetId?: string }> };
        }
      | null;
    if (!saveDoc) return { queued: false, reason: "save_not_found" } as const;

    // Opening: fire only once the turn-1 anchors have landed (C3). Reschedule
    // a bounded number of times, then proceed reference-less (Req 4.4).
    if (args.trigger === "opening" && !shouldFireOpeningCinematic(saveDoc as any)) {
      const attempt = args.attempt ?? 0;
      if (attempt < OPENING_ANCHOR_MAX_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          OPENING_ANCHOR_RETRY_MS,
          ("media/cinematics:queueEndpointCinematic" as unknown) as any,
          {
            accountId: args.accountId,
            saveId: args.saveId,
            trigger: "opening" as const,
            attempt: attempt + 1,
          },
        );
        console.log(
          `[cinematics] opening awaiting anchors save=${args.saveId} attempt=${attempt + 1}/${OPENING_ANCHOR_MAX_ATTEMPTS}`,
        );
        return { queued: false, reason: "awaiting_anchors", attempt: attempt + 1 } as const;
      }
      // fall through — proceed with whatever references exist.
    }

    // Dedupe (Req 2.5, C5) + chapter cadence cap (Req 8.2).
    const existing = (await ctx.db
      .query("assets")
      .withIndex("by_save_kind", (q: any) => q.eq("saveId", args.saveId).eq("kind", "cinematic"))
      .collect()) as CinematicAssetDoc[];
    if (args.trigger === "chapter") {
      // Chapters are keyed by (saveId, trigger, sceneId): dedupe a re-fire at the
      // SAME scene (retried turn) but allow the next cadence boundary, then cap
      // the run at MAX_CHAPTER_CINEMATICS_PER_RUN total (Req 8.2).
      if (chapterCinematicExistsForScene(existing, saveDoc.currentSceneId)) {
        return { queued: false, reason: "already_queued" } as const;
      }
      if (countChapterCinematics(existing) >= MAX_CHAPTER_CINEMATICS_PER_RUN) {
        return { queued: false, reason: "chapter_cap_reached" } as const;
      }
    } else if (
      cinematicAlreadyExists(existing, {
        trigger: args.trigger,
        ...(args.endingId ? { endingId: args.endingId } : {}),
      })
    ) {
      return { queued: false, reason: "already_queued" } as const;
    }

    // Safety-classified beat timeline (Req 5.1/11.1). `saveId` lets it stitch
    // the ordered choiceLabels from turn_history into the spine.
    const beatTimeline = await buildBeatTimeline(ctx, {
      saveId: args.saveId,
      ...(saveDoc.accountId ? { accountId: saveDoc.accountId } : { accountId: args.accountId }),
      ...(saveDoc.storyId ? { storyId: saveDoc.storyId } : {}),
      ...(saveDoc.seedTitle ? { seedTitle: saveDoc.seedTitle } : {}),
      ...(saveDoc.storySummary ? { storySummary: saveDoc.storySummary } : {}),
      ...(saveDoc.currentSceneId ? { currentSceneId: saveDoc.currentSceneId } : {}),
    });

    // Best-effort poster still for the four-state UI + the fallback path: a
    // ready scene image for the endpoint scene, else the setting anchor url.
    const posterUrl = await resolvePosterStillUrl(ctx, saveDoc.currentSceneId);

    const referenceAssetIds: { protagonist?: string; setting?: string } = {
      ...(saveDoc.anchorProtagonistAssetId ? { protagonist: saveDoc.anchorProtagonistAssetId } : {}),
      ...(saveDoc.anchorSettingAssetId ? { setting: saveDoc.anchorSettingAssetId } : {}),
    };
    // Provenance `referenceCount` is the queue-time anchor estimate. The FULL
    // salience-ranked set (anchors + companions + key-beat stills) is assembled
    // and capped in the Omni job's `buildCinematicReferences` (the anchor rows
    // may still be un-ready at queue time), so this stays a lower-bound hint.
    const referenceCount =
      (referenceAssetIds.protagonist ? 1 : 0) + (referenceAssetIds.setting ? 1 : 0);

    const promptHash = hashPrompt(beatTimeline);
    const now = Date.now();
    const model = resolveOmniModel();
    const assetId = await ctx.db.insert("assets", {
      accountId: args.accountId,
      saveId: args.saveId,
      ...(saveDoc.currentSceneId ? { sceneId: saveDoc.currentSceneId } : {}),
      kind: "cinematic" as const,
      provider: "gemini-omni" as const,
      url: "",
      status: "queued" as const,
      entitlementRequired: "pro" as const,
      cinematicTrigger: args.trigger,
      ...(args.endingId ? { endingId: args.endingId } : {}),
      hasAudio: false,
      promptHash,
      provenance: {
        provider: "gemini-omni",
        model,
        promptHash,
        promptRedacted: true,
        source: "generated",
        trigger: args.trigger,
        ...(args.endingId ? { endingId: args.endingId } : {}),
        referenceCount,
        durationSeconds: OMNI_DEFAULT_DURATION_S,
        resolution: OMNI_DEFAULT_RESOLUTION,
        aspectRatio: OMNI_DEFAULT_ASPECT,
        estimatedCostCents: OMNI_DEFAULT_DURATION_S * OMNI_CENTS_PER_SECOND,
      },
      safety: { action: "allow", categories: [], reason: "" },
      alt: cinematicAltText(args.trigger),
      tags: [
        "cinematic",
        `trigger:${args.trigger}`,
        ...(args.endingId ? [`ending:${args.endingId}`] : []),
      ],
      createdAt: now,
      updatedAt: now,
    });

    // Spend metering (design §2.3): an Omni endpoint cinematic is 240 sparks
    // (no image/video allowance applies — cinematics draw the spark grant
    // directly). Dev force-unlock bypasses billing. On an exhausted balance we
    // delete the queued row and degrade silently (the read loop / endings still
    // render — cinematics are strictly additive). `refundSpark` on
    // `_markCinematicFailed` reverses the debit.
    if (!devForceProMedia()) {
      const charge = await chargeMediaSpend(ctx, {
        accountId: args.accountId,
        chargeKind: "cinematic",
        sparkKind: "omni_cinematic",
        assetId,
        idempotencyKey: `spend:${assetId}`,
      });
      if (!charge.charged) {
        await ctx.db.delete(assetId);
        return { queued: false, reason: charge.reason } as const;
      }
    }

    // Double-fire guard: write the save doc so two concurrent queues for this
    // save serialize on it (both already read it via ctx.db.get above). Convex
    // OCC conflicts the loser on this WRITE — it retries, re-runs the dedupe
    // above (now seeing the row just inserted), and skips. This is what stops
    // the same-instant chapter double-fire the empty-range asset read can't.
    await ctx.db.patch(args.saveId, { lastCinematicQueuedAt: now });

    await ctx.scheduler.runAfter(0, ("media/cinematics:runOmniCinematicJob" as unknown) as any, {
      assetId,
      accountId: args.accountId,
      saveId: args.saveId,
      trigger: args.trigger,
      ...(args.endingId ? { endingId: args.endingId } : {}),
      beatTimeline,
      ...(referenceAssetIds.protagonist || referenceAssetIds.setting
        ? { referenceAssetIds }
        : {}),
      ...(posterUrl ? { posterUrl } : {}),
    });

    await insertCinematicAnalytics(ctx, {
      eventName: "cinematic.requested",
      accountId: args.accountId,
      saveId: args.saveId,
      ...(saveDoc.storyId ? { storyId: saveDoc.storyId } : {}),
      now,
      payload: {
        provider: "gemini-omni",
        trigger: args.trigger,
        ...(args.endingId ? { endingId: args.endingId } : {}),
        referenceCount,
        model,
      },
    });

    console.log(
      `[cinematics] queued+scheduled omni job trigger=${args.trigger} asset=${assetId} save=${args.saveId} scene=${saveDoc.currentSceneId ?? "none"} model=${model}`,
    );
    return { queued: true, assetId } as const;
  },
});

// ---------------------------------------------------------------------------
// Omni job: submit (this action) → poll (pollOmniCinematicJob).
// ---------------------------------------------------------------------------
export const runOmniCinematicJob = actionGeneric({
  args: {
    assetId: v.id("assets"),
    accountId,
    saveId,
    trigger: v.union(v.literal("opening"), v.literal("ending"), v.literal("chapter")),
    endingId: v.optional(v.string()),
    beatTimeline: v.string(),
    referenceAssetIds: v.optional(
      v.object({
        protagonist: v.optional(v.id("assets")),
        setting: v.optional(v.id("assets")),
      }),
    ),
    posterUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    await ctx.runMutation(
      ("media/cinematics:_markCinematicGenerating" as unknown) as any,
      { assetId: args.assetId, jobId: `omni_${startedAt}`, at: startedAt },
    );

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !omniConfigured()) {
      return finishOmniFallback(ctx, args, "omni_unconfigured");
    }

    try {
      // Build the FULL salience-ranked reference set for the save (anchors +
      // companions + key-beat stills). `saveId` drives the candidate gather; the
      // anchor ids are a defensive fallback when the save can't be read.
      const references = await buildCinematicReferences(ctx as any, {
        saveId: args.saveId,
        ...(args.referenceAssetIds?.protagonist
          ? { anchorProtagonistAssetId: args.referenceAssetIds.protagonist }
          : {}),
        ...(args.referenceAssetIds?.setting
          ? { anchorSettingAssetId: args.referenceAssetIds.setting }
          : {}),
      });
      const i2vStill = args.posterUrl ? await loadStillFromUrl(args.posterUrl) : null;

      const req: OmniCinematicRequest = {
        prompt: args.beatTimeline,
        references,
        i2vStill,
        durationSeconds: OMNI_DEFAULT_DURATION_S,
        resolution: OMNI_DEFAULT_RESOLUTION,
        aspectRatio: OMNI_DEFAULT_ASPECT,
        audio: true,
      };
      console.log(
        `[cinematics] omni submit asset=${args.assetId} trigger=${args.trigger} refs=${references.length} promptLen=${args.beatTimeline.length} i2v=${i2vStill ? "yes" : "no"}`,
      );
      const operationName = await submitOmniCinematic(apiKey, req);
      if (!operationName) {
        console.warn(`[cinematics] omni submit returned no operation name asset=${args.assetId} → fallback`);
        return finishOmniFallback(ctx, args, "omni_no_operation_name");
      }
      console.log(`[cinematics] omni submitted asset=${args.assetId} operation=${operationName}`);
      await ctx.runMutation(
        ("media/cinematics:_recordOmniOperation" as unknown) as any,
        { assetId: args.assetId, operationName, attempt: 0, at: Date.now() },
      );
      await ctx.scheduler.runAfter(
        OMNI_POLL_INTERVAL_MS,
        ("media/cinematics:pollOmniCinematicJob" as unknown) as any,
        {
          assetId: args.assetId,
          accountId: args.accountId,
          saveId: args.saveId,
          trigger: args.trigger,
          ...(args.endingId ? { endingId: args.endingId } : {}),
          ...(args.posterUrl ? { posterUrl: args.posterUrl } : {}),
        },
      );
      return { submitted: true } as const;
    } catch (err) {
      const message = err instanceof Error ? err.message : "omni_submit_failed";
      console.warn(`[cinematics] runOmniCinematicJob failed asset=${args.assetId} error=${message}`);
      return finishOmniFallback(ctx, args, message);
    }
  },
});

export const pollOmniCinematicJob = actionGeneric({
  args: {
    assetId: v.id("assets"),
    accountId,
    saveId,
    trigger: v.union(v.literal("opening"), v.literal("ending"), v.literal("chapter")),
    endingId: v.optional(v.string()),
    posterUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return finishOmniFallback(ctx, args, "omni_no_api_key");

    const snapshot = (await ctx.runQuery(
      ("media/cinematics:_getOmniOperation" as unknown) as any,
      { assetId: args.assetId },
    )) as { operationName?: string; attempt?: number } | null;
    const operationName = snapshot?.operationName;
    const attempt = snapshot?.attempt ?? 0;
    if (!operationName) return finishOmniFallback(ctx, args, "omni_operation_missing");

    try {
      const result = await pollOmniCinematic(apiKey, operationName);
      console.log(
        `[cinematics] omni poll asset=${args.assetId} kind=${result.kind} attempt=${attempt}/${OMNI_MAX_POLLS}`,
      );
      if (result.kind === "pending") {
        const nextAttempt = attempt + 1;
        if (nextAttempt >= OMNI_MAX_POLLS) {
          return finishOmniFallback(ctx, args, "omni_timeout");
        }
        await ctx.runMutation(
          ("media/cinematics:_recordOmniOperation" as unknown) as any,
          { assetId: args.assetId, operationName, attempt: nextAttempt, at: Date.now() },
        );
        await ctx.scheduler.runAfter(
          OMNI_POLL_INTERVAL_MS,
          ("media/cinematics:pollOmniCinematicJob" as unknown) as any,
          {
            assetId: args.assetId,
            accountId: args.accountId,
            saveId: args.saveId,
            trigger: args.trigger,
            ...(args.endingId ? { endingId: args.endingId } : {}),
            ...(args.posterUrl ? { posterUrl: args.posterUrl } : {}),
          },
        );
        return { pending: true, attempt: nextAttempt } as const;
      }
      if (result.kind === "error") {
        return finishOmniFallback(ctx, args, result.error);
      }
      // ready — persist the video (+ native audio track) to Convex storage so
      // the client never sees the API key (the Omni download URI is keyless and
      // must be fetched server-side with the key).
      let url: string | null = null;
      try {
        let bytes: Uint8Array | null = null;
        if (result.videoBytesBase64) {
          bytes = decodeBase64ToUint8Array(result.videoBytesBase64);
        } else if (result.videoUri) {
          const res = await fetch(result.videoUri, { headers: { "x-goog-api-key": apiKey } });
          if (res.ok) bytes = new Uint8Array(await res.arrayBuffer());
          else console.warn(`[cinematics] video download ${res.status} asset=${args.assetId}`);
        }
        if (bytes && bytes.length > 0) {
          const blob = new Blob([bytes as unknown as BlobPart], { type: "video/mp4" });
          const storageId = await (ctx as any).storage.store(blob);
          const rawUrl = (await (ctx as any).storage.getUrl(storageId)) as string;
          url = rewriteToPublicOrigin(rawUrl);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "omni_store_failed";
        console.warn(`[cinematics] persist failed asset=${args.assetId} error=${message}`);
      }
      if (!url) return finishOmniFallback(ctx, args, "omni_no_output");

      console.log(
        `[cinematics] omni READY (video) asset=${args.assetId} trigger=${args.trigger} hasAudio=${result.hasAudio === true} url=${url}`,
      );
      await ctx.runMutation(
        ("media/cinematics:_markCinematicReady" as unknown) as any,
        {
          assetId: args.assetId,
          url,
          hasAudio: result.hasAudio === true,
          synthId: true,
          at: Date.now(),
        },
      );
      await ctx.runMutation(
        ("media/cinematics:_emitCinematicEvent" as unknown) as any,
        {
          eventName: "cinematic.completed",
          accountId: args.accountId,
          saveId: args.saveId,
          trigger: args.trigger,
          ...(args.endingId ? { endingId: args.endingId } : {}),
          hasAudio: result.hasAudio === true,
          at: Date.now(),
        },
      );
      return { ready: true } as const;
    } catch (err) {
      const message = err instanceof Error ? err.message : "omni_poll_failed";
      return finishOmniFallback(ctx, args, message);
    }
  },
});

// Shared fallback tail for every Omni failure branch. Picks a poster still
// (P1) or marks the asset failed, then emits `cinematic.fallback`. NEVER
// throws — this is the last thing standing between a provider hiccup and the
// read loop.
async function finishOmniFallback(
  ctx: { runMutation: (ref: any, args: any) => Promise<any> },
  args: {
    assetId: string;
    accountId: string;
    saveId: string;
    trigger: CinematicTrigger;
    endingId?: string;
    posterUrl?: string;
  },
  reason: string,
): Promise<{ fallback: true; reason: string }> {
  console.warn(`[cinematics] fallback asset=${args.assetId} trigger=${args.trigger} reason=${reason}`);
  try {
    const fallback = selectCinematicFallback({ posterUrl: args.posterUrl });
    if (fallback.kind === "still") {
      await ctx.runMutation(
        ("media/cinematics:_markCinematicReady" as unknown) as any,
        {
          assetId: args.assetId,
          url: fallback.url,
          hasAudio: false,
          synthId: false,
          fallbackKind: "still",
          fallbackReason: reason,
          at: Date.now(),
        },
      );
    } else {
      await ctx.runMutation(
        ("media/cinematics:_markCinematicFailed" as unknown) as any,
        { assetId: args.assetId, error: reason, at: Date.now() },
      );
    }
    await ctx.runMutation(
      ("media/cinematics:_emitCinematicEvent" as unknown) as any,
      {
        eventName: "cinematic.fallback",
        accountId: args.accountId,
        saveId: args.saveId,
        trigger: args.trigger,
        ...(args.endingId ? { endingId: args.endingId } : {}),
        reason,
        fallbackKind: fallback.kind,
        at: Date.now(),
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "fallback_failed";
    console.warn(`[cinematics] finishOmniFallback failed asset=${args.assetId} error=${message}`);
  }
  return { fallback: true, reason };
}

// ---------------------------------------------------------------------------
// Internal mutations / queries (server-only; underscore-prefixed).
// ---------------------------------------------------------------------------
export const _markCinematicGenerating = internalMutationGeneric({
  args: { assetId: v.id("assets"), jobId: v.string(), at: v.number() },
  handler: async (ctx, args) => {
    const asset = (await ctx.db.get(args.assetId)) as CinematicAssetDoc | null;
    if (!asset) return;
    await ctx.db.patch(args.assetId, {
      status: "generating",
      provenance: { ...asset.provenance, jobId: args.jobId },
      updatedAt: args.at,
    });
  },
});

export const _markCinematicReady = internalMutationGeneric({
  args: {
    assetId: v.id("assets"),
    url: v.string(),
    hasAudio: v.boolean(),
    synthId: v.boolean(),
    fallbackKind: v.optional(v.string()),
    fallbackReason: v.optional(v.string()),
    at: v.number(),
  },
  handler: async (ctx, args) => {
    const asset = (await ctx.db.get(args.assetId)) as CinematicAssetDoc | null;
    if (!asset) return;
    await ctx.db.patch(args.assetId, {
      status: "ready",
      url: args.url,
      hasAudio: args.hasAudio,
      provenance: {
        ...asset.provenance,
        synthId: args.synthId,
        ...(args.fallbackKind ? { fallbackKind: args.fallbackKind } : {}),
        ...(args.fallbackReason ? { fallbackReason: args.fallbackReason } : {}),
      },
      updatedAt: args.at,
      readyAt: args.at,
    });
  },
});

export const _markCinematicFailed = internalMutationGeneric({
  args: { assetId: v.id("assets"), error: v.string(), at: v.number() },
  handler: async (ctx, args) => {
    const asset = (await ctx.db.get(args.assetId)) as CinematicAssetDoc | null;
    if (!asset) return;
    await ctx.db.patch(args.assetId, {
      status: "failed",
      provenance: { ...asset.provenance, errorCode: args.error },
      updatedAt: args.at,
    });
    // Refund the 240 sparks a failed cinematic was charged (design §2.3).
    // Idempotent; a no-op when the spend was bypassed (dev force-unlock).
    await refundSpark(ctx, args.assetId);
  },
});

export const _recordOmniOperation = internalMutationGeneric({
  args: {
    assetId: v.id("assets"),
    operationName: v.string(),
    attempt: v.number(),
    at: v.number(),
  },
  handler: async (ctx, args) => {
    const asset = (await ctx.db.get(args.assetId)) as CinematicAssetDoc | null;
    if (!asset) return;
    await ctx.db.patch(args.assetId, {
      provenance: {
        ...asset.provenance,
        omniOperationName: args.operationName,
        omniAttempt: args.attempt,
      },
      updatedAt: args.at,
    });
  },
});

export const _getOmniOperation = queryGeneric({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    const asset = (await ctx.db.get(args.assetId)) as CinematicAssetDoc | null;
    if (!asset) return null;
    const prov = asset.provenance;
    return {
      operationName: typeof prov.omniOperationName === "string" ? prov.omniOperationName : undefined,
      attempt: typeof prov.omniAttempt === "number" ? prov.omniAttempt : 0,
    };
  },
});

// Internal mutation wrapper so the Omni actions can emit analytics rows
// (actions have no ctx.db). Mirrors game.ts's insert-and-swallow pattern.
export const _emitCinematicEvent = internalMutationGeneric({
  args: {
    eventName: v.string(),
    accountId: v.optional(v.string()),
    saveId: v.optional(v.string()),
    storyId: v.optional(v.string()),
    trigger: v.optional(v.string()),
    endingId: v.optional(v.string()),
    hasAudio: v.optional(v.boolean()),
    reason: v.optional(v.string()),
    fallbackKind: v.optional(v.string()),
    at: v.number(),
  },
  handler: async (ctx, args) => {
    await insertCinematicAnalytics(ctx, {
      eventName: args.eventName,
      ...(args.accountId ? { accountId: args.accountId } : {}),
      ...(args.saveId ? { saveId: args.saveId } : {}),
      ...(args.storyId ? { storyId: args.storyId } : {}),
      now: args.at,
      payload: {
        provider: "gemini-omni",
        ...(args.trigger ? { trigger: args.trigger } : {}),
        ...(args.endingId ? { endingId: args.endingId } : {}),
        ...(args.hasAudio === undefined ? {} : { hasAudio: args.hasAudio }),
        ...(args.reason ? { reason: args.reason } : {}),
        ...(args.fallbackKind ? { fallbackKind: args.fallbackKind } : {}),
      },
    });
  },
});

// ---------------------------------------------------------------------------
// Local helpers.
// ---------------------------------------------------------------------------

// Best-effort poster still for the endpoint scene: the ready scene image for
// the current scene, if any. Used for the four-state UI and the Omni fallback.
async function resolvePosterStillUrl(
  ctx: { db: any },
  sceneId: string | undefined,
): Promise<string | null> {
  if (!sceneId) return null;
  try {
    const docs = (await ctx.db
      .query("assets")
      .withIndex("by_scene", (q: any) => q.eq("sceneId", sceneId))
      .collect()) as CinematicAssetDoc[];
    const ready = docs.find(
      (a) => a.kind === "image" && a.status === "ready" && typeof a.url === "string" && a.url.length > 0,
    );
    return ready?.url ?? null;
  } catch {
    return null;
  }
}

async function loadStillFromUrl(url: string): Promise<OmniReference | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const mimeType = res.headers.get("content-type") || "image/png";
    return { bytesBase64: encodeUint8ArrayToBase64(new Uint8Array(buffer)), mimeType };
  } catch {
    return null;
  }
}

// Insert a `cinematic.*` analytics row. `buildAnalyticsEvent` only validates
// the event-name FORMAT (not the union), so the cast is safe; the dashboard
// treats unknown event names as extra rows and ignores them. Best-effort.
async function insertCinematicAnalytics(
  ctx: { db: { insert: (table: string, doc: any) => Promise<any> } },
  input: {
    // Free-form `cinematic.*` name — buildAnalyticsEvent validates the FORMAT
    // (not the union), so we cast at the boundary. The dashboard treats unknown
    // event names as extra rows and ignores them (Req 11.4).
    eventName: string;
    accountId?: string;
    saveId?: string;
    storyId?: string;
    now: number;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await ctx.db.insert(
      "analytics_events",
      buildAnalyticsEvent({
        eventName: input.eventName as AnalyticsMetricName,
        ...(input.accountId ? { accountId: input.accountId } : {}),
        ...(input.saveId ? { saveId: input.saveId } : {}),
        ...(input.storyId ? { storyId: input.storyId } : {}),
        payload: input.payload,
        createdAt: input.now,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[cinematics] analytics insert failed event=${input.eventName} error=${message.slice(0, 200)}`);
  }
}

// Encode a Uint8Array as base64 (chunked to dodge the V8 spread arg limit).
// Mirrors sceneMedia's private encoder — kept local so this module doesn't
// import a private from the scene pipeline.
function encodeUint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...(chunk as unknown as number[]));
  }
  return btoa(binary);
}
