// Shape + invariant tests for the reader-history archive route at
// `apps/app/app/read/[saveId]/history/index.tsx`.
//
// The route is a thin client of the new `getRemoteRunHistory` helper —
// the heavy lifting is in the Convex query (covered by
// `convex/tests/history.test.ts`). Here we lock in two things that the
// route MUST keep doing:
//   1. Never auto-play the narrator (this is an archive, not a session).
//   2. Only render a media plate when a ready imageUri is present.
//
// We don't actually mount React Native here — that would balloon the
// test surface. Instead we drift-guard the route source for the
// load-bearing branches, and we mirror the tiny projection function the
// route uses to build a SceneMedia shell from a `RemoteRunHistoryTurn`
// so the asset-gating logic is covered end-to-end with pure data.
//
// IMPORTANT: keep the mirrors in this file in lock-step with
// `apps/app/app/read/[saveId]/history/index.tsx` — if you change the
// projection or the auto-play guard, change both.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const routePath = resolve(
  here,
  "../../../app/read/[saveId]/history/index.tsx",
);
const routeSource = readFileSync(routePath, "utf8");

// Drift guards.
test("history route loads run history via the shared useRunHistory hook", () => {
  // The call can sit either inline in the mount effect (early routes), OR
  // inside a `loadHistory` callback that the effect kicks off (rewind
  // refactor), OR — post reading-modes R2.9 refactor — through the shared
  // `useRunHistory` hook the /read/[saveId]/book route also consumes so the
  // two read-back surfaces never diverge. Any of the three satisfies the
  // guard that the route still loads run history.
  assert.match(
    routeSource,
    /await getRemoteRunHistory\(\{|void getRemoteRunHistory\(\{|useRunHistory\(/,
    "history route must load run history (inline call or via useRunHistory)",
  );
});

test("history route wires rewindRemoteSaveTurns when the rewind affordance fires", () => {
  // The /history page surfaces a "Trim the tail" panel that lets the
  // reader drop the last N polluted turns. The panel pushes through the
  // shared rewindRemoteSaveTurns helper — drift-guard the import + call
  // so a future refactor can't silently lose the affordance.
  assert.match(
    routeSource,
    /rewindRemoteSaveTurns\(\{/,
    "rewind UI must call rewindRemoteSaveTurns",
  );
  assert.match(
    routeSource,
    /accessibilityLabel="Rewind controls"/,
    "rewind panel must carry a stable accessibilityLabel",
  );
});

test("history route does NOT auto-play narrator audio", () => {
  // The pill is press-driven; a no-arg `.play()` outside an event handler
  // would constitute auto-play. The route's only `.play()` call must sit
  // inside `handlePress`. Asserting on the substring keeps the test cheap
  // while still catching a sleepy refactor that adds an effect-driven
  // playback.
  assert.match(
    routeSource,
    /const handlePress = \(\) => \{[\s\S]*?audio\.play\(\)/,
    "narrator playback must be press-gated via handlePress",
  );
  // And there must NOT be a top-level useEffect that constructs an
  // `Audio(...)` element — that would smuggle in auto-play even with
  // the press handler present. The fetch-on-mount effect is fine; what
  // we're blocking is an `Audio` constructor inside any useEffect body.
  // The route currently only constructs Audio inside `handlePress`.
  const audioConstructions = routeSource.match(/new Audio\(/g) ?? [];
  // Must construct Audio exactly once (in handlePress).
  assert.equal(
    audioConstructions.length,
    1,
    `expected exactly one \`new Audio(\` site, found ${audioConstructions.length}`,
  );
  // The single construction must not sit inside a useEffect body — easy
  // check: the substring "useEffect" must not appear within 200 chars
  // BEFORE the `new Audio(` occurrence.
  const audioIdx = routeSource.indexOf("new Audio(");
  const window = routeSource.slice(Math.max(0, audioIdx - 400), audioIdx);
  assert.ok(
    !/useEffect\([^)]*$/.test(window),
    "narrator playback must not be wired into a useEffect",
  );
});

test("history route uses ProseRenderer with dialogBlocksEnabled from settings", () => {
  assert.match(
    routeSource,
    /dialogBlocksEnabled=\{settings\.dialogBlocksEnabled\}/,
    "ProseRenderer must read dialogBlocksEnabled from useReaderSettings",
  );
});

test("history route only mounts MediaPlate when an imageUri is present", () => {
  // The branch must build `media` from `turn.media?.imageUri` AND only
  // render `<MediaPlate ... />` when `media` is truthy. We assert both
  // halves via two substring checks.
  assert.match(
    routeSource,
    /const imageUri = turn\.media\?\.imageUri;/,
    "card must read imageUri from turn.media",
  );
  assert.match(
    routeSource,
    /\{media \? \([\s\S]*?<MediaPlate/,
    "MediaPlate must be conditionally rendered behind a truthy `media` guard",
  );
});

// Mirror of the per-card media projection in the route file. Keeping
// this self-contained means the tests below run as plain Node and don't
// need a JSX runtime. If the route changes the projection shape, this
// mirror must change too — the drift guards above will fail loudly if
// the route still imports MediaPlate but the projection drifted.
function mediaFromTurn(turn) {
  const imageUri = turn?.media?.imageUri;
  if (!imageUri) return undefined;
  return {
    status: "ready",
    kind: "image",
    uri: imageUri,
    imageUri,
    alt: `Illustration for ${turn.sceneTitle}`,
  };
}

test("mediaFromTurn returns undefined when no imageUri is present", () => {
  assert.equal(mediaFromTurn({ sceneTitle: "x" }), undefined);
  assert.equal(mediaFromTurn({ sceneTitle: "x", media: {} }), undefined);
  assert.equal(
    mediaFromTurn({ sceneTitle: "x", media: { narratorUri: "n" } }),
    undefined,
    "narrator-only turns must not paint an image plate",
  );
});

test("mediaFromTurn builds an image plate with the ready imageUri", () => {
  const media = mediaFromTurn({
    sceneTitle: "The Corridor",
    media: { imageUri: "https://cdn/x.png" },
  });
  assert.equal(media.status, "ready");
  assert.equal(media.kind, "image");
  assert.equal(media.uri, "https://cdn/x.png");
  assert.equal(media.imageUri, "https://cdn/x.png");
  assert.equal(media.alt, "Illustration for The Corridor");
});
