import type { ContentPolicyContext, ContentPolicySummary, EntitlementTier } from "@cyoa/shared";

import type { AccountRecord } from "./account";
import { evaluateTextPolicy } from "./contentPolicy";
import { AppError } from "./lib/errors";
import type { EntitlementRecord } from "./billing/entitlements";

export type AssetKind = "image" | "video" | "audio";
export type AssetProvider = "vertex-imagen" | "vertex-veo" | "uploaded";
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
  entitlement: Pick<EntitlementRecord, "tier" | "status"> | null | undefined;
  prompt: string;
  surface?: ContentPolicyContext["surface"] | undefined;
}): ContentPolicySummary {
  if (!hasActivePro(input.entitlement)) throw new AppError("pro_entitlement_required");
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
  if (!asset && !input.ambient) return undefined;
  if (!asset) {
    return {
      status: "idle",
      kind: "audio",
      alt: input.ambient?.label ?? "Ambient soundscape",
      ambient: input.ambient,
    };
  }
  return {
    status: asset.status,
    kind: asset.kind,
    ...(asset.status === "ready" && asset.url.length > 0 ? { uri: asset.url } : {}),
    alt: asset.alt ?? defaultAlt(asset.kind),
    ...(asset.durationMs === undefined ? {} : { durationMs: asset.durationMs }),
    ...(input.ambient === undefined ? {} : { ambient: input.ambient }),
  };
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

function assetRank(asset: AssetRecord, preferredKind: "image" | "video" | undefined): number {
  const statusScore = asset.status === "ready" ? 0 : asset.status === "generating" ? 1 : 2;
  const kindScore = preferredKind && asset.kind === preferredKind ? 0 : asset.kind === "image" ? 1 : 2;
  return statusScore * 10 + kindScore;
}

function defaultAlt(kind: AssetKind): string {
  if (kind === "video") return "Generated scene cinematic";
  if (kind === "audio") return "Ambient soundscape";
  return "Generated scene illustration";
}
