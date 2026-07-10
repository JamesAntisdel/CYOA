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
    provider: "vertex-veo" | "gemini-veo";
    model: string;
    durationMs: number;
    resolution: "720p" | "1080p";
    aspectRatio: "16:9" | "9:16";
  }): Promise<{ jobId: string; outputUrl?: string | undefined; storagePath?: string | undefined }>;
};

export type VeoClipConfig = {
  provider: "vertex-veo" | "gemini-veo";
  model: string;
  durationMs: 4_000 | 6_000 | 8_000;
  resolution: "720p" | "1080p";
  aspectRatio: "16:9" | "9:16";
  estimatedCostCentsPerSecond: number;
};

export const VEO_31_LITE_MODEL = "veo-3.1-lite-generate-preview";
export const VEO_31_FAST_MODEL = "veo-3.1-fast-generate-preview";
export const VEO_31_MODEL = "veo-3.1-generate-preview";
export const VEO_2_MODEL = "veo-2.0-generate-001";
export const VEO_31_LITE_720P_CENTS_PER_SECOND = 5;
export const VEO_31_LITE_1080P_CENTS_PER_SECOND = 8;

export const DEFAULT_VEO_CONFIG: VeoClipConfig = {
  provider: "gemini-veo",
  model: VEO_31_LITE_MODEL,
  durationMs: 4_000,
  resolution: "720p",
  aspectRatio: "16:9",
  estimatedCostCentsPerSecond: VEO_31_LITE_720P_CENTS_PER_SECOND,
};

export function queueVeoAsset(input: VeoJobRequest): AssetRecord {
  const config = resolveVeoClipConfig();
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
    provider: config.provider,
    prompt: input.prompt,
    model: config.model,
    alt: input.alt,
    tags: [
      ...(input.tags ?? []),
      `duration:${config.durationMs}`,
      `resolution:${config.resolution}`,
      `aspect:${config.aspectRatio}`,
    ],
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
    const config = resolveVeoClipConfig(input.asset);
    const client = input.client ?? createPlaceholderVeoClient(input.cdnBaseUrl);
    const submitted = await client.submitVideoJob({
      promptHash: input.asset.promptHash,
      storyId: input.storyId,
      nodeId: input.asset.nodeId ?? "unknown",
      provider: config.provider,
      model: config.model,
      durationMs: config.durationMs,
      resolution: config.resolution,
      aspectRatio: config.aspectRatio,
    });
    const generating = markAssetGenerating(input.asset, submitted.jobId, input.now);
    if (!submitted.outputUrl) return generating;
    return markAssetReady({
      asset: generating,
      url: submitted.outputUrl,
      storagePath: submitted.storagePath,
      cdnUrl: submitted.outputUrl,
      durationMs: config.durationMs,
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

export function estimateVeoClipCostCents(config: VeoClipConfig = resolveVeoClipConfig()): number {
  return Math.ceil((config.durationMs / 1000) * config.estimatedCostCentsPerSecond);
}

export function resolveVeoClipConfig(asset?: Pick<AssetRecord, "provenance" | "tags">): VeoClipConfig {
  const configuredModel = readOptionalEnv("GEMINI_VEO_MODEL") ?? readOptionalEnv("VEO_MODEL");
  const model = asset?.provenance.model ?? configuredModel ?? DEFAULT_VEO_CONFIG.model;
  const provider = model.startsWith("veo-2.") ? "vertex-veo" : DEFAULT_VEO_CONFIG.provider;
  const resolution = readResolution(asset?.tags) ?? DEFAULT_VEO_CONFIG.resolution;
  const durationMs = coerceDurationForResolution(
    readDuration(asset?.tags) ?? DEFAULT_VEO_CONFIG.durationMs,
    resolution,
  );
  return {
    provider,
    model,
    durationMs,
    resolution,
    aspectRatio: readAspectRatio(asset?.tags) ?? DEFAULT_VEO_CONFIG.aspectRatio,
    estimatedCostCentsPerSecond:
      readNumberEnv("GEMINI_VEO_ESTIMATED_CENTS_PER_SECOND") ??
      defaultEstimatedCentsPerSecond(resolution),
  };
}

function createPlaceholderVeoClient(cdnBaseUrl: string | undefined): VertexVideoClient {
  return {
    async submitVideoJob(input) {
      const storagePath = `generated/videos/${input.storyId}/${input.nodeId}/${input.model}/${input.promptHash}.mp4`;
      return {
        jobId: `veo_${input.model}_${input.promptHash}`,
        storagePath,
        outputUrl: cdnBaseUrl ? `${cdnBaseUrl.replace(/\/$/u, "")}/${storagePath}` : `convex://${storagePath}`,
      };
    },
  };
}

function readDuration(tags?: string[]): VeoClipConfig["durationMs"] | undefined {
  const raw = readTaggedValue(tags, "duration") ?? readOptionalEnv("GEMINI_VEO_DURATION_MS");
  const duration = Number(raw);
  return duration === 4000 || duration === 6000 || duration === 8000 ? duration : undefined;
}

function readResolution(tags?: string[]): VeoClipConfig["resolution"] | undefined {
  const raw = readTaggedValue(tags, "resolution") ?? readOptionalEnv("GEMINI_VEO_RESOLUTION");
  return raw === "720p" || raw === "1080p" ? raw : undefined;
}

function readAspectRatio(tags?: string[]): VeoClipConfig["aspectRatio"] | undefined {
  const raw = readTaggedValue(tags, "aspect") ?? readOptionalEnv("GEMINI_VEO_ASPECT_RATIO");
  return raw === "16:9" || raw === "9:16" ? raw : undefined;
}

function coerceDurationForResolution(
  durationMs: VeoClipConfig["durationMs"],
  resolution: VeoClipConfig["resolution"],
): VeoClipConfig["durationMs"] {
  return resolution === "1080p" ? 8_000 : durationMs;
}

function defaultEstimatedCentsPerSecond(resolution: VeoClipConfig["resolution"]): number {
  return resolution === "1080p" ? VEO_31_LITE_1080P_CENTS_PER_SECOND : VEO_31_LITE_720P_CENTS_PER_SECOND;
}

function readTaggedValue(tags: string[] | undefined, key: string): string | undefined {
  return tags?.find((tag) => tag.startsWith(`${key}:`))?.slice(key.length + 1);
}

function readOptionalEnv(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value : undefined;
}

function readNumberEnv(key: string): number | undefined {
  const value = readOptionalEnv(key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
