// Drift-guards for the Discover route's community seed shelf (creator-arc;
// core-read-loop Req 22.3/22.6, product feature 13).
//
// Source-level greps, same pattern as app/creator/__tests__ — mounting the
// RN + Convex tree is out of scope for `node --test`. The behavioral pieces
// (server visibility matrix, cross-account launch, adapter null-mapping,
// template prefill) have vitest coverage in convex/tests/creatorSeedShelf.test.ts,
// lib/__tests__/seedShelfApi.test.ts, and lib/__tests__/creatorTemplates.test.ts;
// here we pin the client wiring.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const discoverSrc = readFileSync(resolve(here, "../index.tsx"), "utf8");

test("the community shelf loads through the seedShelfApi adapter, not raw convexHttp", () => {
  assert.match(
    discoverSrc,
    /from "\.\.\/\.\.\/lib\/seedShelfApi"/,
    "the route must consume the seedShelfApi adapter",
  );
  assert.match(
    discoverSrc,
    /listRemoteCommunitySeeds\(\{/,
    "the shelf must load via listRemoteCommunitySeeds",
  );
  assert.doesNotMatch(
    discoverSrc,
    /convexHttp\(/,
    "no raw convexHttp calls in the route — the lib adapter owns the wire",
  );
});

test("loading, unreachable-with-retry, and empty shelf states all render", () => {
  assert.match(discoverSrc, /seeds === undefined \?/, "a loading state must render before data");
  assert.match(discoverSrc, /seeds === null \?/, "an unreachable state must render");
  assert.match(
    discoverSrc,
    /setShelfNonce\(\(nonce\) => nonce \+ 1\)/,
    "retry must re-trigger the load effect",
  );
  assert.match(
    discoverSrc,
    /The shelf grows as creators publish/,
    "an empty shelf gets the community empty state",
  );
});

test("public seeds launch as fresh runs via the existing createSave path", () => {
  assert.match(
    discoverSrc,
    /library\.createSave\(\s*seed\.storyId,\s*"story",\s*seed\.title,/,
    "launch must go through useLibrary.createSave with the seed storyId + title override",
  );
  assert.match(
    discoverSrc,
    /router\.push\(`\/read\/\$\{save\.saveId\}`\)/,
    "a successful launch must land in the reader",
  );
});

test("the reading-mode segmented control renders and threads into launch createSave", () => {
  // Novel-entry: the compact Branching | Novel segmented control (RC5 — filled
  // Chip for the selected segment, no check-mark glyph) reaches the discover
  // create flow, matching the cover screen.
  assert.match(
    discoverSrc,
    /accessibilityLabel="Reading mode"/,
    "a Reading mode radiogroup must render on the discover surface",
  );
  assert.match(
    discoverSrc,
    /<Chip variant=\{novelMode \? "accent" : "muted"\}>Novel<\/Chip>/,
    "the Novel segment must be a filled Chip when selected (no check glyph)",
  );
  assert.match(
    discoverSrc,
    /<Chip variant=\{novelMode \? "muted" : "accent"\}>Branching<\/Chip>/,
    "the Branching segment must be a filled Chip when selected (no check glyph)",
  );
  assert.doesNotMatch(
    discoverSrc,
    /Branching<\/Chip>[\s\S]*?✓|✓[\s\S]*?Branching/,
    "no check-mark glyph on the segmented control (RC5)",
  );
  // The chosen mode must reach createSave.
  assert.match(
    discoverSrc,
    /readingMode: novelMode \? "novel" : "branching"/,
    "the selected reading mode must thread into library.createSave",
  );
  assert.match(
    discoverSrc,
    /const chooseReadingMode = \(novel: boolean\) =>/,
    "a single chooseReadingMode entry point drives selection + caption reveal",
  );
});

test("the remix CTA honors forkPolicy and routes into the creator drafts shelf", () => {
  assert.match(
    discoverSrc,
    /seed\.forkPolicy === "allowed" \?/,
    "the Remix button must hide when the creator disabled remixing",
  );
  assert.match(discoverSrc, /remixRemoteSeed\(\{/, "remix must call the adapter mutation");
  assert.match(
    discoverSrc,
    /router\.push\(`\/creator\?load=\$\{remixed\.seedId\}`\)/,
    "a successful remix must open the creator route with the new draft loaded",
  );
});

test("the interim surfaces stay: tales archive + the reader's own publishable shelf", () => {
  assert.match(discoverSrc, /<PublishableShelf/, "PublishableShelf remains a secondary section");
  assert.match(discoverSrc, /<DiscoverList/, "the published-tales list remains");
});

test("template cards prefill the creator form from chosen stubs, plus a blank start", () => {
  assert.match(
    discoverSrc,
    /listCreatorTemplates\(\)/,
    "templates must come from the creatorTemplates lib (starter stubs)",
  );
  assert.match(
    discoverSrc,
    /router\.push\(`\/creator\?template=\$\{template\.id\}`\)/,
    "each template card must route to /creator?template=<id>",
  );
  assert.match(
    discoverSrc,
    /Start from a blank page/,
    "a blank-page start must be offered alongside templates",
  );
});
