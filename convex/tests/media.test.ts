import { describe, expect, it } from "vitest";

import { projectSceneMedia, type AssetRecord } from "../assets";
import { ambientPlaybackAllowed, listAmbientLoops, selectAmbientLoop } from "../media/audio";
import { queueImagenAsset, shouldQueueImageForScene, startImagenJob } from "../media/imagen";
import { queueVeoAsset, shouldQueueVideoForScene, startVeoJob } from "../media/veo";

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
    const readyVideo = await startVeoJob({ asset: video, storyId: "story", now: 4 });

    expect(readyVideo.status).toBe("ready");
    expect(readyVideo.durationMs).toBe(6000);
    expect(readyVideo.url).toContain("generated/videos");
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
    expect(shouldQueueVideoForScene({ entitlement: pro, existingAssets: [], terminalKind: "death" })).toBe(true);
  });
});

function baseAsset(id: string, kind: "image" | "video"): AssetRecord {
  return {
    _id: id,
    accountId: "acct",
    sceneId: "scene",
    kind,
    provider: kind === "image" ? "vertex-imagen" : "vertex-veo",
    url: "",
    status: "queued",
    entitlementRequired: "pro",
    promptHash: id,
    provenance: {
      provider: kind === "image" ? "vertex-imagen" : "vertex-veo",
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
