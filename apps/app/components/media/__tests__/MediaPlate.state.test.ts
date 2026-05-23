import { describe, expect, it } from "vitest";

import { reduceMediaPlate, type SceneMedia } from "../../../hooks/useMediaPlate";

// The reducer is the public surface under test. The MediaPlate state
// components are thin views of this state. After the split-stack refactor
// the image-plate machine collapses to three states (idle / skeleton /
// image) — Veo lifecycle lives in SceneCinematic and is covered by its
// own surface.

const queuedImage: SceneMedia = {
  status: "queued",
  kind: "image",
  alt: "A candlelit threshold.",
};

const readyImage: SceneMedia = {
  status: "ready",
  kind: "image",
  uri: "data:image/gif;base64,AAAA",
  alt: "Warm illustration of a candlelit room.",
};

const readyVideo: SceneMedia = {
  status: "ready",
  kind: "video",
  uri: "https://cdn.test/loop.mp4",
  alt: "A subtle candle-flicker loop.",
};

const failedImage: SceneMedia = {
  status: "failed",
  kind: "image",
  alt: "Could not render scene.",
};

const failedVideo: SceneMedia = {
  status: "failed",
  kind: "video",
  alt: "Cinematic failed.",
};

const blockedImage: SceneMedia = {
  status: "blocked",
  kind: "image",
  alt: "Blocked by content policy.",
};

const empty = {
  state: "idle" as const,
  posterUri: undefined,
  media: undefined,
  imageUnavailable: false,
};

describe("MediaPlate state machine", () => {
  it("starts idle when there is no media", () => {
    const next = reduceMediaPlate(empty, { type: "media", media: undefined });
    expect(next.state).toBe("idle");
    expect(next.posterUri).toBeUndefined();
  });

  it("transitions Skeleton -> Image when the Imagen plate becomes ready", () => {
    const skeleton = reduceMediaPlate(empty, { type: "media", media: queuedImage });
    expect(skeleton.state).toBe("skeleton");
    expect(skeleton.imageUnavailable).toBe(false);

    const image = reduceMediaPlate(skeleton, { type: "media", media: readyImage });
    expect(image.state).toBe("image");
    expect(image.posterUri).toBe(readyImage.uri);
  });

  it("keeps the image anchored when a Veo asset arrives (lower slot handles video)", () => {
    const image = reduceMediaPlate(empty, { type: "media", media: readyImage });
    expect(image.state).toBe("image");

    const afterVideo = reduceMediaPlate(image, { type: "media", media: readyVideo });
    // Image slot does NOT swap to video. The sibling SceneCinematic
    // slot picks the video up on its own.
    expect(afterVideo.state).toBe("image");
    expect(afterVideo.posterUri).toBe(readyImage.uri);
  });

  it("keeps the image anchored when Veo fails after an image was ready", () => {
    const image = reduceMediaPlate(empty, { type: "media", media: readyImage });
    const veoFailed = reduceMediaPlate(image, { type: "media", media: failedVideo });
    expect(veoFailed.state).toBe("image");
    expect(veoFailed.posterUri).toBe(readyImage.uri);
  });

  it("falls back to skeleton when Imagen fails with no prior poster", () => {
    const next = reduceMediaPlate(empty, { type: "media", media: failedImage });
    expect(next.state).toBe("skeleton");
    expect(next.imageUnavailable).toBe(true);
  });

  it("falls back to skeleton when Imagen is blocked by policy", () => {
    const next = reduceMediaPlate(empty, { type: "media", media: blockedImage });
    expect(next.state).toBe("skeleton");
    expect(next.imageUnavailable).toBe(true);
  });

  it("stays on skeleton when a Veo asset is queued and no image exists yet", () => {
    const veoQueued: SceneMedia = {
      status: "queued",
      kind: "video",
      alt: "Cinematic queued.",
    };
    const next = reduceMediaPlate(empty, { type: "media", media: veoQueued });
    expect(next.state).toBe("skeleton");
  });

  it("audio-only media keeps the plate idle (no visual slot painted)", () => {
    const audio: SceneMedia = {
      status: "idle",
      kind: "audio",
      alt: "ambient",
    };
    const next = reduceMediaPlate(empty, { type: "media", media: audio });
    expect(next.state).toBe("idle");
  });
});
