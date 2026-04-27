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

export type VeoJobRequest = {
  account: Pick<AccountRecord, "ageBand" | "matureContentEnabled"> & { _id: string };
  entitlement: Pick<EntitlementRecord, "tier" | "status" | "includedVideos"> | null | undefined;
  saveId: string;
  sceneId: string;
  nodeId: string;
  storyId: string;
  prompt: string;
  alt: string;
  tags?: string[] | undefined;
  now: number;
};

export type VertexVideoClient = {
  submitVideoJob(input: {
    promptHash: string;
    storyId: string;
    nodeId: string;
    model: string;
    durationMs: number;
  }): Promise<{ jobId: string; outputUrl?: string | undefined; storagePath?: string | undefined }>;
};

export const VEO_MODEL = "veo-2.0-generate-001";
export const DEFAULT_VEO_DURATION_MS = 6_000;

export function queueVeoAsset(input: VeoJobRequest): AssetRecord {
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
    kind: "video",
    provider: "vertex-veo",
    prompt: input.prompt,
    model: VEO_MODEL,
    alt: input.alt,
    tags: input.tags,
    safety,
    now: input.now,
  });
}

export async function startVeoJob(input: {
  asset: AssetRecord;
  storyId: string;
  client?: VertexVideoClient | undefined;
  now: number;
  cdnBaseUrl?: string | undefined;
}): Promise<AssetRecord> {
  if (input.asset.status !== "queued") return input.asset;
  try {
    const client = input.client ?? createPlaceholderVeoClient(input.cdnBaseUrl);
    const submitted = await client.submitVideoJob({
      promptHash: input.asset.promptHash,
      storyId: input.storyId,
      nodeId: input.asset.nodeId ?? "unknown",
      model: VEO_MODEL,
      durationMs: DEFAULT_VEO_DURATION_MS,
    });
    const generating = markAssetGenerating(input.asset, submitted.jobId, input.now);
    if (!submitted.outputUrl) return generating;
    return markAssetReady({
      asset: generating,
      url: submitted.outputUrl,
      storagePath: submitted.storagePath,
      cdnUrl: submitted.outputUrl,
      durationMs: DEFAULT_VEO_DURATION_MS,
      now: input.now,
    });
  } catch (error) {
    return markAssetFailed(input.asset, error instanceof Error ? error.message : "veo_failed", input.now);
  }
}

export function shouldQueueVideoForScene(input: {
  entitlement: Pick<EntitlementRecord, "tier" | "status"> | null | undefined;
  existingAssets: AssetRecord[];
  nodeTags?: string[] | undefined;
  terminalKind?: "death" | "success" | "failure" | undefined;
}): boolean {
  if (input.entitlement?.tier !== "pro" || input.entitlement.status !== "active") return false;
  if (input.existingAssets.some((asset) => asset.kind === "video" && asset.status !== "failed")) return false;
  const tags = input.nodeTags ?? [];
  return tags.includes("cinematic") || tags.includes("chapter_beat") || input.terminalKind === "death";
}

function createPlaceholderVeoClient(cdnBaseUrl: string | undefined): VertexVideoClient {
  return {
    async submitVideoJob(input) {
      const storagePath = `generated/videos/${input.storyId}/${input.nodeId}/${input.promptHash}.mp4`;
      return {
        jobId: `veo_${input.promptHash}`,
        storagePath,
        outputUrl: cdnBaseUrl ? `${cdnBaseUrl.replace(/\/$/u, "")}/${storagePath}` : `convex://${storagePath}`,
      };
    },
  };
}
