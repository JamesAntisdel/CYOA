import { describe, expect, it } from "vitest";

import { reduceMediaPlate, type SceneMedia } from "../../../hooks/useMediaPlate";

// The reducer is the public surface under test. The four MediaPlate state
// components are thin views of this state, so by covering every transition
// here we cover Skeleton -> Image -> Buffering -> Playing and all fallbacks.

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
  videoUri: undefined,
  media: undefined,
  videoFailed: false,
  imageUnavailable: false,
  reduceMotion: false,
};

describe("MediaPlate state machine", () => {
  it("starts idle when there is no media", () => {
    const next = reduceMediaPlate(empty, {
      type: "media",
      media: undefined,
      reduceMotion: false,
    });
    expect(next.state).toBe("idle");
    expect(next.posterUri).toBeUndefined();
  });

  it("transitions Skeleton -> Image when the Imagen plate becomes ready", () => {
    const skeleton = reduceMediaPlate(empty, {
      type: "media",
      media: queuedImage,
      reduceMotion: false,
    });
    expect(skeleton.state).toBe("skeleton");
    expect(skeleton.imageUnavailable).toBe(false);

    const image = reduceMediaPlate(skeleton, {
      type: "media",
      media: readyImage,
      reduceMotion: false,
    });
    expect(image.state).toBe("image");
    expect(image.posterUri).toBe(readyImage.uri);
  });

  it("transitions Image -> Buffering when a Veo asset arrives", () => {
    const image = reduceMediaPlate(empty, {
      type: "media",
      media: readyImage,
      reduceMotion: false,
    });

    const buffering = reduceMediaPlate(image, {
      type: "media",
      media: readyVideo,
      reduceMotion: false,
    });
    expect(buffering.state).toBe("videoBuffering");
    expect(buffering.videoUri).toBe(readyVideo.uri);
    // Poster preserved from the prior image so the plate doesn't flicker.
    expect(buffering.posterUri).toBe(readyImage.uri);
  });

  it("transitions Buffering -> Playing on videoLoaded", () => {
    const image = reduceMediaPlate(empty, {
      type: "media",
      media: readyImage,
      reduceMotion: false,
    });
    const buffering = reduceMediaPlate(image, {
      type: "media",
      media: readyVideo,
      reduceMotion: false,
    });
    const playing = reduceMediaPlate(buffering, { type: "videoLoaded" });
    expect(playing.state).toBe("videoPlaying");
  });

  it("falls back Playing -> Image on Veo failure and keeps the poster", () => {
    const image = reduceMediaPlate(empty, {
      type: "media",
      media: readyImage,
      reduceMotion: false,
    });
    const buffering = reduceMediaPlate(image, {
      type: "media",
      media: readyVideo,
      reduceMotion: false,
    });
    const playing = reduceMediaPlate(buffering, { type: "videoLoaded" });
    expect(playing.state).toBe("videoPlaying");

    const fallback = reduceMediaPlate(playing, { type: "videoFailed" });
    expect(fallback.state).toBe("image");
    expect(fallback.posterUri).toBe(readyImage.uri);
    expect(fallback.videoFailed).toBe(true);
    expect(fallback.videoUri).toBeUndefined();
  });

  it("reduced-motion users stop at Image and never enter Buffering/Playing", () => {
    const image = reduceMediaPlate(empty, {
      type: "media",
      media: readyImage,
      reduceMotion: true,
    });
    expect(image.state).toBe("image");

    // A ready Veo asset arriving must NOT advance the machine.
    const afterVideo = reduceMediaPlate(image, {
      type: "media",
      media: readyVideo,
      reduceMotion: true,
    });
    expect(afterVideo.state).toBe("image");
    expect(afterVideo.videoUri).toBeUndefined();

    // Even an explicit `videoLoaded` event (e.g. a stale callback) cannot
    // promote a reduced-motion plate past state 2.
    const stillImage = reduceMediaPlate(afterVideo, { type: "videoLoaded" });
    expect(stillImage.state).toBe("image");
  });

  it("falls back to skeleton when Imagen fails with no prior poster", () => {
    const next = reduceMediaPlate(empty, {
      type: "media",
      media: failedImage,
      reduceMotion: false,
    });
    expect(next.state).toBe("skeleton");
    expect(next.imageUnavailable).toBe(true);
  });

  it("falls back to skeleton when Imagen is blocked by policy", () => {
    const next = reduceMediaPlate(empty, {
      type: "media",
      media: blockedImage,
      reduceMotion: false,
    });
    expect(next.state).toBe("skeleton");
    expect(next.imageUnavailable).toBe(true);
  });

  it("falls back to image (not skeleton) when Veo fails after an image was ready", () => {
    const image = reduceMediaPlate(empty, {
      type: "media",
      media: readyImage,
      reduceMotion: false,
    });
    const veoFailed = reduceMediaPlate(image, {
      type: "media",
      media: failedVideo,
      reduceMotion: false,
    });
    expect(veoFailed.state).toBe("image");
    expect(veoFailed.posterUri).toBe(readyImage.uri);
    expect(veoFailed.videoFailed).toBe(true);
  });

  it("uses the video URI as poster when Veo is ready but no image landed first", () => {
    const next = reduceMediaPlate(empty, {
      type: "media",
      media: readyVideo,
      reduceMotion: false,
    });
    expect(next.state).toBe("videoBuffering");
    expect(next.posterUri).toBe(readyVideo.uri);
    expect(next.videoUri).toBe(readyVideo.uri);
  });

  it("ignores videoLoaded when not in a buffering state", () => {
    const image = reduceMediaPlate(empty, {
      type: "media",
      media: readyImage,
      reduceMotion: false,
    });
    const noop = reduceMediaPlate(image, { type: "videoLoaded" });
    expect(noop).toEqual(image);
  });

  it("stays on skeleton when a Veo asset is queued and no image exists yet", () => {
    const veoQueued: SceneMedia = {
      status: "queued",
      kind: "video",
      alt: "Cinematic queued.",
    };
    const next = reduceMediaPlate(empty, {
      type: "media",
      media: veoQueued,
      reduceMotion: false,
    });
    expect(next.state).toBe("skeleton");
  });
});
