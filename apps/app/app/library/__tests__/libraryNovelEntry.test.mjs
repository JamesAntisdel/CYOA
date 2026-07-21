// Drift-guards for the library route's reading-mode (Novel-entry) control.
//
// Source-level greps, same pattern as app/discover/__tests__ — mounting the
// RN + Convex tree is out of scope for `node --test`. Here we pin the client
// wiring: the compact Branching | Novel segmented control (RC5 — filled Chip
// for the selected segment, NO check-mark glyph) renders on the library create
// surface, and the chosen mode threads into useLibrary.createSave. The
// entitlement re-gate is covered server-side (posture A).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const librarySrc = readFileSync(resolve(here, "../index.tsx"), "utf8");

test("the reading-mode segmented control renders on the library create surface", () => {
  assert.match(
    librarySrc,
    /accessibilityRole="radiogroup"/,
    "the control must be a radiogroup",
  );
  assert.match(
    librarySrc,
    /accessibilityLabel="Reading mode"/,
    "a Reading mode radiogroup must render on the library shelf",
  );
  assert.match(
    librarySrc,
    /<Chip variant=\{novelMode \? "accent" : "muted"\}>Novel<\/Chip>/,
    "the Novel segment must be a filled Chip when selected",
  );
  assert.match(
    librarySrc,
    /<Chip variant=\{novelMode \? "muted" : "accent"\}>Branching<\/Chip>/,
    "the Branching segment must be a filled Chip when selected",
  );
});

test("the segments are 44px touch targets and carry accessibilityState.selected", () => {
  assert.match(librarySrc, /minHeight: 44/, "each segment Pressable must be a 44px touch target");
  assert.match(
    librarySrc,
    /accessibilityState=\{\{ selected: !novelMode \}\}/,
    "the Branching segment must announce its selected state",
  );
  assert.match(
    librarySrc,
    /accessibilityState=\{\{ selected: novelMode \}\}/,
    "the Novel segment must announce its selected state",
  );
});

test("no check-mark glyph on the control (RC5 glyph discipline)", () => {
  assert.doesNotMatch(librarySrc, /✓/, "no check-mark glyph anywhere on the library surface");
});

test("the caption reveals only after the reader changes the selection", () => {
  assert.match(
    librarySrc,
    /const \[modeCaptionVisible, setModeCaptionVisible\] = useState\(false\)/,
    "the caption starts hidden",
  );
  assert.match(
    librarySrc,
    /const chooseReadingMode = \(novel: boolean\) =>/,
    "a single chooseReadingMode entry point drives selection + caption reveal",
  );
  assert.match(
    librarySrc,
    /modeCaptionVisible \? \(/,
    "the caption renders only when modeCaptionVisible is true",
  );
});

test("the selected reading mode threads into library.createSave", () => {
  assert.match(
    librarySrc,
    /readingMode: novelMode \? "novel" : "branching"/,
    "the starter launch must forward the chosen reading mode",
  );
  // Threaded as the 6th arg (options), after seed=undefined — matches the cover
  // screen so the createSave signature stays consistent across surfaces.
  assert.match(
    librarySrc,
    /library\.createSave\(\s*story\.id,\s*"story",\s*undefined,\s*narrator\.voiceId,\s*undefined,\s*\{ readingMode: novelMode \? "novel" : "branching" \},\s*\)/,
    "options.readingMode must ride along the starter createSave call",
  );
});
