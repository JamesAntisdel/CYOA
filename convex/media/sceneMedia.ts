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
import type { AccountRecord } from "../account";
import {
  hashPrompt,
  projectSceneMedia,
  type AssetRecord,
  type AssetStatus,
  type SceneMediaProjection,
} from "../assets";
import { mapVoiceIdToGoogleTts } from "../llm/ttsVoices";

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

// Dev-only override. When CYOA_DEV_FORCE_PRO_MEDIA=1 every read becomes
// Pro-eligible regardless of the actual entitlement so the local stack
// is testable without configuring billing.
function devForceProMedia(): boolean {
  return process.env.CYOA_DEV_FORCE_PRO_MEDIA === "1";
}

export const queueSceneImage = internalMutationGeneric({
  args: {
    accountId,
    saveId,
    sceneId: v.id("scenes"),
    prompt: v.string(),
    nodeId: v.optional(v.string()),
    alt: v.optional(v.string()),
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

    // Kick off the async job. runAfter(0) puts it on the next tick.
    await ctx.scheduler.runAfter(0, ("media/sceneMedia:runImagenJob" as unknown) as any, {
      assetId,
      prompt: args.prompt,
    });

    return { queued: true, assetId } as const;
  },
});

export const runImagenJob = actionGeneric({
  args: {
    assetId: v.id("assets"),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    // Mark generating.
    await ctx.runMutation(
      ("media/sceneMedia:markGenerating" as unknown) as any,
      { assetId: args.assetId, jobId: `imagen_${now}`, at: now },
    );

    // Live Imagen path when GEMINI_API_KEY or Vertex creds are present.
    // Falls back to a deterministic Picsum placeholder when (a) no key
    // is configured OR (b) the configured key is invalid / Imagen
    // returned an error. Bad-key shouldn't be fatal — dev still gets a
    // picture, and the failure is logged for operators.
    let liveUrl: string | null = null;
    let liveError: string | null = null;
    try {
      const live = await maybeRunImagen(args.prompt);
      if (live) {
        // Imagen returns ~1-2 MiB of base64 PNG — past Convex's 1 MiB
        // document field limit if stored as a data: URL. Upload bytes to
        // Convex file storage and keep only the short CDN URL on the row.
        const binary = decodeBase64ToUint8Array(live.bytes);
        const blob = new Blob([binary as unknown as BlobPart], { type: live.mime });
        const storageId = await (ctx as any).storage.store(blob);
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

    console.log(`[sceneMedia] queueSceneVideo inserted asset=${assetId} model=${cfg.model}, scheduling runVeoJob`);
    await ctx.scheduler.runAfter(0, ("media/sceneMedia:runVeoJob" as unknown) as any, {
      assetId,
      prompt: args.prompt,
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
  },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    console.log(`[sceneMedia] runVeoJob start asset=${args.assetId}`);
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

    try {
      const operationName = await submitVeoLongRunning(args.prompt, apiKey);
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
      const audio = await synthesizeGoogleTts({
        text: args.prose,
        voice,
        apiKey,
      });
      const binary = decodeBase64ToUint8Array(audio.bytes);
      const blob = new Blob([binary as unknown as BlobPart], { type: audio.mime });
      const storageId = await (ctx as any).storage.store(blob);
      const rawUrl = (await (ctx as any).storage.getUrl(storageId)) as string;
      const url = rewriteToPublicOrigin(rawUrl);
      console.log(`[sceneMedia] TTS stored bytes=${binary.length} url=${url}`);
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
// the prior one left off.
export const recordVeoOperation = mutationGeneric({
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
  ctx: { runMutation: (ref: any, args: any) => Promise<any> },
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
  try {
    await ctx.runMutation(
      ("media/sceneMedia:queueSceneImage" as unknown) as any,
      { ...baseArgs, alt: args.alt ?? `Scene illustration for ${args.nodeId ?? "scene"}` },
    );
  } catch {
    // non-fatal — Pro media is a tier, text is the contract
  }
  try {
    await ctx.runMutation(
      ("media/sceneMedia:queueSceneVideo" as unknown) as any,
      { ...baseArgs, alt: args.alt ?? `Scene cinematic for ${args.nodeId ?? "scene"}` },
    );
  } catch {
    // non-fatal — Veo failure leaves MediaPlate at Image-ready (reduced-motion fallback)
  }
  // Only queue narration when the caller explicitly provided prose. We
  // refuse to fall back to the (truncated, visual-shaped) `prompt` here
  // because TTS would read prompt-truncation garbage. LLM-driven openings
  // pass undefined on purpose — their narration is queued later in
  // completeSceneStream once the stream finishes.
  if (typeof args.prose === "string" && args.prose.trim().length > 0) {
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
    return projectSceneMedia({ assets, preferredKind: "video" }) ?? null;
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

// Generate an Imagen image. Two routes:
//
//   1. GEMINI_API_KEY (preferred) — generativelanguage.googleapis.com.
//      Same Imagen model surface, but API-key auth (no OAuth refresh).
//      Pick a model with GEMINI_IMAGE_MODEL (defaults to
//      imagen-3.0-generate-002).
//   2. VERTEX_PROJECT_ID + VERTEX_ACCESS_TOKEN — Vertex AI predict.
//      Used when you need quota / SLA / regional control beyond what
//      the public Gemini API gives.
//
// Returns null when no provider is configured so the caller can fall
// back to the Picsum placeholder.
type ImagenBytes = { bytes: string; mime: string };

async function maybeRunImagen(prompt: string): Promise<ImagenBytes | null> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    return runImagenViaGeminiApi(prompt, geminiKey);
  }
  const project = process.env.VERTEX_PROJECT_ID;
  const token = process.env.VERTEX_ACCESS_TOKEN;
  if (project && token) {
    return runImagenViaVertex(prompt, project, token);
  }
  return null;
}

// Swap the scheme+host of a storage URL for the public-facing origin
// declared by CONVEX_PUBLIC_ORIGIN (or the EXPO_PUBLIC_CONVEX_URL the
// client uses, since they're equivalent). The /api/storage/<id> path
// is preserved as-is. Returns the input unchanged when no public origin
// is configured (the localhost dev case).
function rewriteToPublicOrigin(url: string): string {
  const publicOrigin = process.env.CONVEX_PUBLIC_ORIGIN ?? process.env.EXPO_PUBLIC_CONVEX_URL;
  if (!publicOrigin) return url;
  // String-replace approach: Convex's V8 runtime rejects the WHATWG URL
  // `host` / `protocol` setters with "Not implemented". Match the
  // scheme://host[:port] prefix and swap it for the public origin's prefix.
  const match = /^(https?:\/\/[^/]+)(.*)$/.exec(url);
  if (!match) return url;
  const trimmedPublic = publicOrigin.replace(/\/+$/, "");
  return `${trimmedPublic}${match[2]}`;
}

function decodeBase64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function runImagenViaGeminiApi(prompt: string, apiKey: string): Promise<ImagenBytes | null> {
  const model = process.env.GEMINI_IMAGE_MODEL ?? "imagen-4.0-fast-generate-001";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`;
  const body = {
    instances: [{ prompt }],
    parameters: { sampleCount: 1, aspectRatio: "16:9" },
  };
  // Diagnostic: confirm the deployment env carries the same key value we
  // expect. Google keys are 39 chars; if length differs the env was pushed
  // wrong (trailing whitespace / truncation / wrong key entirely).
  console.log(
    `[sceneMedia] Imagen model=${model} keyLen=${apiKey.length} keyPrefix=${apiKey.slice(0, 6)} keySuffix=${apiKey.slice(-4)}`,
  );
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    const safe = text.replace(apiKey, "<redacted>").slice(0, 200);
    throw new Error(`gemini_imagen_${res.status}: ${safe}`);
  }
  const data = (await res.json()) as { predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }> };
  const first = data.predictions?.[0];
  if (!first?.bytesBase64Encoded) return null;
  return { bytes: first.bytesBase64Encoded, mime: first.mimeType ?? "image/png" };
}

// Veo 3.1 lite via the public Gemini API. Two-step protocol:
//   1. POST predictLongRunning → returns { name: "operations/..." }.
//   2. GET operations/{name} every 5s until done or we run out of polls.
//
// On success returns the generated video URI. On API failure throws so
// the caller can record a structured error. On polling timeout returns
// null (caller treats as no output → mark failed).
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
async function submitVeoLongRunning(prompt: string, apiKey: string): Promise<string | null> {
  const cfg = resolveVeoConfigFromEnv();
  const submitUrl = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:predictLongRunning`;
  const submitBody = {
    instances: [{ prompt }],
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

async function runImagenViaVertex(prompt: string, project: string, token: string): Promise<ImagenBytes | null> {
  const location = process.env.VERTEX_LOCATION ?? "us-central1";
  const model = "imagen-4.0-fast-generate-001";
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:predict`;
  const body = {
    instances: [{ prompt }],
    parameters: { sampleCount: 1, aspectRatio: "16:9" },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`vertex_imagen_${res.status}: ${text.slice(0, 120)}`);
  }
  const data = (await res.json()) as { predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }> };
  const first = data.predictions?.[0];
  if (!first?.bytesBase64Encoded) return null;
  return { bytes: first.bytesBase64Encoded, mime: first.mimeType ?? "image/png" };
}
