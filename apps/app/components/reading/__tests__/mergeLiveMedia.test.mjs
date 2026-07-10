// Regression test for the "narration ahead of on-screen text" bug.
//
// `useSceneMedia` polls Convex by saveId and follows the server's
// `save.currentSceneId`, which flips to scene N+1 the moment
// `beginStreamingChoice` commits. The client's `projection.scene` lags
// until the SSE stream resolves and the canonical refetch lands. During
// that window the live media projection points at N+1 (narrator clip for
// the new scene) while `projection.scene.prose` is still N — merging
// unconditionally played N+1's TTS over N's still-visible text.
//
// This test pins the runtime contract of `mergeLiveMedia.ts` by mirroring
// the (very small) public surface and asserting both the matching and
// mismatched cases. The mirror keeps the test pure-Node so it runs as
// part of `pnpm --filter @cyoa/app test` without a transpiler step.
//
// IMPORTANT: keep the two `expected*` mirrors in lock-step with
// `mergeLiveMedia.ts` — if you change one, change the other.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(here, "../mergeLiveMedia.ts");
const tsSource = readFileSync(sourcePath, "utf8");

// Drift guard: the helper's branching contract is small enough to pin via
// substring assertions. If anyone removes the `nodeId` guard or the early
// return on `!liveMedia`, this test trips before the unit cases run.
assert.match(
  tsSource,
  /if \(!liveMedia\) return true;/,
  "mergeLiveMedia.ts must early-return true when no live media is present",
);
assert.match(
  tsSource,
  /if \(!liveMedia\.nodeId\) return true; \/\/ backwards-compat/,
  "mergeLiveMedia.ts must keep the backwards-compat fallback for missing nodeId",
);
assert.match(
  tsSource,
  /return liveMedia\.nodeId === sceneId;/,
  "mergeLiveMedia.ts must compare nodeId to projection.scene.id",
);

// Pure mirror of the helper, kept in sync with `mergeLiveMedia.ts` so the
// unit cases below exercise the exact same branching the React shell uses.
function liveMediaMatchesScene(liveMedia, sceneId) {
  if (!liveMedia) return true;
  if (!liveMedia.nodeId) return true;
  return liveMedia.nodeId === sceneId;
}

function mergeLiveMediaIntoProjection(projection, liveMedia) {
  if (!liveMedia) return projection;
  if (!liveMediaMatchesScene(liveMedia, projection.scene.id)) return projection;
  return {
    ...projection,
    scene: { ...projection.scene, media: liveMedia },
  };
}

const baseProjection = {
  saveId: "save_demo",
  scene: {
    id: "tale:llm:3",
    title: "The Long Stair",
    prose: "Scene 3 prose body",
    media: { status: "ready", kind: "image", alt: "scene 3" },
  },
};

test("liveMediaMatchesScene returns true when no liveMedia is present", () => {
  assert.equal(liveMediaMatchesScene(null, "tale:llm:3"), true);
  assert.equal(liveMediaMatchesScene(undefined, "tale:llm:3"), true);
});

test("liveMediaMatchesScene returns true when nodeId is absent (backwards-compat)", () => {
  assert.equal(
    liveMediaMatchesScene({ status: "ready", kind: "image", alt: "x" }, "tale:llm:3"),
    true,
  );
});

test("liveMediaMatchesScene returns true when nodeId matches", () => {
  assert.equal(
    liveMediaMatchesScene(
      { status: "ready", kind: "image", alt: "x", nodeId: "tale:llm:3" },
      "tale:llm:3",
    ),
    true,
  );
});

test("liveMediaMatchesScene returns false when nodeId is ahead of projection (the bug)", () => {
  assert.equal(
    liveMediaMatchesScene(
      { status: "ready", kind: "image", alt: "x", nodeId: "tale:llm:4" },
      "tale:llm:3",
    ),
    false,
  );
});

test("mergeLiveMediaIntoProjection swaps the media slot when scenes match", () => {
  const liveMedia = {
    status: "ready",
    kind: "image",
    alt: "live",
    nodeId: "tale:llm:3",
    narrator: { id: "asset_n3", uri: "https://cdn/narration-3.mp3", voiceId: "voice.ash" },
  };
  const merged = mergeLiveMediaIntoProjection(baseProjection, liveMedia);
  assert.notEqual(merged, baseProjection, "should be a new object");
  assert.equal(merged.scene.media.narrator.uri, "https://cdn/narration-3.mp3");
  assert.equal(merged.scene.id, "tale:llm:3");
  assert.equal(merged.saveId, "save_demo");
  assert.equal(merged.scene.prose, "Scene 3 prose body");
});

test("mergeLiveMediaIntoProjection drops the merge when scenes diverge", () => {
  // The bug: live media has narrator for scene 4 but the reader is on 3.
  const liveMedia = {
    status: "ready",
    kind: "image",
    alt: "live",
    nodeId: "tale:llm:4",
    narrator: { id: "asset_n4", uri: "https://cdn/narration-4.mp3", voiceId: "voice.ash" },
  };
  const merged = mergeLiveMediaIntoProjection(baseProjection, liveMedia);
  assert.equal(merged, baseProjection, "should return the original projection by reference");
  // The narrator from scene N+1 must NOT leak onto scene N's projection.
  assert.equal(merged.scene.media.narrator, undefined);
});

test("mergeLiveMediaIntoProjection falls back to unconditional merge when nodeId is absent", () => {
  // Older server projection without nodeId — keep the previous behavior
  // so a stale bundle deployment doesn't black out the narrator entirely.
  const liveMedia = {
    status: "ready",
    kind: "image",
    alt: "live",
    narrator: { id: "asset_old", uri: "https://cdn/legacy.mp3", voiceId: "voice.ash" },
  };
  const merged = mergeLiveMediaIntoProjection(baseProjection, liveMedia);
  assert.equal(merged.scene.media.narrator.uri, "https://cdn/legacy.mp3");
});

test("mergeLiveMediaIntoProjection returns projection unchanged when liveMedia is null", () => {
  assert.equal(mergeLiveMediaIntoProjection(baseProjection, null), baseProjection);
  assert.equal(mergeLiveMediaIntoProjection(baseProjection, undefined), baseProjection);
});
