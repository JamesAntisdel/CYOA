// Scene-media wiring for Pro reads. Pieces:
//
//   1. `queueSceneImage` (mutation) — invoked by completeSceneStream
//      after prose lands. Gates on Pro entitlement (or
//      CYOA_DEV_FORCE_PRO_MEDIA=1 for local dev). Inserts a queued asset
//      and schedules the imagen run action.
//   2. `runImagenJob` (action) — picks the queued asset up,
//      drives it through generating → ready. In dev, falls back to a
//      deterministic Picsum placeholder so the MediaPlate actually
//      shows something. Real Imagen lights up when VERTEX_PROJECT_ID +
//      VERTEX_ACCESS_TOKEN are present.
//   3. `queueSceneVideo` (mutation) — analog of queueSceneImage for
//      Veo 3.1 lite. Inserts a queued video asset and schedules
//      `runVeoJob`. Skipped when a non-failed video already exists.
//   4. `runVeoJob` (action) — submits a Veo predictLongRunning request,
//      persists the operationName on the asset, and schedules
//      `pollVeoJob` to check completion later. `pollVeoJob` re-schedules
//      itself up to VEO_MAX_POLLS times. On success marks the asset
//      ready with the returned video URI. On timeout / no key, the
//      asset is marked failed so MediaPlate holds at Image-ready
//      (reduced-motion fallback).
//   5. `getSceneMedia` (public query) — what the client polls/subscribes
//      to so MediaPlate can advance from Skeleton → Image → Video.
//
// All five live in this file so the wiring is in one place.

import { v } from "convex/values";
import {
  actionGeneric,
  internalMutationGeneric,
  mutationGeneric,
  queryGeneric,
} from "convex/server";

import { AppError } from "../lib/errors";
import { assertAccountSessionAccess } from "../lib/authz";
import { assertCanAccessSave, type SaveRecord } from "../saves";
import { resolveMediaPrefs, type AccountRecord, type MediaPrefs } from "../account";
import { devForceProMedia } from "./proMediaGate";
import { chargeMediaSpend, refundSpark } from "../billing/mediaCredits";
import {
  hashPrompt,
  projectSceneMedia,
  type AssetRecord,
  type AssetStatus,
  type SceneMediaProjection,
} from "../assets";
import { mapVoiceIdToGoogleTts } from "../llm/ttsVoices";
import {
  decodeBase64ToUint8Array,
  maybeRunImagen,
  rewriteToPublicOrigin,
} from "./imagenClient";
import { resolveGeminiImageModel, runGeminiImage, type GeminiImageReference } from "./geminiImageClient";
import { resolveMediaStrategy } from "./mediaStrategy";

const accountId = v.id("accounts");
const saveId = v.id("saves");

type AssetDoc = {
  _id: string;
  accountId: string;
  saveId?: string;
  taleId?: string;
  sceneId?: string;
  nodeId?: string;
  kind: "image" | "video" | "audio";
  provider: "vertex-imagen" | "vertex-veo" | "gemini-veo" | "google-tts" | "uploaded";
  url: string;
  status: AssetStatus;
  entitlementRequired: "pro";
  promptHash: string;
  provenance: Record<string, unknown>;
  safety: Record<string, unknown>;
  alt?: string;
  tags?: string[];
  durationMs?: number;
  createdAt: number;
  updatedAt?: number;
  readyAt?: number;
};


// Per-account modality gates from the settings screen. When a reader toggles
// "Show illustrations" / "Play narration & ambient audio" / "Play scene
// cinematics" off, the matching queue mutation must short-circuit BEFORE
// any provider call so the Imagen / Veo / Google TTS bill stops too. Reads
// the account row's `mediaPrefs` and defaults each modality to enabled when
// the field is absent (legacy accounts pre-date the toggles).
//
// Returns the resolved `MediaPrefs` object so the caller can also log
// which gate fired — useful in prod where we want to grep for spend-saving
// skips by reason.
async function getAccountMediaPrefs(
  ctx: { db: { get: (id: any) => Promise<unknown> } },
  accountId: string,
): Promise<MediaPrefs> {
  const doc = (await ctx.db.get(accountId)) as { mediaPrefs?: MediaPrefs } | null;
  if (!doc) return resolveMediaPrefs({});
  return resolveMediaPrefs(doc);
}

// =============================================================================
// Character-consistency identity injection (design 2026-07-12 §3.1/§3.2).
//
// The single load-bearing fix against frame-to-frame character drift: the SAME
// identity words on EVERY render. Read defensively off the opaque
// `story_bibles.bible` JSON (structural, not the engine type — MEDIA does not
// depend on engine's parser, and a legacy bible with no `protagonist` simply
// yields an empty prefix → byte-identical to today's prompt, BC5).
// =============================================================================

// Structural view of `bible.protagonist` — every field is unknown because the
// bible is stored opaquely; we clamp/guard defensively at read time.
type BibleProtagonistLike = {
  name?: unknown;
  gender?: unknown;
  pronouns?: unknown;
  appearance?: unknown;
  voice?: unknown;
};

// Structural view of a `bible.cast` entry. `id`/`label` drive the tolerant
// match against a scene's rostered NPC ids; `appearance` is the descriptor
// baked into the image prompt so the same NPC keeps one look across scenes.
type BibleCastLike = {
  id?: unknown;
  label?: unknown;
  name?: unknown;
  appearance?: unknown;
};

const IDENTITY_APPEARANCE_MAX = 6;
// Up to this many NPC portraits ride along as scene-render references
// (protagonist + setting already consume two of geminiImageClient's four
// reference slots).
const SCENE_NPC_REFERENCE_MAX = 2;

function normalizeRef(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Resolve the bible cast entries named by this scene's rostered NPC mentions.
// Tolerant match on id OR label (the mention list is npc ids from
// save.state.npcs, which may or may not equal the bible cast id). Pure +
// exported for unit testing.
export function resolvePresentCast(
  cast: ReadonlyArray<BibleCastLike>,
  npcMentions: ReadonlyArray<string>,
): BibleCastLike[] {
  if (npcMentions.length === 0) return [];
  const wanted = new Set(
    npcMentions.map((m) => normalizeRef(m)).filter((m) => m.length > 0),
  );
  if (wanted.size === 0) return [];
  const out: BibleCastLike[] = [];
  for (const member of cast) {
    const id = typeof member.id === "string" ? normalizeRef(member.id) : "";
    const label = typeof member.label === "string" ? normalizeRef(member.label) : "";
    const name = typeof member.name === "string" ? normalizeRef(member.name) : "";
    if ((id && wanted.has(id)) || (label && wanted.has(label)) || (name && wanted.has(name))) {
      out.push(member);
    }
  }
  return out;
}

// Build the identity prefix prepended to EVERY scene image/veo prompt. Because
// it rides in the prompt TEXT (not the reference bytes), it survives every
// fallback path — the reference-less Imagen-only render and the text-only Veo
// call both carry the descriptor. Returns "" when there is no protagonist and
// no matched cast (→ prompt is byte-identical to today, legacy-tolerant). Pure
// + exported so a unit test can pin that the SAME protagonist yields the SAME
// string across turns.
export function buildImageIdentityPrefix(
  protagonist: BibleProtagonistLike | null | undefined,
  presentCast: ReadonlyArray<BibleCastLike>,
): string {
  const segments: string[] = [];

  if (
    protagonist &&
    typeof protagonist.name === "string" &&
    protagonist.name.trim().length > 0
  ) {
    const name = protagonist.name.trim();
    const gender = typeof protagonist.gender === "string" ? protagonist.gender.trim() : "";
    const pronouns =
      typeof protagonist.pronouns === "string" ? protagonist.pronouns.trim() : "";
    const appearance = Array.isArray(protagonist.appearance)
      ? protagonist.appearance
          .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
          .map((d) => d.trim())
          .slice(0, IDENTITY_APPEARANCE_MAX)
      : [];
    const genderPart = gender ? `, ${gender}` : "";
    const pronounPart = pronouns ? ` (${pronouns})` : "";
    const looksPart = appearance.length > 0 ? `, ${appearance.join(", ")}` : "";
    segments.push(`Protagonist — ${name}${genderPart}${pronounPart}${looksPart}`);
  }

  for (const member of presentCast) {
    const label =
      typeof member.label === "string" && member.label.trim().length > 0
        ? member.label.trim()
        : typeof member.name === "string"
          ? member.name.trim()
          : "";
    const appearance =
      typeof member.appearance === "string" ? member.appearance.trim() : "";
    if (!label || !appearance) continue;
    segments.push(`${label} — ${appearance}`);
  }

  if (segments.length === 0) return "";
  return `CHARACTERS (render exactly, do not restyle): ${segments.join("; ")}.`;
}

// Descriptor prompt for a lazily-backfilled protagonist anchor (design §3.3):
// when a run's turn-1 anchor died, a later turn re-queues one off the bible's
// protagonist identity so scenes stop rendering reference-less. Returns null
// when there is no usable name.
function buildProtagonistAnchorPrompt(protagonist: BibleProtagonistLike): string | null {
  const name = typeof protagonist.name === "string" ? protagonist.name.trim() : "";
  if (!name) return null;
  const gender = typeof protagonist.gender === "string" ? protagonist.gender.trim() : "";
  const appearance = Array.isArray(protagonist.appearance)
    ? protagonist.appearance
        .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
        .map((d) => d.trim())
        .slice(0, IDENTITY_APPEARANCE_MAX)
    : [];
  const looks = appearance.length > 0 ? ` ${appearance.join(", ")}.` : "";
  return `Character reference portrait, 1:1, head-and-shoulders close-up. ${name}${
    gender ? `, ${gender}` : ""
  }.${looks} Neutral background, consistent art style.`;
}

// Read the save's bible (protagonist + cast) off the opaque story_bibles row.
// Best-effort: a missing table / not-ready row / absent bible object → null,
// which yields an empty identity prefix and no NPC-appearance descriptors.
async function readSaveBibleIdentity(
  ctx: { db: any },
  saveIdValue: string,
): Promise<{ protagonist?: BibleProtagonistLike; cast: BibleCastLike[] } | null> {
  try {
    const row = await ctx.db
      .query("story_bibles")
      .withIndex("by_saveId", (q: any) => q.eq("saveId", saveIdValue))
      .first();
    if (!row || (row as { status?: string }).status !== "ready") return null;
    const bible = (row as { bible?: unknown }).bible;
    if (!bible || typeof bible !== "object") return null;
    const b = bible as { protagonist?: unknown; cast?: unknown };
    const cast = Array.isArray(b.cast) ? (b.cast as BibleCastLike[]) : [];
    const protagonist =
      b.protagonist && typeof b.protagonist === "object"
        ? (b.protagonist as BibleProtagonistLike)
        : undefined;
    return { ...(protagonist ? { protagonist } : {}), cast };
  } catch {
    return null;
  }
}

export const queueSceneImage = internalMutationGeneric({
  args: {
    accountId,
    saveId,
    sceneId: v.id("scenes"),
    prompt: v.string(),
    nodeId: v.optional(v.string()),
    alt: v.optional(v.string()),
    // Rostered NPC ids named in this scene (from the streamed proposal's
    // `npcMentions`). Drives (a) which bible cast appearance descriptors are
    // baked into the image prompt and (b) which NPC portraits ride along as
    // scene-render references. Optional so older/unwired callers behave
    // exactly as today (empty → no identity NPCs). SERVER wires it in game.ts.
    npcMentions: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new AppError("account_not_found");

    // Pro gate. Real path: lookup current entitlement and require pro+active.
    // Dev override: env flag short-circuits the check.
    if (!devForceProMedia()) {
      const entitlement = await ctx.db
        .query("entitlements")
        .withIndex("by_accountId", (q: any) => q.eq("accountId", args.accountId))
        .first();
      if (!entitlement || entitlement.tier !== "pro" || entitlement.status !== "active") {
        return { queued: false, reason: "pro_entitlement_required" } as const;
      }
    }

    // Reader's per-modality gate from /settings. When "Show illustrations"
    // is off we never schedule Imagen — saving the per-image spend. Cheap
    // before the existing-asset query.
    const mediaPrefs = await getAccountMediaPrefs(ctx, args.accountId);
    if (!mediaPrefs.imagesEnabled) {
      console.log(
        `[sceneMedia] queueSceneImage skipped: imagesEnabled=false account=${args.accountId} scene=${args.sceneId}`,
      );
      // Cinematics are normally chained from runImagenJob's post-image step,
      // which we're skipping here. If the reader disabled images but LEFT
      // "Play scene cinematics" on, queue the video directly (text-only Veo —
      // there's no i2v still to seed it) so a video-enabled reader doesn't
      // silently lose the modality they kept on. queueSceneVideo re-checks the
      // pro gate + videoEnabled + strategy, so scheduling it here is safe.
      //
      // Per-scene Veo is the LEGACY behavior only (omni-cinematics Req 1.2):
      // under endpoint_cinematic / stills_only / off the per-turn clip is
      // retired (endpoint cinematics carry the video budget), so we don't even
      // schedule the mutation. Stills are unaffected by this branch.
      const imgOffStrategy = await resolveMediaStrategy(ctx, args.accountId);
      if (mediaPrefs.videoEnabled && imgOffStrategy === "per_scene_legacy") {
        await ctx.scheduler.runAfter(0, ("media/sceneMedia:queueSceneVideo" as unknown) as any, {
          accountId: args.accountId,
          saveId: args.saveId,
          sceneId: args.sceneId,
          ...(args.nodeId ? { nodeId: args.nodeId } : {}),
          ...(args.alt ? { alt: args.alt } : {}),
          prompt: args.prompt,
        });
      }
      return { queued: false, reason: "images_disabled_by_user" } as const;
    }

    // Skip if a non-failed image asset already exists for this scene.
    const existing = await ctx.db
      .query("assets")
      .withIndex("by_scene", (q: any) => q.eq("sceneId", args.sceneId))
      .collect();
    if (existing.some((a: AssetDoc) => a.kind === "image" && a.status !== "failed")) {
      return { queued: false, reason: "already_queued" } as const;
    }

    const promptHash = hashPrompt(args.prompt);
    const now = Date.now();
    const assetId = await ctx.db.insert("assets", {
      accountId: args.accountId,
      saveId: args.saveId,
      sceneId: args.sceneId,
      ...(args.nodeId ? { nodeId: args.nodeId } : {}),
      kind: "image" as const,
      provider: "vertex-imagen" as const,
      url: "",
      status: "queued" as const,
      entitlementRequired: "pro" as const,
      promptHash,
      provenance: {
        provider: "vertex-imagen",
        // Provenance records the model that the action will actually use.
        // GEMINI_IMAGE_MODEL overrides the default; the action and this
        // record must stay in sync.
        model: process.env.GEMINI_IMAGE_MODEL ?? "imagen-4.0-fast-generate-001",
        promptHash,
        promptRedacted: true,
        source: "generated",
      },
      safety: { action: "allow", categories: [], reason: "" },
      ...(args.alt ? { alt: args.alt } : {}),
      tags: [],
      createdAt: now,
      updatedAt: now,
    });

    // Spend metering (design §2.3): Pro monthly image allowance first, then
    // sparks. Skipped under the dev force-unlock (billing bypassed for local).
    // On an exhausted balance we drop the media (delete the queued row) rather
    // than fail the turn. `refundSpark` on markFailed reverses the debit.
    if (!devForceProMedia()) {
      const charge = await chargeMediaSpend(ctx, {
        accountId: args.accountId,
        chargeKind: "image",
        sparkKind: "scene_still",
        assetId,
        idempotencyKey: `spend:${assetId}`,
      });
      if (!charge.charged) {
        await ctx.db.delete(assetId);
        return { queued: false, reason: charge.reason } as const;
      }
    }

    // Resolve anchor asset ids for the reference-image carry-over pipeline.
    // The two anchors are generated on turn 1 (see queueAnchorImage); every
    // subsequent scene-image call passes them as reference inputs to
    // Gemini Flash Image so character + setting stay consistent.
    // Race-tolerant: anchors might still be queuing/generating when scene 2
    // fires, in which case the asset row exists but `status !== "ready"`.
    // We only pass references whose underlying storage bytes are already
    // available; runImagenJob double-checks at fetch time and silently
    // drops missing ones (fall back to no-reference render).
    const saveDoc = await ctx.db.get(args.saveId);
    const protoId = (saveDoc as { anchorProtagonistAssetId?: string } | null)?.anchorProtagonistAssetId;
    const settingId = (saveDoc as { anchorSettingAssetId?: string } | null)?.anchorSettingAssetId;

    // §3.2: portraits of NPCs named in THIS scene ride along as additional
    // scene-render references so a rostered NPC keeps ONE face across scenes.
    // Resolve save.state.npcs[id].portraitAssetId for each mention; cap to
    // SCENE_NPC_REFERENCE_MAX (protagonist + setting already take two of
    // geminiImageClient's four reference slots). Not-ready portraits are
    // silently dropped downstream by loadReferenceBytes (tolerant).
    const npcMentions = args.npcMentions ?? [];
    const npcRoster =
      (saveDoc as { state?: { npcs?: Record<string, { portraitAssetId?: string }> } } | null)
        ?.state?.npcs ?? {};
    const npcPortraitIds: string[] = [];
    for (const npcId of npcMentions) {
      const portraitId = npcRoster[npcId]?.portraitAssetId;
      if (
        typeof portraitId === "string" &&
        portraitId.length > 0 &&
        !npcPortraitIds.includes(portraitId)
      ) {
        npcPortraitIds.push(portraitId);
      }
      if (npcPortraitIds.length >= SCENE_NPC_REFERENCE_MAX) break;
    }

    const referenceAssetIds: { protagonist?: string; setting?: string; npcs?: string[] } = {
      ...(protoId ? { protagonist: protoId } : {}),
      ...(settingId ? { setting: settingId } : {}),
      ...(npcPortraitIds.length > 0 ? { npcs: npcPortraitIds } : {}),
    };

    // §3.1: read the save's bible and build the fixed identity prefix. This
    // prepends the SAME protagonist + named-NPC descriptors to the prompt on
    // EVERY render, so identity survives even the reference-less fallbacks.
    // Absent bible/protagonist → empty prefix → byte-identical to today (BC5).
    const bibleIdentity = await readSaveBibleIdentity(ctx, args.saveId);
    const presentCast = bibleIdentity
      ? resolvePresentCast(bibleIdentity.cast, npcMentions)
      : [];
    const identityPrefix = bibleIdentity
      ? buildImageIdentityPrefix(bibleIdentity.protagonist, presentCast)
      : "";
    const effectivePrompt = identityPrefix
      ? `${identityPrefix}\n${args.prompt}`
      : args.prompt;

    // §3.3 lazy anchor backfill: a run whose turn-1 protagonist anchor died (or
    // was never queued) is still un-anchored on turn 2+, so every later scene
    // renders reference-less = full drift. When we're past turn 1, the
    // protagonist anchor is still unset, and the bible carries a protagonist,
    // queue an anchor from the bible descriptor (queueAnchorImage is idempotent
    // on the save pointer). Best-effort — never blocks the still (BC5).
    const saveTurn = (saveDoc as { turnNumber?: number } | null)?.turnNumber ?? 0;
    if (saveTurn > 0 && !protoId && bibleIdentity?.protagonist) {
      const anchorPrompt = buildProtagonistAnchorPrompt(bibleIdentity.protagonist);
      if (anchorPrompt) {
        try {
          await ctx.scheduler.runAfter(
            0,
            ("media/sceneMedia:queueAnchorImage" as unknown) as any,
            {
              accountId: args.accountId,
              saveId: args.saveId,
              kind: "protagonist" as const,
              prompt: anchorPrompt,
            },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : "anchor_backfill_failed";
          console.warn(`[sceneMedia] lazy protagonist anchor backfill failed: ${message}`);
        }
      }
    }

    // Per-scene Veo is the LEGACY behavior only (omni-cinematics Req 1.2). Under
    // endpoint_cinematic / stills_only / off, the per-turn clip is retired — the
    // still is still produced (it feeds the cinematic reference set), but the
    // post-Imagen Veo chain must NOT be scheduled. Resolve the effective
    // strategy here (mutation has ctx.db) and pass a flag; runImagenJob (an
    // action, no ctx.db) can't resolve it itself.
    const strategy = await resolveMediaStrategy(ctx, args.accountId);
    const videoAllowed = strategy === "per_scene_legacy";

    // Kick off the async job. runAfter(0) puts it on the next tick. We
    // pass the full scene context so runImagenJob can chain into
    // queueSceneVideo with the resulting image's storageId (i2v) once
    // bytes are stored — that's the whole point of doing image first.
    await ctx.scheduler.runAfter(0, ("media/sceneMedia:runImagenJob" as unknown) as any, {
      assetId,
      // Identity-prefixed prompt so the fixed protagonist + named-NPC
      // descriptors ride through every downstream path (Gemini reference
      // render, Imagen-only fallback, text-only Veo).
      prompt: effectivePrompt,
      accountId: args.accountId,
      saveId: args.saveId,
      sceneId: args.sceneId,
      ...(args.nodeId ? { nodeId: args.nodeId } : {}),
      ...(args.alt ? { alt: args.alt } : {}),
      ...(referenceAssetIds.protagonist || referenceAssetIds.setting || referenceAssetIds.npcs
        ? { referenceAssetIds }
        : {}),
      videoAllowed,
    });

    return { queued: true, assetId } as const;
  },
});

export const runImagenJob = actionGeneric({
  args: {
    assetId: v.id("assets"),
    prompt: v.string(),
    // Context for the post-Imagen Veo chain. When present, this action
    // queues the video itself (with imageStorageId when bytes were
    // stored) instead of relying on queueSceneMediaForSave's old
    // parallel scheduling. The fields are optional so older in-flight
    // schedules from before this change still complete cleanly.
    accountId: v.optional(accountId),
    saveId: v.optional(saveId),
    sceneId: v.optional(v.id("scenes")),
    nodeId: v.optional(v.string()),
    alt: v.optional(v.string()),
    // Reference-image carry-over inputs. When present, the action loads
    // the storage bytes for each anchor and passes them to Gemini 2.5
    // Flash Image so the generated scene image maintains protagonist +
    // setting consistency. The validators accept either the typed
    // `_storage` id or a string for forward compatibility; we coerce
    // both before fetching.
    referenceAssetIds: v.optional(
      v.object({
        protagonist: v.optional(v.id("assets")),
        setting: v.optional(v.id("assets")),
        // §3.2: portraits of NPCs named in the scene, loaded as additional
        // references so a rostered NPC keeps one face across scenes.
        npcs: v.optional(v.array(v.id("assets"))),
      }),
    ),
    // Omni-cinematics Req 1.2: whether the post-Imagen Veo chain may run.
    // `false` under endpoint_cinematic / stills_only / off (per-scene video
    // retired). Absent (older in-flight schedules) → treated as allowed, and
    // queueSceneVideo re-checks the strategy as a backstop.
    videoAllowed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    // Mark generating.
    await ctx.runMutation(
      ("media/sceneMedia:markGenerating" as unknown) as any,
      { assetId: args.assetId, jobId: `imagen_${now}`, at: now },
    );

    // Live image path. Preference order:
    //   1. Gemini Flash Image with reference anchors (carry-over). This
    //      is the path that gives us protagonist + setting consistency
    //      across scenes. References might still be queuing on turn 2;
    //      `loadReferenceBytes` returns only the anchors whose underlying
    //      storage bytes are ready, falling back to no-reference render
    //      otherwise.
    //   2. Imagen 4 fast (legacy `maybeRunImagen` path) — used when Gemini
    //      Flash Image returns null (no key, API error, empty response).
    //   3. Picsum placeholder — used when both providers come back empty.
    //
    // Bad-key / API outage shouldn't be fatal: dev still gets a picture,
    // and the failure is logged for operators.
    let liveUrl: string | null = null;
    let liveError: string | null = null;
    // Lifted out of the try block so the post-Imagen Veo queue can pass
    // it as the i2v first-frame reference when bytes were stored. Stays
    // null when Imagen falls back to placeholder — Veo then runs
    // text-only, preserving today's behavior for the no-key case.
    let imageStorageId: string | null = null;
    try {
      // Resolve references first so Gemini Flash Image has them on hand.
      const referenceImages = args.referenceAssetIds
        ? await loadReferenceBytes(ctx, args.referenceAssetIds)
        : [];
      const geminiKey = process.env.GEMINI_API_KEY;
      let live: { bytes: string; mime: string } | null = null;
      if (geminiKey) {
        live = await runGeminiImage({
          prompt: args.prompt,
          apiKey: geminiKey,
          ...(referenceImages.length > 0 ? { referenceImages } : {}),
        });
        if (!live) {
          console.warn(
            `[sceneMedia] Gemini Flash Image returned null (refCount=${referenceImages.length}) — falling back to Imagen`,
          );
        }
      }
      if (!live) {
        live = await maybeRunImagen(args.prompt);
      }
      if (live) {
        // Imagen returns ~1-2 MiB of base64 PNG — past Convex's 1 MiB
        // document field limit if stored as a data: URL. Upload bytes to
        // Convex file storage and keep only the short CDN URL on the row.
        const binary = decodeBase64ToUint8Array(live.bytes);
        const blob = new Blob([binary as unknown as BlobPart], { type: live.mime });
        const storageId = await (ctx as any).storage.store(blob);
        imageStorageId = storageId as string;
        const rawUrl = (await (ctx as any).storage.getUrl(storageId)) as string;
        // Self-hosted Convex's storage.getUrl() returns its INTERNAL
        // origin (e.g. http://127.0.0.1:3210), which the browser can't
        // reach when we're behind a tunnel. Rewrite to the public
        // origin when set so browsers fetch via the Cloudflare hostname.
        liveUrl = rewriteToPublicOrigin(rawUrl);
        console.log(`[sceneMedia] Imagen stored bytes=${binary.length} storageId=${storageId} url=${liveUrl}`);
      }
    } catch (err) {
      liveError = err instanceof Error ? err.message : "imagen_failed";
      console.warn(`[sceneMedia] Imagen call failed, using placeholder: ${liveError}`);
    }
    const url = liveUrl ?? placeholderImageForPrompt(args.prompt);

    await ctx.runMutation(
      ("media/sceneMedia:markReady" as unknown) as any,
      { assetId: args.assetId, url, at: Date.now() },
    );

    // Chain into Veo i2v. We always attempt to queue video at the end of
    // the image job — even when Imagen fell back to placeholder bytes —
    // so the reduced-motion / placeholder case still produces a clip,
    // matching the old parallel-scheduling behavior. Pass imageStorageId
    // only when live bytes were stored; runVeoJob falls back to a
    // text-only Veo call when the storageId is absent.
    //
    // Wrapped in try/catch because video is a Pro tier and a queue
    // failure must never crash the image job; the contract is still
    // "text is the contract; media is a tier."
    //
    // Omni-cinematics Req 1.2: skip the per-scene Veo chain entirely when the
    // reader's strategy retired it (endpoint_cinematic / stills_only / off). The
    // still above still ships (it feeds the cinematic reference set). Only
    // per_scene_legacy readers keep the i2v clip. `videoAllowed === false` from
    // queueSceneImage suppresses the schedule; undefined (older in-flight jobs)
    // falls through to queueSceneVideo's own strategy backstop.
    if (args.videoAllowed === false) {
      console.log(
        `[sceneMedia] runImagenJob skipping per-scene Veo chain (strategy retired) scene=${args.sceneId ?? "?"}`,
      );
    } else if (args.accountId && args.saveId && args.sceneId) {
      try {
        await ctx.runMutation(
          ("media/sceneMedia:queueSceneVideo" as unknown) as any,
          {
            accountId: args.accountId,
            saveId: args.saveId,
            sceneId: args.sceneId,
            ...(args.nodeId ? { nodeId: args.nodeId } : {}),
            ...(args.alt ? { alt: args.alt } : {}),
            prompt: args.prompt,
            ...(imageStorageId ? { imageStorageId } : {}),
          },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "queueSceneVideo_failed";
        console.warn(`[sceneMedia] post-Imagen queueSceneVideo failed: ${message}`);
      }
    }

    return { ready: true, url, ...(liveError ? { liveError } : {}) };
  },
});

export const queueSceneVideo = internalMutationGeneric({
  args: {
    accountId,
    saveId,
    sceneId: v.id("scenes"),
    prompt: v.string(),
    nodeId: v.optional(v.string()),
    alt: v.optional(v.string()),
    // i2v: storage id of the scene's Imagen still. When present,
    // runVeoJob fetches the bytes and includes them as the first-frame
    // `image` reference in the Veo predictLongRunning request — the
    // video then opens on the exact still the reader saw above. Absent
    // when Imagen fell back to a placeholder; Veo runs text-only then.
    imageStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new AppError("account_not_found");

    // Pro gate (same shape as queueSceneImage). Dev override short-circuits.
    if (!devForceProMedia()) {
      const entitlement = await ctx.db
        .query("entitlements")
        .withIndex("by_accountId", (q: any) => q.eq("accountId", args.accountId))
        .first();
      if (!entitlement || entitlement.tier !== "pro" || entitlement.status !== "active") {
        return { queued: false, reason: "pro_entitlement_required" } as const;
      }
    }

    // Reader's per-modality gate from /settings ("Play scene cinematics").
    // MUST come before the existing-asset and API-key checks so the
    // post-Imagen chain (runImagenJob → queueSceneVideo) respects the
    // reader's preference even when images are still enabled — see
    // queueSceneImage's gate for the matching image side. Re-reads the
    // account on every call so a toggle takes effect immediately, no save
    // reload required.
    const mediaPrefs = await getAccountMediaPrefs(ctx, args.accountId);
    if (!mediaPrefs.videoEnabled) {
      console.log(
        `[sceneMedia] queueSceneVideo skipped: videoEnabled=false account=${args.accountId} scene=${args.sceneId}`,
      );
      return { queued: false, reason: "video_disabled_by_user" } as const;
    }

    // Media-strategy gate (omni-cinematics Req 1.2). Per-scene Veo clips are
    // the LEGACY behavior; under any other resolved strategy the video budget
    // moves to endpoint cinematics (endpoint_cinematic) or is off entirely
    // (stills_only/off keep the scene STILL but no per-turn clip). Only
    // "per_scene_legacy" keeps the Imagen→Veo i2v chain. Reads the account's
    // effective strategy so a reader's cinematicMode takes effect immediately.
    const strategy = await resolveMediaStrategy(ctx, args.accountId);
    if (strategy !== "per_scene_legacy") {
      console.log(
        `[sceneMedia] queueSceneVideo skipped: strategy=${strategy} account=${args.accountId} scene=${args.sceneId}`,
      );
      return { queued: false, reason: `strategy_${strategy}` } as const;
    }

    // Skip if a non-failed video asset already exists for this scene.
    const existing = await ctx.db
      .query("assets")
      .withIndex("by_scene", (q: any) => q.eq("sceneId", args.sceneId))
      .collect();
    if (existing.some((a: AssetDoc) => a.kind === "video" && a.status !== "failed")) {
      return { queued: false, reason: "already_queued" } as const;
    }

    // No Veo key configured? Skip the queue cleanly. Inserting a row
    // here just to immediately fail it pollutes the assets table and
    // shows up as a "failed" badge on every scene. The image asset
    // (queued separately) is the expected reduced-motion fallback.
    if (!process.env.GEMINI_API_KEY) {
      console.log("[sceneMedia] queueSceneVideo skipped: no GEMINI_API_KEY");
      return { queued: false, reason: "veo_no_api_key" } as const;
    }
    const existingVideo = existing.find((a: AssetDoc) => a.kind === "video");
    if (existingVideo && existingVideo.status !== "failed") {
      console.log(`[sceneMedia] queueSceneVideo skipped: existing status=${existingVideo.status} for scene=${args.sceneId}`);
    }

    const cfg = resolveVeoConfigFromEnv();
    const promptHash = hashPrompt(args.prompt);
    const now = Date.now();
    const assetId = await ctx.db.insert("assets", {
      accountId: args.accountId,
      saveId: args.saveId,
      sceneId: args.sceneId,
      ...(args.nodeId ? { nodeId: args.nodeId } : {}),
      kind: "video" as const,
      provider: "gemini-veo" as const,
      url: "",
      status: "queued" as const,
      entitlementRequired: "pro" as const,
      promptHash,
      provenance: {
        provider: "gemini-veo",
        model: cfg.model,
        promptHash,
        promptRedacted: true,
        source: "generated",
      },
      safety: { action: "allow", categories: [], reason: "" },
      ...(args.alt ? { alt: args.alt } : {}),
      tags: [
        `duration:${cfg.durationMs}`,
        `resolution:${cfg.resolution}`,
        `aspect:${cfg.aspectRatio}`,
      ],
      durationMs: cfg.durationMs,
      createdAt: now,
      updatedAt: now,
    });

    // Spend metering (design §2.3): Pro monthly video allowance first, then
    // sparks (a Veo 4s clip is 60 sparks). Dev force-unlock bypasses billing.
    if (!devForceProMedia()) {
      const charge = await chargeMediaSpend(ctx, {
        accountId: args.accountId,
        chargeKind: "video",
        sparkKind: "veo_clip",
        assetId,
        idempotencyKey: `spend:${assetId}`,
      });
      if (!charge.charged) {
        await ctx.db.delete(assetId);
        return { queued: false, reason: charge.reason } as const;
      }
    }

    console.log(
      `[sceneMedia] queueSceneVideo inserted asset=${assetId} model=${cfg.model} i2v=${
        args.imageStorageId ? "yes" : "no"
      }, scheduling runVeoJob`,
    );
    await ctx.scheduler.runAfter(0, ("media/sceneMedia:runVeoJob" as unknown) as any, {
      assetId,
      prompt: args.prompt,
      ...(args.imageStorageId ? { imageStorageId: args.imageStorageId } : {}),
    });

    return { queued: true, assetId } as const;
  },
});

// Veo job split into submit + poll phases so neither blocks the action
// runtime for long. `runVeoJob` only submits the predictLongRunning
// request, persists the operationName, and schedules the first poll.
// `pollVeoJob` checks the operation and either marks ready/failed or
// re-schedules itself, capped at VEO_MAX_POLLS attempts. This keeps
// each individual action call short (~1 fetch instead of ~30s blocking).
export const runVeoJob = actionGeneric({
  args: {
    assetId: v.id("assets"),
    prompt: v.string(),
    // i2v: storage id of the scene's Imagen still. When present we
    // fetch the bytes from Convex storage and pass them to Veo as the
    // first-frame `image` reference so the generated clip opens on the
    // exact still the reader sees above. Absent → text-only Veo path
    // (placeholder image or Imagen failure case).
    imageStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    console.log(
      `[sceneMedia] runVeoJob start asset=${args.assetId} i2v=${args.imageStorageId ? "yes" : "no"}`,
    );
    await ctx.runMutation(
      ("media/sceneMedia:markGenerating" as unknown) as any,
      { assetId: args.assetId, jobId: `veo_${startedAt}`, at: startedAt },
    );

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(
        ("media/sceneMedia:markFailed" as unknown) as any,
        { assetId: args.assetId, error: "veo_no_api_key", at: Date.now() },
      );
      return { ready: false, error: "veo_no_api_key" };
    }

    // Load the i2v first-frame bytes, if available. A fetch / encoding
    // failure is non-fatal: we drop back to text-only Veo rather than
    // failing the whole job, so a transient storage hiccup doesn't kill
    // the cinematic for the scene.
    let imageInput: { bytesBase64Encoded: string; mimeType: string } | null = null;
    if (args.imageStorageId) {
      try {
        const blob = (await (ctx as any).storage.get(args.imageStorageId)) as Blob | null;
        if (blob) {
          const buffer = await blob.arrayBuffer();
          imageInput = {
            bytesBase64Encoded: encodeUint8ArrayToBase64(new Uint8Array(buffer)),
            // Blob.type round-trips from the original store({ type }) call
            // (we always store Imagen output as image/png). Fall back to
            // image/png if the type is empty for any reason.
            mimeType: blob.type || "image/png",
          };
          console.log(
            `[sceneMedia] runVeoJob i2v image loaded bytes=${buffer.byteLength} mime=${imageInput.mimeType}`,
          );
        } else {
          console.warn(`[sceneMedia] runVeoJob i2v image storage.get returned null for ${args.imageStorageId}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "i2v_image_load_failed";
        console.warn(`[sceneMedia] runVeoJob i2v image load failed: ${message}`);
      }
    }

    try {
      const operationName = await submitVeoLongRunning(args.prompt, apiKey, imageInput);
      console.log(`[sceneMedia] runVeoJob submitted asset=${args.assetId} operation=${operationName}`);
      if (!operationName) {
        await ctx.runMutation(
          ("media/sceneMedia:markFailed" as unknown) as any,
          { assetId: args.assetId, error: "gemini_veo_no_operation_name", at: Date.now() },
        );
        return { ready: false, error: "gemini_veo_no_operation_name" };
      }
      await ctx.runMutation(
        ("media/sceneMedia:recordVeoOperation" as unknown) as any,
        { assetId: args.assetId, operationName, attempt: 0, at: Date.now() },
      );
      await ctx.scheduler.runAfter(
        VEO_POLL_INTERVAL_MS,
        ("media/sceneMedia:pollVeoJob" as unknown) as any,
        { assetId: args.assetId },
      );
      return { ready: false, submitted: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "veo_failed";
      console.warn(`[sceneMedia] runVeoJob failed asset=${args.assetId} error=${message}`);
      await ctx.runMutation(
        ("media/sceneMedia:markFailed" as unknown) as any,
        { assetId: args.assetId, error: message, at: Date.now() },
      );
      return { ready: false, error: message };
    }
  },
});

// Recursive Veo poll. Reads operationName + attempt off the asset's
// provenance, polls once, then either resolves (ready/failed) or
// re-schedules itself. Caps at VEO_MAX_POLLS to bound runtime even if
// the operation is stuck.
export const pollVeoJob = actionGeneric({
  args: {
    assetId: v.id("assets"),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(
        ("media/sceneMedia:markFailed" as unknown) as any,
        { assetId: args.assetId, error: "veo_no_api_key", at: Date.now() },
      );
      return { ready: false, error: "veo_no_api_key" };
    }

    const snapshot = (await ctx.runQuery(
      ("media/sceneMedia:_getVeoOperation" as unknown) as any,
      { assetId: args.assetId },
    )) as { operationName?: string; attempt?: number } | null;
    const operationName = snapshot?.operationName;
    const attempt = snapshot?.attempt ?? 0;
    if (!operationName) {
      await ctx.runMutation(
        ("media/sceneMedia:markFailed" as unknown) as any,
        { assetId: args.assetId, error: "veo_operation_missing", at: Date.now() },
      );
      return { ready: false, error: "veo_operation_missing" };
    }

    try {
      const result = await pollVeoOperation(operationName, apiKey);
      if (result.kind === "pending") {
        const nextAttempt = attempt + 1;
        if (nextAttempt >= VEO_MAX_POLLS) {
          await ctx.runMutation(
            ("media/sceneMedia:markFailed" as unknown) as any,
            { assetId: args.assetId, error: "veo_timeout", at: Date.now() },
          );
          return { ready: false, error: "veo_timeout" };
        }
        await ctx.runMutation(
          ("media/sceneMedia:recordVeoOperation" as unknown) as any,
          { assetId: args.assetId, operationName, attempt: nextAttempt, at: Date.now() },
        );
        await ctx.scheduler.runAfter(
          VEO_POLL_INTERVAL_MS,
          ("media/sceneMedia:pollVeoJob" as unknown) as any,
          { assetId: args.assetId },
        );
        return { ready: false, pending: true, attempt: nextAttempt };
      }
      if (result.kind === "error") {
        await ctx.runMutation(
          ("media/sceneMedia:markFailed" as unknown) as any,
          { assetId: args.assetId, error: result.error, at: Date.now() },
        );
        return { ready: false, error: result.error };
      }
      // result.kind === "ready"
      if (!result.uri) {
        await ctx.runMutation(
          ("media/sceneMedia:markFailed" as unknown) as any,
          { assetId: args.assetId, error: "veo_no_output", at: Date.now() },
        );
        return { ready: false, error: "veo_no_output" };
      }
      const sep = result.uri.includes("?") ? "&" : "?";
      const playable = `${result.uri}${sep}key=${encodeURIComponent(apiKey)}`;
      await ctx.runMutation(
        ("media/sceneMedia:markReady" as unknown) as any,
        { assetId: args.assetId, url: playable, at: Date.now() },
      );
      // Strip the API key from the return value — action returns can be
      // surfaced in logs / dashboards.
      return { ready: true, url: scrubKeyFromUrl(playable, apiKey) };
    } catch (err) {
      const message = err instanceof Error ? err.message : "veo_failed";
      await ctx.runMutation(
        ("media/sceneMedia:markFailed" as unknown) as any,
        { assetId: args.assetId, error: message, at: Date.now() },
      );
      return { ready: false, error: message };
    }
  },
});

// Narrator audio via Google Cloud Text-to-Speech.
//
// Mirrors the queue + run split used by Imagen above. The mutation is
// fire-and-forget; failures are non-fatal (the image is still the contract
// and the reader simply gets a silent scene). Idempotency: skip if a
// non-failed audio asset already exists for the scene.
//
// TTS bytes are small (~50-150 KiB MP3) but we still upload via
// ctx.storage.store + rewriteToPublicOrigin so the URL pattern matches
// Imagen/Veo exactly and a runaway prose payload can never bump the
// Convex 1 MiB document field limit.
export const queueSceneNarration = internalMutationGeneric({
  args: {
    accountId,
    saveId,
    sceneId: v.id("scenes"),
    nodeId: v.optional(v.string()),
    prose: v.string(),
    voiceId: v.string(),
    alt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new AppError("account_not_found");

    // Empty prose (typically because the safety classifier blocked the
    // scene) has nothing to read aloud — skip cleanly rather than queue a
    // row we know will fail.
    const proseTrim = args.prose.trim();
    if (proseTrim.length === 0) {
      return { queued: false, reason: "empty_prose" } as const;
    }

    // Pro gate (same shape as queueSceneImage). Dev override short-circuits.
    if (!devForceProMedia()) {
      const entitlement = await ctx.db
        .query("entitlements")
        .withIndex("by_accountId", (q: any) => q.eq("accountId", args.accountId))
        .first();
      if (!entitlement || entitlement.tier !== "pro" || entitlement.status !== "active") {
        return { queued: false, reason: "pro_entitlement_required" } as const;
      }
    }

    // Reader's per-modality gate from /settings ("Play narration & ambient
    // audio"). Skips Google Cloud TTS spend when the reader has muted the
    // narrator — the visual stack continues unaffected.
    const mediaPrefs = await getAccountMediaPrefs(ctx, args.accountId);
    if (!mediaPrefs.audioEnabled) {
      console.log(
        `[sceneMedia] queueSceneNarration skipped: audioEnabled=false account=${args.accountId} scene=${args.sceneId}`,
      );
      return { queued: false, reason: "audio_disabled_by_user" } as const;
    }

    // Skip if a non-failed audio asset already exists for this scene.
    const existing = await ctx.db
      .query("assets")
      .withIndex("by_scene", (q: any) => q.eq("sceneId", args.sceneId))
      .collect();
    if (existing.some((a: AssetDoc) => a.kind === "audio" && a.status !== "failed")) {
      return { queued: false, reason: "already_queued" } as const;
    }

    // No TTS key configured? Skip the queue cleanly so we don't pollute the
    // assets table with rows we know cannot resolve. Image asset (queued
    // separately) remains the visual contract.
    //
    // Cloud TTS lives at texttospeech.googleapis.com and AI Studio's
    // Gemini API keys are scoped only to generativelanguage.googleapis.com —
    // they CANNOT call Cloud TTS even with API restrictions opened. A
    // separate Cloud Console key (with Cloud Text-to-Speech API enabled)
    // is required. GOOGLE_CLOUD_TTS_API_KEY takes precedence; falls back to
    // GEMINI_API_KEY for back-compat (it will 403 with AI Studio keys but
    // works if you generated the GEMINI key from Cloud Console).
    const ttsKey = process.env.GOOGLE_CLOUD_TTS_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!ttsKey) {
      console.log("[sceneMedia] queueSceneNarration skipped: no TTS api key");
      return { queued: false, reason: "tts_no_api_key" } as const;
    }

    const voice = mapVoiceIdToGoogleTts(args.voiceId);
    const promptHash = hashPrompt(proseTrim);
    const now = Date.now();
    const assetId = await ctx.db.insert("assets", {
      accountId: args.accountId,
      saveId: args.saveId,
      sceneId: args.sceneId,
      ...(args.nodeId ? { nodeId: args.nodeId } : {}),
      kind: "audio" as const,
      provider: "google-tts" as const,
      url: "",
      status: "queued" as const,
      entitlementRequired: "pro" as const,
      promptHash,
      provenance: {
        provider: "google-tts",
        model: voice.name,
        promptHash,
        promptRedacted: true,
        source: "generated",
        voiceId: args.voiceId,
        languageCode: voice.languageCode,
      },
      safety: { action: "allow", categories: [], reason: "" },
      ...(args.alt ? { alt: args.alt } : {}),
      tags: [`voice:${args.voiceId}`, `tts:${voice.name}`],
      createdAt: now,
      updatedAt: now,
    });

    // Spend metering (design §2.3): narration is a flat 8-spark product (no
    // image/video allowance applies). Dev force-unlock bypasses billing.
    if (!devForceProMedia()) {
      const charge = await chargeMediaSpend(ctx, {
        accountId: args.accountId,
        chargeKind: "audio",
        sparkKind: "narration",
        assetId,
        idempotencyKey: `spend:${assetId}`,
      });
      if (!charge.charged) {
        await ctx.db.delete(assetId);
        return { queued: false, reason: charge.reason } as const;
      }
    }

    console.log(
      `[sceneMedia] queueSceneNarration inserted asset=${assetId} voice=${args.voiceId} tts=${voice.name}, scheduling runNarrationJob`,
    );
    await ctx.scheduler.runAfter(0, ("media/sceneMedia:runNarrationJob" as unknown) as any, {
      assetId,
      prose: proseTrim,
      voiceId: args.voiceId,
    });

    return { queued: true, assetId } as const;
  },
});

export const runNarrationJob = actionGeneric({
  args: {
    assetId: v.id("assets"),
    prose: v.string(),
    voiceId: v.string(),
  },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    console.log(`[sceneMedia] TTS start asset=${args.assetId} voice=${args.voiceId} chars=${args.prose.length}`);
    await ctx.runMutation(
      ("media/sceneMedia:markGenerating" as unknown) as any,
      { assetId: args.assetId, jobId: `tts_${startedAt}`, at: startedAt },
    );

    const apiKey = process.env.GOOGLE_CLOUD_TTS_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn(`[sceneMedia] TTS failed asset=${args.assetId} error=tts_no_api_key`);
      await ctx.runMutation(
        ("media/sceneMedia:markFailed" as unknown) as any,
        { assetId: args.assetId, error: "tts_no_api_key", at: Date.now() },
      );
      return { ready: false, error: "tts_no_api_key" };
    }

    try {
      const voice = mapVoiceIdToGoogleTts(args.voiceId);
      // Chunked concurrent synthesis: Chirp 3 HD latency scales with input
      // length, so a full scene in one call is slow. `synthesizeNarration`
      // splits on sentence boundaries and synthesizes chunks concurrently,
      // concatenating the MP3 parts — same output format, ~a fraction of the
      // wall-clock. Falls back to a single call for short prose.
      const audio = await synthesizeNarration({ text: args.prose, voice, apiKey });
      const binary = audio.bytes;
      const blob = new Blob([binary as unknown as BlobPart], { type: audio.mime });
      const storageId = await (ctx as any).storage.store(blob);
      const rawUrl = (await (ctx as any).storage.getUrl(storageId)) as string;
      const url = rewriteToPublicOrigin(rawUrl);
      console.log(
        `[sceneMedia] TTS stored bytes=${binary.length} chunks=${audio.chunks} elapsedMs=${Date.now() - startedAt} url=${url}`,
      );
      await ctx.runMutation(
        ("media/sceneMedia:markReady" as unknown) as any,
        { assetId: args.assetId, url, at: Date.now() },
      );
      return { ready: true, url };
    } catch (err) {
      const message = err instanceof Error ? err.message : "tts_failed";
      console.warn(`[sceneMedia] TTS failed asset=${args.assetId} error=${message}`);
      // Best-effort: image is the contract, narration is a nice-to-have.
      await ctx.runMutation(
        ("media/sceneMedia:markFailed" as unknown) as any,
        { assetId: args.assetId, error: message, at: Date.now() },
      );
      return { ready: false, error: message };
    }
  },
});

// Internal mutation: write the Veo operationName + attempt count onto
// the asset's provenance so the next pollVeoJob call can pick up where
// the prior one left off. MUST stay internal — callers (`runVeoJob`,
// `pollVeoJob`) invoke it server-side via `ctx.runMutation`. Exposing it
// as a public mutation would let any client with an `assetId` (returned
// by `queueSceneImage`) overwrite arbitrary asset provenance.
export const recordVeoOperation = internalMutationGeneric({
  args: {
    assetId: v.id("assets"),
    operationName: v.string(),
    attempt: v.number(),
    at: v.number(),
  },
  handler: async (ctx, args) => {
    const asset = (await ctx.db.get(args.assetId)) as AssetDoc | null;
    if (!asset) return;
    await ctx.db.patch(args.assetId, {
      provenance: {
        ...asset.provenance,
        veoOperationName: args.operationName,
        veoAttempt: args.attempt,
      },
      updatedAt: args.at,
    });
  },
});

// Internal query: read Veo operation state off an asset's provenance.
// Underscore prefix is a soft signal that this isn't a public surface.
export const _getVeoOperation = queryGeneric({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    const asset = (await ctx.db.get(args.assetId)) as AssetDoc | null;
    if (!asset) return null;
    const prov = asset.provenance as Record<string, unknown>;
    return {
      operationName: typeof prov.veoOperationName === "string" ? prov.veoOperationName : undefined,
      attempt: typeof prov.veoAttempt === "number" ? prov.veoAttempt : 0,
    };
  },
});

export const markGenerating = internalMutationGeneric({
  args: { assetId: v.id("assets"), jobId: v.string(), at: v.number() },
  handler: async (ctx, args) => {
    const asset = (await ctx.db.get(args.assetId)) as AssetDoc | null;
    if (!asset) return;
    await ctx.db.patch(args.assetId, {
      status: "generating",
      provenance: { ...asset.provenance, jobId: args.jobId },
      updatedAt: args.at,
    });
  },
});

export const markReady = internalMutationGeneric({
  args: { assetId: v.id("assets"), url: v.string(), at: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.assetId, {
      status: "ready",
      url: args.url,
      updatedAt: args.at,
      readyAt: args.at,
    });
  },
});

export const markFailed = internalMutationGeneric({
  args: { assetId: v.id("assets"), error: v.string(), at: v.number() },
  handler: async (ctx, args) => {
    const asset = (await ctx.db.get(args.assetId)) as AssetDoc | null;
    if (!asset) return;
    await ctx.db.patch(args.assetId, {
      status: "failed",
      provenance: { ...asset.provenance, errorCode: args.error },
      updatedAt: args.at,
    });
    // Refund any sparks this asset was charged (design §2.3). Idempotent and a
    // no-op for un-metered assets (anchors share this mark-failed path but are
    // never charged).
    await refundSpark(ctx, args.assetId);
  },
});

// Helper: queue both the Imagen still and the Veo clip for a single
// scene in one call. Use this from every scene-transition mutation
// (createSave, submitChoice, beginStreamingChoice terminal branch,
// completeSceneStream) so Pro reads get media on EVERY scene — not
// just the streamed mid-tale ones.
//
// `ctx` must be a mutation-style context (has `runMutation`). The
// helper truncates the prompt to 480 chars to stay well below the
// underlying Imagen/Veo prompt limits and to keep prompt hashes
// stable across small text edits.
//
// Errors from the inner queue mutations are NEVER thrown — text is
// the contract; Pro media is a tier. The caller can still wrap the
// helper in its own try/catch for belt-and-braces, but a swallowed
// failure here cannot block the scene transition.
export async function queueSceneMediaForSave(
  ctx: {
    runMutation: (ref: any, args: any) => Promise<any>;
    // Optional db handle — when present, the helper reads the account's
    // mediaPrefs up-front and short-circuits each modality before paying
    // the RPC. The inner mutations re-check the same flag (defence in
    // depth) so callers that don't pass `db` still degrade safely.
    db?: { get: (id: any) => Promise<unknown> };
  },
  args: {
    accountId: string;
    saveId: string;
    sceneId: string;
    nodeId?: string;
    prompt: string;
    alt?: string;
    // Narration uses the scene's prose text. When the caller has prose
    // (e.g. authored scenes whose seed is the prose itself, or post-stream
    // re-queues), pass it. When omitted we fall back to the visual prompt
    // — fine for openings where the node seed IS the prose.
    prose?: string;
    // Voice id for narration. Default applied in queueSceneNarration if
    // omitted; callers should pass save.voiceId when available.
    voiceId?: string;
  },
): Promise<void> {
  const prompt = (args.prompt ?? "").slice(0, 480) || "scene";
  const baseArgs = {
    accountId: args.accountId,
    saveId: args.saveId,
    sceneId: args.sceneId,
    ...(args.nodeId ? { nodeId: args.nodeId } : {}),
    prompt,
  };
  // Top-level modality gate. The inner mutations re-check this from the
  // account row themselves, but reading it once here lets us skip the
  // wasted RPC entirely AND produces a single coherent log line per
  // modality skip so prod operators can grep
  //   `[sceneMedia] queueSceneMediaForSave skipped`
  // to see which prefs are actually saving spend.
  let prefs: MediaPrefs | null = null;
  if (ctx.db) {
    try {
      prefs = await getAccountMediaPrefs(ctx as { db: { get: (id: any) => Promise<unknown> } }, args.accountId);
    } catch {
      // If reading the row throws we fall through to the inner gates.
      prefs = null;
    }
  }

  if (prefs && !prefs.imagesEnabled) {
    console.log(
      `[sceneMedia] queueSceneMediaForSave skipped image: imagesEnabled=false account=${args.accountId} scene=${args.sceneId}`,
    );
  } else {
    try {
      // queueSceneImage is the single entry into the visual pipeline now:
      // runImagenJob queues queueSceneVideo at the end with the image's
      // storageId so Veo can use it as the first-frame reference (i2v).
      // The old parallel queueSceneVideo call here would have raced
      // Imagen and produced a video whose first frame doesn't match the
      // still — that's the visible-mismatch bug the user reported. The
      // post-Imagen chain still queues video when Imagen falls back to a
      // placeholder (text-only Veo path), preserving the reduced-motion
      // fallback behavior.
      await ctx.runMutation(
        ("media/sceneMedia:queueSceneImage" as unknown) as any,
        { ...baseArgs, alt: args.alt ?? `Scene illustration for ${args.nodeId ?? "scene"}` },
      );
    } catch {
      // non-fatal — Pro media is a tier, text is the contract
    }
  }
  // Only queue narration when the caller explicitly provided prose. We
  // refuse to fall back to the (truncated, visual-shaped) `prompt` here
  // because TTS would read prompt-truncation garbage. LLM-driven openings
  // pass undefined on purpose — their narration is queued later in
  // completeSceneStream once the stream finishes.
  if (typeof args.prose === "string" && args.prose.trim().length > 0) {
    if (prefs && !prefs.audioEnabled) {
      console.log(
        `[sceneMedia] queueSceneMediaForSave skipped narration: audioEnabled=false account=${args.accountId} scene=${args.sceneId}`,
      );
    } else {
      try {
        await ctx.runMutation(
          ("media/sceneMedia:queueSceneNarration" as unknown) as any,
          {
            accountId: args.accountId,
            saveId: args.saveId,
            sceneId: args.sceneId,
            ...(args.nodeId ? { nodeId: args.nodeId } : {}),
            prose: args.prose,
            ...(args.voiceId ? { voiceId: args.voiceId } : {}),
            alt: args.alt ?? `Scene narration for ${args.nodeId ?? "scene"}`,
          },
        );
      } catch {
        // non-fatal — narration is a Pro layer; silence still leaves the read intact
      }
    }
  }
}

export const getSceneMedia = queryGeneric({
  args: {
    accountId,
    saveId,
    guestTokenHash: v.optional(v.string()),
    sceneId: v.optional(v.id("scenes")),
  },
  handler: async (ctx, args) => {
    // Authz: requester must own the save and present a valid session.
    // Without this, anyone could enumerate save ids and read Pro media
    // URLs + provenance for arbitrary accounts.
    const saveDoc = await ctx.db.get(args.saveId);
    if (!saveDoc) return null;
    const save = saveFromDoc(saveDoc);
    assertCanAccessSave(args.accountId, save);
    const accountDoc = await ctx.db.get(args.accountId);
    if (!accountDoc) throw new AppError("account_not_found");
    await assertAccountSessionAccess(
      ctx,
      accountFromDoc(accountDoc),
      args.guestTokenHash,
    );

    const targetSceneId =
      args.sceneId ?? (await loadCurrentSceneIdForSave(ctx, args.saveId));
    if (!targetSceneId) return null;

    const docs = (await ctx.db
      .query("assets")
      .withIndex("by_scene", (q: any) => q.eq("sceneId", targetSceneId))
      .collect()) as AssetDoc[];

    const assets: AssetRecord[] = docs.map(docToRecord);
    const projection = projectSceneMedia({ assets, preferredKind: "video" });
    if (!projection) return null;
    // Surface the scene's nodeId so the client can match the media
    // projection against its own `projection.scene.id`. Without this the
    // reader can show prose for scene N while the narrator clip — keyed by
    // the server's already-advanced `save.currentSceneId` — is for N+1
    // (the "text doesn't match narration" bug after a turn).
    const sceneDoc = await ctx.db.get(targetSceneId as any);
    const nodeId = (sceneDoc as { nodeId?: unknown } | null)?.nodeId;
    return {
      ...projection,
      ...(typeof nodeId === "string" ? { nodeId } : {}),
    };
  },
});

// Local doc-projectors. game.ts has identical privates; keep this file
// self-contained so the auth path doesn't import a private from another
// module.
function accountFromDoc(doc: Record<string, unknown>): AccountRecord {
  const base: Pick<
    AccountRecord,
    "_id" | "kind" | "ageBand" | "matureContentEnabled" | "createdAt" | "lastActiveAt"
  > = {
    _id: doc._id as string,
    kind: doc.kind as AccountRecord["kind"],
    ageBand: doc.ageBand as AccountRecord["ageBand"],
    matureContentEnabled: doc.matureContentEnabled as boolean,
    createdAt: doc.createdAt as number,
    lastActiveAt: doc.lastActiveAt as number,
  };
  return {
    ...base,
    ...(doc.userId === undefined ? {} : { userId: doc.userId as string }),
    ...(doc.guestTokenHash === undefined ? {} : { guestTokenHash: doc.guestTokenHash as string }),
    ...(doc.matureContentEnabledAt === undefined ? {} : { matureContentEnabledAt: doc.matureContentEnabledAt as number }),
    ...(doc.ttlExpiresAt === undefined ? {} : { ttlExpiresAt: doc.ttlExpiresAt as number }),
    ...(doc.isAdmin === undefined ? {} : { isAdmin: doc.isAdmin as boolean }),
  } as AccountRecord;
}

function saveFromDoc(doc: Record<string, unknown>): SaveRecord {
  return doc as unknown as SaveRecord;
}

async function loadCurrentSceneIdForSave(
  ctx: any,
  sid: string,
): Promise<string | null> {
  const save = await ctx.db.get(sid);
  if (!save) return null;
  const currentSceneId = (save as { currentSceneId?: string }).currentSceneId;
  return currentSceneId ?? null;
}

function docToRecord(doc: AssetDoc): AssetRecord {
  return {
    _id: doc._id,
    accountId: doc.accountId,
    ...(doc.saveId === undefined ? {} : { saveId: doc.saveId }),
    ...(doc.taleId === undefined ? {} : { taleId: doc.taleId }),
    ...(doc.sceneId === undefined ? {} : { sceneId: doc.sceneId }),
    ...(doc.nodeId === undefined ? {} : { nodeId: doc.nodeId }),
    kind: doc.kind,
    provider: doc.provider,
    url: doc.url,
    status: doc.status,
    entitlementRequired: doc.entitlementRequired,
    promptHash: doc.promptHash,
    provenance: doc.provenance as AssetRecord["provenance"],
    safety: doc.safety as AssetRecord["safety"],
    ...(doc.alt === undefined ? {} : { alt: doc.alt }),
    ...(doc.durationMs === undefined ? {} : { durationMs: doc.durationMs }),
    tags: doc.tags ?? [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt ?? doc.createdAt,
    ...(doc.readyAt === undefined ? {} : { readyAt: doc.readyAt }),
  };
}

// Picsum is deterministic-by-seed and CDN-cached, perfect for dev so the
// MediaPlate has a real image to fade in. Seed = prompt hash (8 chars).
function placeholderImageForPrompt(prompt: string): string {
  const seed = hashPrompt(prompt).slice(0, 8);
  return `https://picsum.photos/seed/${seed}/1024/640`;
}

// Resolve anchor asset ids to in-memory reference-image bytes for the
// Gemini Flash Image call. Race-tolerant:
//   - asset row missing → skip (anchor never queued / since deleted).
//   - asset.status !== "ready" → skip (still generating; scene proceeds
//     without a reference, which is the documented fallback).
//   - storage.get returns null → skip (transient storage hiccup).
// All three cases are non-fatal: the caller sees fewer references than
// requested and renders without those anchors. The fallback chain in
// runImagenJob's handler then drops to no-reference render.
export async function loadReferenceBytes(
  ctx: any,
  ids: { protagonist?: string; setting?: string; npcs?: string[] },
): Promise<GeminiImageReference[]> {
  const out: GeminiImageReference[] = [];
  // Order matters: protagonist first so the model conditions the face
  // ahead of the setting, then any named-NPC portraits (§3.2) so a rostered
  // NPC keeps one face across scenes. Multi-image conditioning in Gemini
  // Flash Image weights earlier parts more strongly per the AI Studio docs.
  // A not-ready / missing portrait is silently skipped (tolerant); the
  // geminiImageClient reference ceiling caps the total regardless.
  for (const assetIdValue of [ids.protagonist, ids.setting, ...(ids.npcs ?? [])]) {
    if (!assetIdValue) continue;
    try {
      const assetDoc = (await ctx.runQuery(
        ("media/sceneMedia:_getAssetForReference" as unknown) as any,
        { assetId: assetIdValue },
      )) as { status?: string; storageId?: string; mime?: string } | null;
      if (!assetDoc || assetDoc.status !== "ready" || !assetDoc.storageId) continue;
      const blob = (await (ctx as any).storage.get(assetDoc.storageId)) as Blob | null;
      if (!blob) continue;
      const buffer = await blob.arrayBuffer();
      out.push({
        bytes: new Uint8Array(buffer),
        mime: assetDoc.mime || blob.type || "image/png",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "anchor_load_failed";
      console.warn(`[sceneMedia] loadReferenceBytes failed asset=${assetIdValue} error=${message}`);
    }
  }
  return out;
}

// Internal query: surface just the fields the reference loader needs.
// Returns status + storageId (pulled off provenance, where the anchor
// job stashes it on save) + mime so the loader can request the right
// bytes without fetching the whole asset doc shape into action memory.
export const _getAssetForReference = queryGeneric({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    const asset = (await ctx.db.get(args.assetId)) as AssetDoc | null;
    if (!asset) return null;
    const prov = asset.provenance as Record<string, unknown>;
    return {
      status: asset.status,
      storageId: typeof prov.storageId === "string" ? prov.storageId : undefined,
      mime: typeof prov.mime === "string" ? prov.mime : undefined,
    };
  },
});

// Reference-anchor pipeline: one job per anchor (protagonist + setting),
// scheduled from `completeSceneStream` on turn 1 when the LLM emits the
// matching anchor description. Generated WITHOUT references (the anchor
// IS the reference; nothing to seed against on first run). Resulting
// bytes are stored in Convex storage, the assets row carries the
// storageId on its provenance for `loadReferenceBytes` to look up, and
// the save row is patched via `setAnchorAssetId` so subsequent
// `queueSceneImage` calls thread the anchor as a reference input.
//
// Race window: anchors and scene 2 may be queued in the same tick. The
// anchor job typically completes in 3-5s; scene 2 fires on the next
// user choice (always > 5s in practice). Even if the race fires, the
// fallback in `loadReferenceBytes` simply renders scene 2 without the
// anchor — text is still the contract.
export const queueAnchorImage = internalMutationGeneric({
  args: {
    accountId,
    saveId,
    kind: v.union(v.literal("protagonist"), v.literal("setting")),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new AppError("account_not_found");

    // Pro gate (same shape as queueSceneImage). Dev override short-circuits.
    if (!devForceProMedia()) {
      const entitlement = await ctx.db
        .query("entitlements")
        .withIndex("by_accountId", (q: any) => q.eq("accountId", args.accountId))
        .first();
      if (!entitlement || entitlement.tier !== "pro" || entitlement.status !== "active") {
        return { queued: false, reason: "pro_entitlement_required" } as const;
      }
    }

    // Idempotency: each save has at most one anchor per kind. If the save
    // row already points at an anchor asset id for this kind, bail. The
    // pointer is the source of truth — a stray orphaned anchor row from a
    // crashed earlier attempt is fine to leave behind.
    const saveDoc = (await ctx.db.get(args.saveId)) as
      | { anchorProtagonistAssetId?: string; anchorSettingAssetId?: string }
      | null;
    const existingPointer =
      args.kind === "protagonist"
        ? saveDoc?.anchorProtagonistAssetId
        : saveDoc?.anchorSettingAssetId;
    if (existingPointer) {
      return { queued: false, reason: "already_anchored" } as const;
    }

    const promptHash = hashPrompt(args.prompt);
    const now = Date.now();
    const assetId = await ctx.db.insert("assets", {
      accountId: args.accountId,
      saveId: args.saveId,
      referenceKind: args.kind,
      kind: "image" as const,
      // Provider is still tagged "vertex-imagen" so the existing
      // asset-projection / billing surfaces don't have to learn a new
      // provider literal for v0. The actual model is Gemini Flash Image
      // (Nano Banana 2, `gemini-3.1-flash-image`) — captured on provenance
      // below via the shared resolver so it can't drift from what's used.
      provider: "vertex-imagen" as const,
      url: "",
      status: "queued" as const,
      entitlementRequired: "pro" as const,
      promptHash,
      provenance: {
        provider: "vertex-imagen",
        model: resolveGeminiImageModel(),
        promptHash,
        promptRedacted: true,
        source: "generated",
        referenceKind: args.kind,
        aspectRatio: args.kind === "protagonist" ? "1:1" : "16:9",
      },
      safety: { action: "allow", categories: [], reason: "" },
      alt: `Anchor ${args.kind}`,
      tags: ["anchor", `reference:${args.kind}`],
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, ("media/sceneMedia:runAnchorImageJob" as unknown) as any, {
      assetId,
      prompt: args.prompt,
      saveId: args.saveId,
      kind: args.kind,
    });

    return { queued: true, assetId } as const;
  },
});

export const runAnchorImageJob = actionGeneric({
  args: {
    assetId: v.id("assets"),
    prompt: v.string(),
    saveId,
    kind: v.union(v.literal("protagonist"), v.literal("setting")),
    // §3.3 bounded retry: which attempt this is (0-indexed). A turn-1 anchor
    // failure used to un-anchor the ENTIRE run with no retry — every later
    // scene then rendered reference-less = full drift. On a provider miss we
    // reschedule with attempt+1 (mirroring the Veo poll reschedule pattern),
    // marking the asset failed only after ANCHOR_MAX_ATTEMPTS. Absent (older
    // in-flight schedules / first run) → 0.
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const attempt = args.attempt ?? 0;
    await ctx.runMutation(
      ("media/sceneMedia:markGenerating" as unknown) as any,
      { assetId: args.assetId, jobId: `anchor_${args.kind}_${startedAt}`, at: startedAt },
    );

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn(`[sceneMedia] anchor job no GEMINI_API_KEY asset=${args.assetId}`);
      await ctx.runMutation(
        ("media/sceneMedia:markFailed" as unknown) as any,
        { assetId: args.assetId, error: "gemini_no_api_key", at: Date.now() },
      );
      return { ready: false, error: "gemini_no_api_key" } as const;
    }

    try {
      // Anchors generate WITHOUT references — they ARE the references.
      const live = await runGeminiImage({ prompt: args.prompt, apiKey });
      if (!live) {
        // Anchor failed at the provider. Retry (bounded) rather than
        // permanently un-anchoring the whole run; only mark failed after the
        // last attempt (§3.3). The save pointer stays unset until an attempt
        // succeeds, so scenes fall back to reference-less renders meanwhile.
        const rescheduled = await maybeRescheduleAnchor(ctx, args, attempt, "gemini_image_empty");
        if (rescheduled) return { ready: false, retrying: true, attempt: attempt + 1 } as const;
        await ctx.runMutation(
          ("media/sceneMedia:markFailed" as unknown) as any,
          { assetId: args.assetId, error: "gemini_image_empty", at: Date.now() },
        );
        return { ready: false, error: "gemini_image_empty" } as const;
      }
      const binary = decodeBase64ToUint8Array(live.bytes);
      const blob = new Blob([binary as unknown as BlobPart], { type: live.mime });
      const storageId = await (ctx as any).storage.store(blob);
      const rawUrl = (await (ctx as any).storage.getUrl(storageId)) as string;
      const url = rewriteToPublicOrigin(rawUrl);
      console.log(
        `[sceneMedia] anchor ${args.kind} stored bytes=${binary.length} storageId=${storageId} url=${url}`,
      );
      // Stamp the storageId + mime on provenance so loadReferenceBytes can
      // fetch the bytes back without a second call to ctx.storage.getUrl.
      await ctx.runMutation(
        ("media/sceneMedia:_patchAnchorProvenance" as unknown) as any,
        {
          assetId: args.assetId,
          storageId: storageId as string,
          mime: live.mime,
          at: Date.now(),
        },
      );
      await ctx.runMutation(
        ("media/sceneMedia:markReady" as unknown) as any,
        { assetId: args.assetId, url, at: Date.now() },
      );
      // Patch the save row so subsequent queueSceneImage calls find this
      // anchor and thread it as a reference. Best-effort — a missing save
      // (e.g. deleted mid-flight) is non-fatal.
      try {
        await ctx.runMutation(
          ("media/sceneMedia:setAnchorAssetId" as unknown) as any,
          { saveId: args.saveId, kind: args.kind, assetId: args.assetId, at: Date.now() },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "set_anchor_failed";
        console.warn(`[sceneMedia] setAnchorAssetId failed kind=${args.kind} error=${message}`);
      }
      return { ready: true, url } as const;
    } catch (err) {
      const message = err instanceof Error ? err.message : "anchor_failed";
      console.warn(`[sceneMedia] anchor ${args.kind} failed asset=${args.assetId} error=${message}`);
      // Bounded retry (§3.3) — a transient store/provider throw shouldn't
      // permanently un-anchor the run.
      const rescheduled = await maybeRescheduleAnchor(ctx, args, attempt, message);
      if (rescheduled) return { ready: false, retrying: true, attempt: attempt + 1 } as const;
      await ctx.runMutation(
        ("media/sceneMedia:markFailed" as unknown) as any,
        { assetId: args.assetId, error: message, at: Date.now() },
      );
      return { ready: false, error: message } as const;
    }
  },
});

// §3.3 anchor retry helper. Reschedules runAnchorImageJob with attempt+1 while
// under the cap, mirroring the bounded Veo poll reschedule. Returns true when a
// retry was scheduled (caller should NOT markFailed), false when the cap is hit
// (caller marks failed). Never throws — a scheduler hiccup falls through to
// markFailed, so a turn is never blocked (BC5).
export async function maybeRescheduleAnchor(
  ctx: any,
  args: { assetId: string; prompt: string; saveId: string; kind: "protagonist" | "setting" },
  attempt: number,
  reason: string,
): Promise<boolean> {
  const nextAttempt = attempt + 1;
  if (nextAttempt >= ANCHOR_MAX_ATTEMPTS) return false;
  try {
    console.warn(
      `[sceneMedia] anchor ${args.kind} attempt ${attempt} failed (${reason}); rescheduling attempt=${nextAttempt}`,
    );
    await ctx.scheduler.runAfter(
      ANCHOR_RETRY_DELAY_MS,
      ("media/sceneMedia:runAnchorImageJob" as unknown) as any,
      {
        assetId: args.assetId,
        prompt: args.prompt,
        saveId: args.saveId,
        kind: args.kind,
        attempt: nextAttempt,
      },
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "anchor_reschedule_failed";
    console.warn(`[sceneMedia] anchor ${args.kind} reschedule failed: ${message}`);
    return false;
  }
}

// Internal mutation: stamp storageId + mime onto an anchor's provenance so
// `_getAssetForReference` (and therefore `loadReferenceBytes`) can fetch
// the bytes back at the next scene-image call.
export const _patchAnchorProvenance = internalMutationGeneric({
  args: {
    assetId: v.id("assets"),
    storageId: v.string(),
    mime: v.string(),
    at: v.number(),
  },
  handler: async (ctx, args) => {
    const asset = (await ctx.db.get(args.assetId)) as AssetDoc | null;
    if (!asset) return;
    await ctx.db.patch(args.assetId, {
      provenance: {
        ...asset.provenance,
        storageId: args.storageId,
        mime: args.mime,
      },
      updatedAt: args.at,
    });
  },
});

// Internal mutation: patch save.anchorProtagonistAssetId or
// save.anchorSettingAssetId once the corresponding anchor job lands.
export const setAnchorAssetId = internalMutationGeneric({
  args: {
    saveId,
    kind: v.union(v.literal("protagonist"), v.literal("setting")),
    assetId: v.id("assets"),
    at: v.number(),
  },
  handler: async (ctx, args) => {
    const save = await ctx.db.get(args.saveId);
    if (!save) return;
    const patch =
      args.kind === "protagonist"
        ? { anchorProtagonistAssetId: args.assetId, updatedAt: args.at }
        : { anchorSettingAssetId: args.assetId, updatedAt: args.at };
    await ctx.db.patch(args.saveId, patch);
  },
});

// Imagen client helpers (`maybeRunImagen`, `decodeBase64ToUint8Array`,
// `rewriteToPublicOrigin`) live in `./imagenClient` — the scene and NPC
// portrait pipelines both import them so provider logic isn't duplicated.

// Encode a Uint8Array as a base64 string. Used for the Veo i2v path,
// which needs the Imagen still as `bytesBase64Encoded`. We chunk the
// String.fromCharCode call because passing a 1–2 MiB Uint8Array in a
// single call hits the V8 argument-count limit on the spread operator.
function encodeUint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...(chunk as unknown as number[]));
  }
  return btoa(binary);
}

// Veo 3.1 lite via the public Gemini API. Two-step protocol:
//   1. POST predictLongRunning → returns { name: "operations/..." }.
//   2. GET operations/{name} every 5s until done or we run out of polls.
//
// On success returns the generated video URI. On API failure throws so
// the caller can record a structured error. On polling timeout returns
// null (caller treats as no output → mark failed).
// §3.3 anchor retry: how many times runAnchorImageJob attempts a failed
// anchor before giving up, and the backoff between attempts. Kept small — an
// anchor that fails 3x in a row is likely a persistent key/quota issue, and
// the run still renders (reference-less) meanwhile.
export const ANCHOR_MAX_ATTEMPTS = 3;
const ANCHOR_RETRY_DELAY_MS = 4_000;

const VEO_POLL_INTERVAL_MS = 5_000;
// ~90s ceiling. Veo 3.1 lite usually resolves in 30-60s but the
// preview endpoint can spike past that under load.
const VEO_MAX_POLLS = 18;

type VeoEnvConfig = {
  model: string;
  durationMs: 4_000 | 6_000 | 8_000;
  resolution: "720p" | "1080p";
  aspectRatio: "16:9" | "9:16";
};

function resolveVeoConfigFromEnv(): VeoEnvConfig {
  const model = process.env.GEMINI_VEO_MODEL?.trim() || "veo-3.1-lite-generate-preview";
  const rawDuration = Number(process.env.GEMINI_VEO_DURATION_MS);
  const duration =
    rawDuration === 4_000 || rawDuration === 6_000 || rawDuration === 8_000 ? rawDuration : 4_000;
  const rawRes = process.env.GEMINI_VEO_RESOLUTION?.trim();
  const resolution: VeoEnvConfig["resolution"] = rawRes === "1080p" ? "1080p" : "720p";
  // Lite 1080p only supports 8s.
  const durationMs: VeoEnvConfig["durationMs"] = resolution === "1080p" ? 8_000 : duration;
  const rawAspect = process.env.GEMINI_VEO_ASPECT_RATIO?.trim();
  const aspectRatio: VeoEnvConfig["aspectRatio"] = rawAspect === "9:16" ? "9:16" : "16:9";
  return { model, durationMs, resolution, aspectRatio };
}

// Submit a Veo predictLongRunning request and return the operation
// name. Throws on API failure so the caller records a structured error.
// Used by the runVeoJob action — the actual polling happens in
// pollVeoJob via the scheduler so no single action call blocks on the
// long-running operation.
//
// When `image` is provided, the call is image-to-video (i2v): Veo opens
// the generated clip on the supplied still and animates from there. The
// `image` instance field is documented for `veo-3.x-*-generate-preview`
// at https://ai.google.dev/gemini-api/docs/video (sibling of `prompt`).
async function submitVeoLongRunning(
  prompt: string,
  apiKey: string,
  image: { bytesBase64Encoded: string; mimeType: string } | null = null,
): Promise<string | null> {
  const cfg = resolveVeoConfigFromEnv();
  const submitUrl = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:predictLongRunning`;
  const submitBody = {
    instances: [
      image ? { prompt, image } : { prompt },
    ],
    parameters: {
      aspectRatio: cfg.aspectRatio,
      durationSeconds: Math.round(cfg.durationMs / 1000),
      resolution: cfg.resolution,
      sampleCount: 1,
    },
  };
  const submitRes = await fetch(submitUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(submitBody),
  });
  if (!submitRes.ok) {
    const text = await submitRes.text();
    const safe = text.replace(apiKey, "<redacted>").slice(0, 800);
    throw new Error(`gemini_veo_submit_${submitRes.status}: ${safe}`);
  }
  const submitData = (await submitRes.json()) as { name?: string };
  return submitData.name ?? null;
}

type VeoPollResult =
  | { kind: "pending" }
  | { kind: "ready"; uri: string | null }
  | { kind: "error"; error: string };

// Single poll of a Veo operation. Returns "pending" when the operation
// hasn't completed yet, "ready" with the URI on success, or "error"
// with a scrubbed message. Caller is responsible for re-scheduling.
async function pollVeoOperation(operationName: string, apiKey: string): Promise<VeoPollResult> {
  const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${encodeURIComponent(apiKey)}`;
  const pollRes = await fetch(pollUrl, { method: "GET" });
  if (!pollRes.ok) {
    const text = await pollRes.text();
    const safe = text.replace(apiKey, "<redacted>").slice(0, 160);
    return { kind: "error", error: `gemini_veo_poll_${pollRes.status}: ${safe}` };
  }
  const pollData = (await pollRes.json()) as {
    done?: boolean;
    error?: { message?: string };
    response?: {
      generateVideoResponse?: {
        generatedSamples?: Array<{ video?: { uri?: string } }>;
      };
    };
  };
  if (pollData.error?.message) {
    return { kind: "error", error: `gemini_veo_error: ${pollData.error.message.slice(0, 160)}` };
  }
  if (!pollData.done) return { kind: "pending" };
  const uri =
    pollData.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ?? null;
  return { kind: "ready", uri };
}

// Strip any occurrence of the API key from a URL so it's safe to log /
// return as an action result. Used on Veo download URLs that we inline
// the key into for dev playback.
function scrubKeyFromUrl(url: string, apiKey: string): string {
  if (!apiKey) return url;
  return url
    .split(apiKey).join("<redacted>")
    .split(encodeURIComponent(apiKey)).join("<redacted>");
}

// Google Cloud Text-to-Speech REST contract:
//   POST https://texttospeech.googleapis.com/v1/text:synthesize
//   header x-goog-api-key: <key>
//   body { input: { text }, voice: { languageCode, name }, audioConfig: { audioEncoding } }
// Returns { audioContent: <base64 mp3> }.
//
// Throws on non-2xx with the API key scrubbed from the message. The cap
// at 5000 characters mirrors Google's documented per-request limit; we
// truncate rather than fail because the parent intent is "best-effort
// narrator track", not "byte-exact synthesis".
type TtsBytes = { bytes: string; mime: string };

async function synthesizeGoogleTts(input: {
  text: string;
  voice: { languageCode: string; name: string };
  apiKey: string;
}): Promise<TtsBytes> {
  const url = "https://texttospeech.googleapis.com/v1/text:synthesize";
  // Google's text:synthesize endpoint accepts at most 5000 characters of
  // input. Most scenes are well under, but trim defensively.
  const safeText = input.text.length > 5000 ? input.text.slice(0, 5000) : input.text;
  const body = {
    input: { text: safeText },
    voice: { languageCode: input.voice.languageCode, name: input.voice.name },
    audioConfig: { audioEncoding: "MP3" as const },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": input.apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    const safe = text.replace(input.apiKey, "<redacted>").slice(0, 200);
    throw new Error(`google_tts_${res.status}: ${safe}`);
  }
  const data = (await res.json()) as { audioContent?: string };
  if (!data.audioContent) throw new Error("google_tts_empty_response");
  return { bytes: data.audioContent, mime: "audio/mpeg" };
}

// --- Chunked narration synthesis (latency) -----------------------------------
// Chirp 3 HD synthesis latency scales with input length, so one call on a full
// ~1.5k-char scene is slow (batch synthesis, not streaming). Splitting the prose
// into sentence-boundary chunks and synthesizing them CONCURRENTLY collapses the
// wall-clock to ~the slowest chunk. The MP3 parts are concatenated in order;
// Google returns constant-bitrate MP3 frames and the joins land on sentence
// pauses, so the seam is inaudible. Total characters (and cost) are unchanged.
//
// (True streaming synthesis — `streamingSynthesize` — is designed for real-time
// text-in/audio-out agents; our scene text is already fully generated and we
// store to Convex storage for the client to play, so concurrent chunking is the
// technique that fits this pipeline.)

const NARRATION_CHUNK_CHARS = 280;
const NARRATION_MAX_CONCURRENCY = 8;

/**
 * Split narration prose into ordered chunks of <= `maxChars`, breaking on
 * sentence/paragraph boundaries so a synthesized chunk always ends on a natural
 * pause. A single runaway sentence longer than the limit is hard-wrapped on
 * spaces. Exported for unit testing.
 */
export function chunkNarrationText(text: string, maxChars: number = NARRATION_CHUNK_CHARS): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];
  const pieces = trimmed.match(/[^.!?\n]+[.!?]*\s*|\n+/g) ?? [trimmed];
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    const c = current.trim();
    if (c) chunks.push(c);
    current = "";
  };
  for (const piece of pieces) {
    if (piece.length > maxChars) {
      // A single sentence longer than the limit: hard-wrap on spaces.
      flush();
      let rest = piece.trim();
      while (rest.length > maxChars) {
        let cut = rest.lastIndexOf(" ", maxChars);
        if (cut <= 0) cut = maxChars;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      current = rest;
      continue;
    }
    if (current.length + piece.length > maxChars) flush();
    current += piece;
  }
  flush();
  return chunks;
}

/** Run async tasks with bounded concurrency, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/**
 * Synthesize prose as concurrent sentence-chunks and concatenate the MP3 bytes
 * in order. Returns a single audio buffer identical in format to a one-shot
 * synthesis, so storage + client playback are unchanged. Short prose takes the
 * single-call fast path.
 */
async function synthesizeNarration(input: {
  text: string;
  voice: { languageCode: string; name: string };
  apiKey: string;
}): Promise<{ bytes: Uint8Array; mime: string; chunks: number }> {
  const chunks = chunkNarrationText(input.text);
  if (chunks.length <= 1) {
    const audio = await synthesizeGoogleTts({ text: input.text, voice: input.voice, apiKey: input.apiKey });
    return { bytes: decodeBase64ToUint8Array(audio.bytes), mime: audio.mime, chunks: Math.max(chunks.length, 1) };
  }
  const parts = await mapWithConcurrency(chunks, NARRATION_MAX_CONCURRENCY, (text) =>
    synthesizeGoogleTts({ text, voice: input.voice, apiKey: input.apiKey }),
  );
  const buffers = parts.map((p) => decodeBase64ToUint8Array(p.bytes));
  const total = buffers.reduce((sum, b) => sum + b.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) {
    merged.set(b, offset);
    offset += b.length;
  }
  return { bytes: merged, mime: parts[0]?.mime ?? "audio/mpeg", chunks: chunks.length };
}

