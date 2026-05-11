import { afterEach, describe, expect, it } from "vitest";

import { projectSceneMedia, type AssetRecord } from "../assets";
import { ambientPlaybackAllowed, listAmbientLoops, selectAmbientLoop } from "../media/audio";
import { queueImagenAsset, shouldQueueImageForScene, startImagenJob } from "../media/imagen";
import {
  DEFAULT_VEO_CONFIG,
  estimateVeoClipCostCents,
  queueVeoAsset,
  resolveVeoClipConfig,
  shouldQueueVideoForScene,
  startVeoJob,
  VEO_31_FAST_MODEL,
  VEO_31_MODEL,
  VEO_31_LITE_MODEL,
} from "../media/veo";

const account = {
  _id: "acct",
  ageBand: "18+" as const,
  matureContentEnabled: false,
};

const pro = {
  tier: "pro" as const,
  status: "active" as const,
  includedImages: 10,
  includedVideos: 3,
};

describe("media orchestration", () => {
  afterEach(() => {
    delete process.env.GEMINI_VEO_MODEL;
    delete process.env.VEO_MODEL;
    delete process.env.GEMINI_VEO_DURATION_MS;
    delete process.env.GEMINI_VEO_RESOLUTION;
    delete process.env.GEMINI_VEO_ASPECT_RATIO;
    delete process.env.GEMINI_VEO_ESTIMATED_CENTS_PER_SECOND;
  });

  it("queues Pro Imagen jobs without running provider work inline", () => {
    const asset = queueImagenAsset({
      account,
      entitlement: pro,
      saveId: "save",
      sceneId: "scene",
      nodeId: "node",
      storyId: "story",
      prompt: "A candlelit archive with rain at the windows.",
      alt: "A candlelit archive.",
      tags: ["library", "rain"],
      now: 1,
    });

    expect(asset.status).toBe("queued");
    expect(asset.provider).toBe("vertex-imagen");
    expect(asset.url).toBe("");
    expect(asset.provenance.promptRedacted).toBe(true);
  });

  it("requires active Pro entitlement and media policy approval", () => {
    expect(() =>
      queueImagenAsset({
        account,
        entitlement: { tier: "unlimited", status: "active" },
        saveId: "save",
        sceneId: "scene",
        nodeId: "node",
        storyId: "story",
        prompt: "A safe room.",
        alt: "A safe room.",
        now: 1,
      }),
    ).toThrow("pro_entitlement_required");

    expect(() =>
      queueVeoAsset({
        account,
        entitlement: pro,
        saveId: "save",
        sceneId: "scene",
        nodeId: "node",
        storyId: "story",
        prompt: "An explicit image of a nude figure.",
        alt: "Blocked media.",
        now: 1,
      }),
    ).toThrow("media_policy_blocked");
  });

  it("starts Vertex placeholder jobs and mirrors ready URLs when configured", async () => {
    const image = queueImagenAsset({
      account,
      entitlement: pro,
      saveId: "save",
      sceneId: "scene",
      nodeId: "node",
      storyId: "story",
      prompt: "A brass door opening into dawn.",
      alt: "A brass door opening into dawn.",
      now: 1,
    });
    const readyImage = await startImagenJob({
      asset: image,
      storyId: "story",
      now: 2,
      cdnBaseUrl: "https://cdn.example/assets",
    });

    expect(readyImage.status).toBe("ready");
    expect(readyImage.url).toMatch(/^https:\/\/cdn\.example\/assets\/generated\/images/u);
    expect(readyImage.provenance.storagePath).toContain("generated/images");

    const video = queueVeoAsset({
      account,
      entitlement: pro,
      saveId: "save",
      sceneId: "scene",
      nodeId: "death",
      storyId: "story",
      prompt: "A short candlelit death cinematic.",
      alt: "A short candlelit death cinematic.",
      now: 3,
    });
    const readyVideo = await startVeoJob({
      asset: video,
      storyId: "story",
      now: 4,
      cdnBaseUrl: "https://cdn.example/videos/",
    });

    expect(readyVideo.status).toBe("ready");
    expect(readyVideo.provider).toBe("gemini-veo");
    expect(readyVideo.provenance.model).toBe(DEFAULT_VEO_CONFIG.model);
    expect(readyVideo.durationMs).toBe(4000);
    expect(readyVideo.url).toMatch(/^https:\/\/cdn\.example\/videos\/generated\/videos/u);

    const convexUrlVideo = await startVeoJob({
      asset: {
        ...video,
        _id: "queued-convex-url-video",
        status: "queued",
      },
      storyId: "story",
      now: 5,
    });
    expect(convexUrlVideo.url).toMatch(/^convex:\/\/generated\/videos/u);
  });

  it("defaults video clips to Veo 3.1 Lite low-cost settings", () => {
    const video = queueVeoAsset({
      account,
      entitlement: pro,
      saveId: "save",
      sceneId: "scene",
      nodeId: "beat",
      storyId: "story",
      prompt: "A four second establishing shot of an iron door.",
      alt: "An iron door.",
      now: 5,
    });

    expect(video.provider).toBe("gemini-veo");
    expect(video.provenance.model).toBe(VEO_31_LITE_MODEL);
    expect(video.tags).toEqual(expect.arrayContaining(["duration:4000", "resolution:720p", "aspect:16:9"]));
    expect(estimateVeoClipCostCents()).toBe(20);
    expect(VEO_31_MODEL).toBe("veo-3.1-generate-preview");
    expect(VEO_31_FAST_MODEL).toBe("veo-3.1-fast-generate-preview");
  });

  it("coerces Veo 3.1 Lite 1080p clips to the documented 8 second duration", () => {
    const config = resolveVeoClipConfig({
      provenance: {
        provider: "gemini-veo",
        model: VEO_31_LITE_MODEL,
        promptHash: "hash",
        promptRedacted: true,
        source: "generated",
      },
      tags: ["duration:4000", "resolution:1080p", "aspect:9:16"],
    });

    expect(config).toMatchObject({
      durationMs: 8000,
      resolution: "1080p",
      estimatedCostCentsPerSecond: 8,
    });
    expect(estimateVeoClipCostCents(config)).toBe(64);
  });

  it("supports env-configured Veo clip settings and legacy Vertex fallback", () => {
    process.env.GEMINI_VEO_MODEL = VEO_31_FAST_MODEL;
    process.env.GEMINI_VEO_DURATION_MS = "6000";
    process.env.GEMINI_VEO_RESOLUTION = "720p";
    process.env.GEMINI_VEO_ASPECT_RATIO = "9:16";
    process.env.GEMINI_VEO_ESTIMATED_CENTS_PER_SECOND = "10";

    expect(resolveVeoClipConfig()).toMatchObject({
      provider: "gemini-veo",
      model: VEO_31_FAST_MODEL,
      durationMs: 6000,
      resolution: "720p",
      aspectRatio: "9:16",
      estimatedCostCentsPerSecond: 10,
    });

    process.env.GEMINI_VEO_MODEL = "veo-2.0-generate-001";

    expect(resolveVeoClipConfig()).toMatchObject({
      provider: "vertex-veo",
      model: "veo-2.0-generate-001",
    });
  });

  it("ignores invalid Veo env values and preserves already-started assets", async () => {
    process.env.GEMINI_VEO_DURATION_MS = "7000";
    process.env.GEMINI_VEO_RESOLUTION = "4k";
    process.env.GEMINI_VEO_ASPECT_RATIO = "1:1";
    process.env.GEMINI_VEO_ESTIMATED_CENTS_PER_SECOND = "-1";

    expect(resolveVeoClipConfig()).toMatchObject(DEFAULT_VEO_CONFIG);

    const generating = {
      ...baseAsset("video-generating", "video"),
      status: "generating" as const,
    };

    await expect(startVeoJob({ asset: generating, storyId: "story", now: 10 })).resolves.toBe(generating);
  });

  it("marks Veo jobs failed when the provider client rejects", async () => {
    const video = queueVeoAsset({
      account,
      entitlement: pro,
      saveId: "save",
      sceneId: "scene",
      nodeId: "beat",
      storyId: "story",
      prompt: "A four second establishing shot of an iron door.",
      alt: "An iron door.",
      now: 5,
    });

    const failed = await startVeoJob({
      asset: video,
      storyId: "story",
      now: 6,
      client: {
        async submitVideoJob() {
          throw new Error("provider_down");
        },
      },
    });

    expect(failed).toMatchObject({
      status: "failed",
      provenance: { errorCode: "provider_down" },
    });
  });

  it("uses fallback Veo error codes and unknown node ids for incomplete assets", async () => {
    const failed = await startVeoJob({
      asset: baseAsset("incomplete-video", "video"),
      storyId: "story",
      now: 6,
      client: {
        async submitVideoJob(input) {
          expect(input.nodeId).toBe("unknown");
          throw "provider_down";
        },
      },
    });

    expect(failed).toMatchObject({
      status: "failed",
      provenance: { errorCode: "veo_failed" },
    });
  });

  it("leaves queued Veo jobs generating when no output URL is returned yet", async () => {
    const video = queueVeoAsset({
      account,
      entitlement: pro,
      saveId: "save",
      sceneId: "scene",
      nodeId: "beat",
      storyId: "story",
      prompt: "A four second establishing shot of an iron door.",
      alt: "An iron door.",
      now: 5,
    });

    const generating = await startVeoJob({
      asset: video,
      storyId: "story",
      now: 6,
      client: {
        async submitVideoJob(input) {
          expect(input).toMatchObject({
            model: VEO_31_LITE_MODEL,
            durationMs: 4000,
            resolution: "720p",
            aspectRatio: "16:9",
          });
          return { jobId: "job_pending" };
        },
      },
    });

    expect(generating).toMatchObject({
      status: "generating",
      provenance: { jobId: "job_pending" },
    });
    expect(generating.url).toBe("");
  });

  it("projects attached ready assets reactively and prefers ready visuals", () => {
    const queued = {
      ...baseAsset("queued-image", "image"),
      status: "queued" as const,
    };
    const ready = {
      ...baseAsset("ready-video", "video"),
      status: "ready" as const,
      url: "https://cdn/video.mp4",
      durationMs: 6000,
    };

    expect(projectSceneMedia({ assets: [queued] })).toMatchObject({
      status: "queued",
      kind: "image",
    });
    expect(projectSceneMedia({ assets: [queued, ready], preferredKind: "video" })).toMatchObject({
      status: "ready",
      kind: "video",
      uri: "https://cdn/video.mp4",
    });
  });

  it("selects ambient loops only when playback is allowed", () => {
    expect(listAmbientLoops().length).toBeGreaterThan(0);
    expect(ambientPlaybackAllowed({ muted: true, reducedMotion: false, nativeAppState: "active" })).toBe(false);
    expect(
      selectAmbientLoop({
        account,
        entitlement: pro,
        sceneTags: ["rain"],
        theme: "night",
        promptText: "Rain taps at the library window.",
        state: { muted: false, reducedMotion: false, nativeAppState: "active" },
      }),
    ).toMatchObject({ id: "distant-rain" });
  });

  it("detects image and video scheduling eligibility by scene state", () => {
    expect(shouldQueueImageForScene({ entitlement: pro, existingAssets: [] })).toBe(true);
    expect(shouldQueueImageForScene({ entitlement: pro, existingAssets: [], nodeTags: ["no_media"] })).toBe(false);
    expect(shouldQueueVideoForScene({ entitlement: pro, existingAssets: [], nodeTags: ["chapter_beat"] })).toBe(true);
    expect(shouldQueueVideoForScene({ entitlement: pro, existingAssets: [], nodeTags: ["cinematic"] })).toBe(true);
    expect(shouldQueueVideoForScene({ entitlement: pro, existingAssets: [], terminalKind: "death" })).toBe(true);
    expect(shouldQueueVideoForScene({ entitlement: null, existingAssets: [], nodeTags: ["chapter_beat"] })).toBe(false);
    expect(
      shouldQueueVideoForScene({
        entitlement: { tier: "free", status: "active" },
        existingAssets: [],
        nodeTags: ["chapter_beat"],
      }),
    ).toBe(false);
    expect(
      shouldQueueVideoForScene({
        entitlement: pro,
        existingAssets: [{ ...baseAsset("existing-video", "video"), status: "ready" }],
        nodeTags: ["chapter_beat"],
      }),
    ).toBe(false);
    expect(
      shouldQueueVideoForScene({
        entitlement: pro,
        existingAssets: [{ ...baseAsset("failed-video", "video"), status: "failed" }],
        nodeTags: ["chapter_beat"],
      }),
    ).toBe(true);
  });
});

function baseAsset(id: string, kind: "image" | "video"): AssetRecord {
  return {
    _id: id,
    accountId: "acct",
    sceneId: "scene",
    kind,
    provider: kind === "image" ? "vertex-imagen" : "gemini-veo",
    url: "",
    status: "queued",
    entitlementRequired: "pro",
    promptHash: id,
    provenance: {
      provider: kind === "image" ? "vertex-imagen" : "gemini-veo",
      promptHash: id,
      promptRedacted: true,
      source: "generated",
    },
    safety: { action: "allow", safetyCategories: [], matureCategories: [], redacted: false },
    alt: id,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
  };
}
