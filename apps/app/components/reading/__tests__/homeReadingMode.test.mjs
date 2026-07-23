// Drift-guards for the reading-modes-cleanup home wiring (B1). The old inline
// segmented Branching | Novel toggle + reveal-on-change caption is retired in
// favor of the SHARED <ReadingModeChooser> (Wave 1), which owns the two option
// rows and their always-visible blurbs. Here we pin that the cover screen
// renders the shared chooser, bridges it back to the existing `novelMode`
// state, and threads the chosen mode into createSave UNCHANGED. The continue-
// lead cleanup (no duplicate rank chip, progress line kept) is unaffected and
// still guarded. These read the source by path (same pattern as
// returningHomeAndPaywall.test.mjs) because app/index.tsx lives outside the
// node --test dirs.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../../..");

function read(rel) {
  return readFileSync(resolve(appRoot, rel), "utf8");
}

test("home: the shared ReadingModeChooser replaces the inline segmented toggle", () => {
  const src = read("app/index.tsx");
  assert.match(
    src,
    /import \{ ReadingModeChooser \} from "\.\.\/components\/reading\/ReadingModeChooser"/,
    "home imports the shared chooser",
  );
  assert.match(
    src,
    /<ReadingModeChooser[\s\S]*?onChange=\{chooseReadingMode\}[\s\S]*?value=\{readingMode\}[\s\S]*?\/>/,
    "the chooser renders with value + onChange bound to the home state",
  );
  // Novel is a Pro mode — the chooser is gated + wired to the paywall (finding
  // #3: no more silent downgrade at create).
  assert.match(
    src,
    /const novelUnlocked = isIllustratedBookUnlocked\(profile\)/,
    "home resolves Novel entitlement through the shared pro-media gate",
  );
  assert.match(
    src,
    /isPro=\{novelUnlocked\}/,
    "the chooser receives the resolved entitlement",
  );
  assert.match(
    src,
    /onNovelLocked=\{\(\) => router\.push\("\/paywall\?reason=pro_media"\)\}/,
    "a locked Novel tap routes to the pro_media paywall",
  );
  // The retired inline toggle is gone: no home-owned radiogroup/radio chrome,
  // no Chip-based segments.
  assert.doesNotMatch(src, /accessibilityRole="radiogroup"/, "no inline radiogroup remains on home");
  assert.doesNotMatch(src, /<Chip variant=\{novelMode/, "the Chip-based segments are gone");
});

test("home: the chooser sits in the Starter adventures section, opposite See all", () => {
  const src = read("app/index.tsx");
  // The header keeps "Starter adventures" and the "See all" link; the chooser
  // renders just beneath that header row.
  assert.match(
    src,
    /Starter adventures[\s\S]*?See all[\s\S]*?<ReadingModeChooser/,
    "the chooser renders below the starter header row",
  );
});

test("home: the chooser bridges back to the existing novelMode state", () => {
  const src = read("app/index.tsx");
  assert.match(
    src,
    /const \[novelMode, setNovelMode\] = useState\(false\)/,
    "novelMode stays the local state",
  );
  assert.match(
    src,
    /const readingMode: ReadingMode = novelMode \? "novel" : "branching"/,
    "readingMode is derived from novelMode for the chooser value",
  );
  assert.match(
    src,
    /const chooseReadingMode = \(mode: ReadingMode\) => setNovelMode\(mode === "novel"\)/,
    "chooseReadingMode bridges the chooser onChange back to the boolean",
  );
  // The reveal-on-change caption logic is retired — the chooser owns the blurb.
  assert.doesNotMatch(src, /modeCaptionVisible/, "the caption-visibility flag is gone");
});

test("home: no control-emoji check-mark leaks into the source (RC5)", () => {
  const src = read("app/index.tsx");
  assert.ok(!/✓/.test(src), "no ✓ selected-glyph anywhere in the home source");
});

test("home: continue-lead drops the duplicate rank chip (▣) but keeps the progress line", () => {
  const src = read("app/index.tsx");
  assert.ok(!/▣/.test(src), "the duplicate rank chip glyph ▣ is gone from the home lead (R6.2)");
  assert.match(src, /librarianRankProgressLine\(librarianRank\)/, "the rank progress line stays on the continue lead");
  assert.match(src, /accessibilityLabel=\{`Librarian rank: \$\{librarianRankChipLabel\(librarianRank\)\}/, "a11y label still announces the rank name");
});

test("home: createSave readingMode threading is unchanged", () => {
  const src = read("app/index.tsx");
  assert.match(
    src,
    /\{ readingMode: novelMode \? "novel" : "branching" \}/,
    "createSave still threads the readingMode from the selection unchanged",
  );
});
