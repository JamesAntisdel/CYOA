import type { AccountRecord } from "../account";
import {
  assertProMediaAllowed,
  createQueuedAsset,
  markAssetFailed,
  markAssetGenerating,
  markAssetReady,
  type AssetRecord,
} from "../assets";
import type { EntitlementRecord } from "../billing/entitlements";

export type ImagenJobRequest = {
  account: Pick<AccountRecord, "ageBand" | "matureContentEnabled"> & { _id: string };
  entitlement: Pick<EntitlementRecord, "tier" | "status" | "includedImages"> | null | undefined;
  saveId: string;
  sceneId: string;
  nodeId: string;
  storyId: string;
  prompt: string;
  alt: string;
  tags?: string[] | undefined;
  now: number;
};

export type VertexImageClient = {
  submitImageJob(input: {
    promptHash: string;
    storyId: string;
    nodeId: string;
    model: string;
  }): Promise<{ jobId: string; outputUrl?: string | undefined; storagePath?: string | undefined }>;
};

export const IMAGEN_MODEL = "imagen-3.0-generate-002";

export function queueImagenAsset(input: ImagenJobRequest): AssetRecord {
  const safety = assertProMediaAllowed({
    account: input.account,
    entitlement: input.entitlement,
    prompt: input.prompt,
  });
  return createQueuedAsset({
    accountId: input.account._id,
    saveId: input.saveId,
    sceneId: input.sceneId,
    nodeId: input.nodeId,
    kind: "image",
    provider: "vertex-imagen",
    prompt: input.prompt,
    model: IMAGEN_MODEL,
    alt: input.alt,
    tags: input.tags,
    safety,
    now: input.now,
  });
}

export async function startImagenJob(input: {
  asset: AssetRecord;
  storyId: string;
  client?: VertexImageClient | undefined;
  now: number;
  cdnBaseUrl?: string | undefined;
}): Promise<AssetRecord> {
  if (input.asset.status !== "queued") return input.asset;
  try {
    const client = input.client ?? createPlaceholderImagenClient(input.cdnBaseUrl);
    const submitted = await client.submitImageJob({
      promptHash: input.asset.promptHash,
      storyId: input.storyId,
      nodeId: input.asset.nodeId ?? "unknown",
      model: IMAGEN_MODEL,
    });
    const generating = markAssetGenerating(input.asset, submitted.jobId, input.now);
    if (!submitted.outputUrl) return generating;
    return markAssetReady({
      asset: generating,
      url: submitted.outputUrl,
      storagePath: submitted.storagePath,
      cdnUrl: submitted.outputUrl,
      now: input.now,
    });
  } catch (error) {
    return markAssetFailed(input.asset, error instanceof Error ? error.message : "imagen_failed", input.now);
  }
}

export function shouldQueueImageForScene(input: {
  entitlement: Pick<EntitlementRecord, "tier" | "status"> | null | undefined;
  existingAssets: AssetRecord[];
  nodeTags?: string[] | undefined;
}): boolean {
  if (input.entitlement?.tier !== "pro" || input.entitlement.status !== "active") return false;
  if (input.existingAssets.some((asset) => asset.kind === "image" && asset.status !== "failed")) return false;
  return !(input.nodeTags ?? []).includes("no_media");
}

function createPlaceholderImagenClient(cdnBaseUrl: string | undefined): VertexImageClient {
  return {
    async submitImageJob(input) {
      const storagePath = `generated/images/${input.storyId}/${input.nodeId}/${input.promptHash}.webp`;
      return {
        jobId: `imagen_${input.promptHash}`,
        storagePath,
        outputUrl: cdnBaseUrl ? `${cdnBaseUrl.replace(/\/$/u, "")}/${storagePath}` : `convex://${storagePath}`,
      };
    },
  };
}
