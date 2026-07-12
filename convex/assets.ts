import type { ContentPolicyContext, ContentPolicySummary, EntitlementTier } from "@cyoa/shared";

import type { AccountRecord } from "./account";
import { evaluateTextPolicy } from "./contentPolicy";
import { AppError } from "./lib/errors";
import type { EntitlementRecord } from "./billing/entitlements";

export type AssetKind = "image" | "video" | "audio";
export type AssetProvider = "vertex-imagen" | "vertex-veo" | "gemini-veo" | "google-tts" | "uploaded";
export type AssetStatus = "queued" | "generating" | "ready" | "failed" | "blocked";

export type AssetProvenance = {
  provider: AssetProvider;
  model?: string | undefined;
  jobId?: string | undefined;
  promptHash: string;
  promptRedacted: boolean;
  source: "generated" | "ambient_pack" | "upload";
  storagePath?: string | undefined;
  cdnUrl?: string | undefined;
  mirroredAt?: number | undefined;
  errorCode?: string | undefined;
};

export type AssetRecord = {
  _id?: string | undefined;
  accountId: string;
  saveId?: string | undefined;
  taleId?: string | undefined;
  sceneId?: string | undefined;
  nodeId?: string | undefined;
  kind: AssetKind;
  provider: AssetProvider;
  url: string;
  status: AssetStatus;
  entitlementRequired: "pro";
  promptHash: string;
  provenance: AssetProvenance;
  safety: ContentPolicySummary;
  alt?: string | undefined;
  durationMs?: number | undefined;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  readyAt?: number | undefined;
};

export type SceneMediaProjection = {
  status: "idle" | "queued" | "generating" | "ready" | "blocked" | "failed";
  kind: AssetKind;
  uri?: string | undefined;
  alt: string;
  durationMs?: number | undefined;
  ambient?: AmbientLoopProjection | undefined;
  /**
   * Ready image URI for the scene, surfaced independently of the
   * (legacy) primary `uri` so the split UI can anchor the top plate
   * even when video has been picked as the ranked primary asset.
   */
  imageUri?: string | undefined;
  /**
   * Ready video URI for the scene. Same independence rationale as
   * `imageUri` — the lower SceneCinematic slot reads this directly.
   */
  videoUri?: string | undefined;
  // Optional narrator track for the scene. Generated via Google Cloud TTS
  // by convex/media/sceneMedia.ts:runNarrationJob and stored as a parallel
  // `kind: "audio"` asset. The visual (image/video) ranking ignores this
  // field — the narrator rides alongside whatever still/video the plate is
  // showing. Absent when no ready audio asset exists for the scene.
  narrator?: NarratorTrackProjection | undefined;
  // True when a video asset for this scene is queued or generating — the
  // image plate is already up, but Veo is still working. UI uses this to
  // render the "video in progress" pip so users know a cinematic is on
  // the way (Veo 3.1 lite can take 30-90s on the preview tier).
  videoPending?: boolean | undefined;
};

export type NarratorTrackProjection = {
  id: string;
  uri: string;
  voiceId: string;
};

export type AmbientLoopProjection = {
  id: string;
  uri: string;
  label: string;
  tags: string[];
  volume: number;
};

export function assertProMediaAllowed(input: {
  account: Pick<AccountRecord, "ageBand" | "matureContentEnabled"> & { _id?: string | undefined };
  entitlement:
    | Pick<
        EntitlementRecord,
        "tier" | "status" | "includedImages" | "includedVideos" | "creditBalanceCents"
      >
    | null
    | undefined;
  prompt: string;
  surface?: ContentPolicyContext["surface"] | undefined;
}): ContentPolicySummary {
  // Close unmetered Pro media (provider-and-credit-model design §2.4): an active
  // Pro account still needs spendable capacity — either an unused monthly
  // image/video allowance unit OR a positive spark balance. A Pro account that
  // has exhausted both cannot mint further media without buying a pack. The
  // per-job spark ledger in the queue mutations is the precise meter; this is
  // the coarse gate on the legacy pure media helpers. Read capacity BEFORE the
  // `hasActivePro` guard narrows the entitlement down to `{ tier, status }`.
  const hasCapacity =
    (input.entitlement?.includedImages ?? 0) > 0 ||
    (input.entitlement?.includedVideos ?? 0) > 0 ||
    (input.entitlement?.creditBalanceCents ?? 0) > 0;
  if (!hasActivePro(input.entitlement)) throw new AppError("pro_entitlement_required");
  if (!hasCapacity) throw new AppError("pro_media_allowance_exhausted");
  const context: ContentPolicyContext = {
    accountId: input.account._id,
    ageBand: input.account.ageBand,
    entitlementTier: input.entitlement?.tier ?? "free",
    matureContentEnabled: input.account.matureContentEnabled && input.account.ageBand === "18+",
    surface: input.surface ?? "media",
  };
  const safety = evaluateTextPolicy({ text: input.prompt, context });
  if (safety.action !== "allow") throw new AppError("media_policy_blocked");
  return safety;
}

export function hasActivePro(
  entitlement: Pick<EntitlementRecord, "tier" | "status"> | null | undefined,
): entitlement is Pick<EntitlementRecord, "tier" | "status"> & { tier: "pro"; status: "active" } {
  return entitlement?.tier === "pro" && entitlement.status === "active";
}

export function createQueuedAsset(input: {
  accountId: string;
  saveId?: string | undefined;
  taleId?: string | undefined;
  sceneId?: string | undefined;
  nodeId?: string | undefined;
  kind: AssetKind;
  provider: AssetProvider;
  prompt: string;
  model?: string | undefined;
  alt?: string | undefined;
  tags?: string[] | undefined;
  safety: ContentPolicySummary;
  now: number;
}): AssetRecord {
  const promptHash = hashPrompt(input.prompt);
  return {
    accountId: input.accountId,
    ...(input.saveId === undefined ? {} : { saveId: input.saveId }),
    ...(input.taleId === undefined ? {} : { taleId: input.taleId }),
    ...(input.sceneId === undefined ? {} : { sceneId: input.sceneId }),
    ...(input.nodeId === undefined ? {} : { nodeId: input.nodeId }),
    kind: input.kind,
    provider: input.provider,
    url: "",
    status: "queued",
    entitlementRequired: "pro",
    promptHash,
    provenance: {
      provider: input.provider,
      ...(input.model === undefined ? {} : { model: input.model }),
      promptHash,
      promptRedacted: true,
      source: "generated",
    },
    safety: input.safety,
    ...(input.alt === undefined ? {} : { alt: input.alt }),
    tags: input.tags ?? [],
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function markAssetGenerating(asset: AssetRecord, jobId: string, now: number): AssetRecord {
  if (asset.status === "blocked") return asset;
  return {
    ...asset,
    status: "generating",
    provenance: { ...asset.provenance, jobId },
    updatedAt: now,
  };
}

export function markAssetReady(input: {
  asset: AssetRecord;
  url: string;
  now: number;
  storagePath?: string | undefined;
  cdnUrl?: string | undefined;
  durationMs?: number | undefined;
}): AssetRecord {
  const url = input.cdnUrl ?? input.url;
  return {
    ...input.asset,
    url,
    status: "ready",
    provenance: {
      ...input.asset.provenance,
      ...(input.storagePath === undefined ? {} : { storagePath: input.storagePath }),
      ...(input.cdnUrl === undefined ? {} : { cdnUrl: input.cdnUrl, mirroredAt: input.now }),
    },
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    updatedAt: input.now,
    readyAt: input.now,
  };
}

export function markAssetFailed(asset: AssetRecord, errorCode: string, now: number): AssetRecord {
  return {
    ...asset,
    status: "failed",
    provenance: { ...asset.provenance, errorCode },
    updatedAt: now,
  };
}

export function markAssetBlocked(asset: AssetRecord, safety: ContentPolicySummary, now: number): AssetRecord {
  return {
    ...asset,
    status: "blocked",
    safety,
    updatedAt: now,
  };
}

export function projectSceneMedia(input: {
  assets: AssetRecord[];
  preferredKind?: "image" | "video" | undefined;
  ambient?: AmbientLoopProjection | undefined;
}): SceneMediaProjection | undefined {
  const visualAssets = input.assets
    .filter((asset) => asset.kind === "image" || asset.kind === "video")
    .sort((a, b) => assetRank(a, input.preferredKind) - assetRank(b, input.preferredKind));
  const asset = visualAssets[0];
  // Narrator track: parallel concern, not part of the visual ranking. Pick
  // the first ready google-tts audio asset (one per scene by construction).
  const narrator = pickNarratorProjection(input.assets);
  // Surface a "video is generating" signal even when the projection's
  // primary asset is the image (because it's ready first). The video
  // could be queued or generating in parallel; the UI uses this to show
  // the buffering pip during the long Veo wait.
  const videoPending = input.assets.some(
    (a) => a.kind === "video" && (a.status === "queued" || a.status === "generating"),
  );
  if (!asset && !input.ambient && !narrator) return undefined;
  // Always surface the ready image and video URIs as their own fields so
  // the split UI (image-on-top + video-below-prose) can render each slot
  // independently of the legacy video-over-image ranking. Without this,
  // once Veo lands `asset.kind === "video"` and `asset.uri` becomes the
  // video URL — leaving the image slot with no anchor on fresh mounts.
  const readyImage = input.assets.find((a) => a.kind === "image" && a.status === "ready" && a.url.length > 0);
  const readyVideo = input.assets.find((a) => a.kind === "video" && a.status === "ready" && a.url.length > 0);
  const imageUri = readyImage?.url;
  const videoUri = readyVideo?.url;
  if (!asset) {
    return {
      status: "idle",
      kind: "audio",
      alt: input.ambient?.label ?? "Ambient soundscape",
      ambient: input.ambient,
      ...(narrator === undefined ? {} : { narrator }),
      ...(videoPending ? { videoPending: true } : {}),
      ...(imageUri ? { imageUri } : {}),
      ...(videoUri ? { videoUri } : {}),
    };
  }
  return {
    status: asset.status,
    kind: asset.kind,
    ...(asset.status === "ready" && asset.url.length > 0 ? { uri: asset.url } : {}),
    alt: asset.alt ?? defaultAlt(asset.kind),
    ...(asset.durationMs === undefined ? {} : { durationMs: asset.durationMs }),
    ...(input.ambient === undefined ? {} : { ambient: input.ambient }),
    ...(narrator === undefined ? {} : { narrator }),
    ...(imageUri ? { imageUri } : {}),
    ...(videoUri ? { videoUri } : {}),
    ...(videoPending ? { videoPending: true } : {}),
  };
}

function pickNarratorProjection(assets: AssetRecord[]): NarratorTrackProjection | undefined {
  const ready = assets.find(
    (a) => a.kind === "audio" && a.provider === "google-tts" && a.status === "ready" && a.url.length > 0,
  );
  if (!ready || !ready._id) return undefined;
  // voiceId rides on provenance — set by queueSceneNarration. Fall back to
  // the seed default if a legacy row is missing it.
  const provenance = ready.provenance as AssetProvenance & { voiceId?: unknown };
  const voiceId =
    typeof provenance.voiceId === "string" && provenance.voiceId.length > 0
      ? provenance.voiceId
      : "voice.ash";
  return { id: ready._id, uri: ready.url, voiceId };
}

export function readyAssetsForScene(assets: AssetRecord[], sceneId: string): AssetRecord[] {
  return assets.filter((asset) => asset.sceneId === sceneId && asset.status === "ready");
}

export function usageTierForGeneratedMedia(): EntitlementTier {
  return "pro";
}

export function hashPrompt(prompt: string): string {
  let hash = 5381;
  for (let index = 0; index < prompt.length; index += 1) {
    hash = (hash * 33) ^ prompt.charCodeAt(index);
  }
  return `p_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

// Asset ranking: status first (ready > generating > other), then kind.
// Within the same status, video beats image so a ready Veo clip wins
// over a ready Imagen still — that's the Pro media "cinematic upgrade"
// behavior the spec promises. A preferredKind override (e.g. caller
// explicitly requesting "image" for reduced-motion contexts) wins above
// the default kind ordering.
function assetRank(asset: AssetRecord, preferredKind: "image" | "video" | undefined): number {
  const statusScore = asset.status === "ready" ? 0 : asset.status === "generating" ? 1 : 2;
  const kindScore = preferredKind && asset.kind === preferredKind ? 0 : asset.kind === "video" ? 1 : 2;
  return statusScore * 10 + kindScore;
}

function defaultAlt(kind: AssetKind): string {
  if (kind === "video") return "Generated scene cinematic";
  if (kind === "audio") return "Ambient soundscape";
  return "Generated scene illustration";
}
