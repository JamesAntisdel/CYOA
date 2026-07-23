// Drift-guards for the library route's reading-mode (Novel-entry) control after
// the reading-modes-cleanup (B1). The old inline segmented Branching | Novel
// toggle is retired in favor of the SHARED <ReadingModeChooser> (Wave 1), which
// owns the two option rows and their always-visible blurbs. Source-level greps,
// same pattern as app/discover/__tests__ — mounting the RN + Convex tree is out
// of scope for `node --test`. Here we pin the client wiring: the shared chooser
// renders on the library create surface and the chosen mode threads into
// useLibrary.createSave. The entitlement re-gate is covered server-side.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const librarySrc = readFileSync(resolve(here, "../index.tsx"), "utf8");

test("the shared ReadingModeChooser renders on the library create surface", () => {
  assert.match(
    librarySrc,
    /import \{ ReadingModeChooser \} from "\.\.\/\.\.\/components\/reading\/ReadingModeChooser"/,
    "the library imports the shared chooser",
  );
  assert.match(
    librarySrc,
    /<ReadingModeChooser onChange=\{chooseReadingMode\} value=\{readingMode\} \/>/,
    "the chooser renders with value + onChange bound to the library state",
  );
  // The retired inline toggle is gone.
  assert.doesNotMatch(librarySrc, /accessibilityRole="radiogroup"/, "no inline radiogroup remains");
  assert.doesNotMatch(librarySrc, /<Chip variant=\{novelMode/, "the Chip-based segments are gone");
});

test("the chooser bridges back to the existing novelMode state", () => {
  assert.match(
    librarySrc,
    /const \[novelMode, setNovelMode\] = useState\(false\)/,
    "novelMode stays the local state",
  );
  assert.match(
    librarySrc,
    /const readingMode: ReadingMode = novelMode \? "novel" : "branching"/,
    "readingMode is derived for the chooser value",
  );
  assert.match(
    librarySrc,
    /const chooseReadingMode = \(mode: ReadingMode\) => setNovelMode\(mode === "novel"\)/,
    "chooseReadingMode bridges the chooser onChange back to the boolean",
  );
  assert.doesNotMatch(librarySrc, /modeCaptionVisible/, "the caption-visibility flag is gone");
});

test("no check-mark glyph on the library surface (RC5 glyph discipline)", () => {
  assert.doesNotMatch(librarySrc, /✓/, "no check-mark glyph anywhere on the library surface");
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
