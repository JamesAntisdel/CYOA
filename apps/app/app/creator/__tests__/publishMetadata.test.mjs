// Drift-guards for the creator route's publish-metadata step + template/blank
// form defaults (creator-arc; core-read-loop Req 22.6). Source-level greps,
// same pattern as creatorShelf.test.mjs; the behavioral halves live in
// convex/tests/creatorSeedShelf.test.ts (publish metadata, lint gate) and
// lib/__tests__/creatorTemplates.test.ts (prefill values).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const creatorSrc = readFileSync(resolve(here, "../index.tsx"), "utf8");

test("the form starts from a chosen template or blank — never hardcoded sample text", () => {
  assert.match(
    creatorSrc,
    /templateFormValues\(typeof params\.template === "string" \? params\.template : null\)/,
    "initial form values must come from templateFormValues(?template=)",
  );
  assert.match(creatorSrc, /useState\(initialForm\.title\)/, "title starts from the template/blank");
  assert.match(
    creatorSrc,
    /useState\(initialForm\.opening\)/,
    "opening starts from the template/blank",
  );
  assert.doesNotMatch(
    creatorSrc,
    /useState\("Lantern Market"\)/,
    "the old Lantern Market default must not return",
  );
});

test("publishing is a two-step act: validate + advisories, then metadata confirm", () => {
  assert.match(
    creatorSrc,
    /const openPublishPanel = async \(\)/,
    "step 1 must open the metadata panel after validation",
  );
  assert.match(
    creatorSrc,
    /setAdvisories\(validation\?\.advisories \?\? \[\]\)/,
    "non-blocking lint advisories must be captured for the panel",
  );
  assert.match(
    creatorSrc,
    /none of these block publishing/,
    "advisories must carry confirmation copy, not error styling",
  );
  assert.match(
    creatorSrc,
    /Confirm and publish/,
    "the panel must gate the actual publish behind an explicit confirm",
  );
});

test("the confirm step forwards the publish metadata to creatorFunctions:publish", () => {
  assert.match(
    creatorSrc,
    /\.\.\.publishMetadataArgs\(\)/,
    "both publish call sites must spread the metadata args",
  );
  assert.match(
    creatorSrc,
    /forkPolicy: \(remixAllowed \? "allowed" : "disabled"\)/,
    "the remix policy buttons must map onto the seed forkPolicy field",
  );
  assert.match(
    creatorSrc,
    /setVisibility\("unlisted"\)/,
    "unlisted must be offered alongside the public shelf",
  );
  assert.match(
    creatorSrc,
    /onChangeText=\{\(next\) => setSynopsis\(next\.slice\(0, 200\)\)\}/,
    "the synopsis input must clamp to the 200-char server budget",
  );
});

test("?load= auto-loads a drafts-shelf seed (the Discover remix landing)", () => {
  assert.match(
    creatorSrc,
    /typeof params\.load === "string"/,
    "the load param must seed pendingLoad",
  );
  assert.match(
    creatorSrc,
    /shelf\.find\(\(entry\) => entry\.seedId === pendingLoad\)/,
    "the pending seed must resolve against the drafts shelf",
  );
});
