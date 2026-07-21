// Drift-guards for the reader-chrome-declutter Wave 3 home tidy (R5.3, R6):
// the reading-mode toggle is now a compact SEGMENTED control in the "Starter
// adventures" header row (selected = filled Chip styling, NO ✓ glyph), its
// explanatory caption shows only on selection CHANGE, and the continue-lead's
// duplicate rank chip (▣) is dropped while the progress line stays. These read
// the source by path (same pattern as returningHomeAndPaywall.test.mjs) because
// app/index.tsx lives outside the node --test dirs.

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

test("home: reading-mode toggle lives in the Starter adventures header row", () => {
  const src = read("app/index.tsx");
  // The header row carries both the segmented control and the "See all" link.
  assert.match(
    src,
    /Starter adventures[\s\S]*?accessibilityRole="radiogroup"[\s\S]*?See all/,
    "the segmented control renders inside the starter header, opposite See all",
  );
});

test("home: segmented control uses filled Chip styling for the selected segment, no ✓ glyph", () => {
  const src = read("app/index.tsx");
  // Both segments are radio-role Pressables wrapping a Chip.
  assert.match(src, /accessibilityRole="radio"[\s\S]*?onPress=\{\(\) => chooseReadingMode\(false\)\}/, "Branching segment wired to chooseReadingMode(false)");
  assert.match(src, /accessibilityRole="radio"[\s\S]*?onPress=\{\(\) => chooseReadingMode\(true\)\}/, "Novel segment wired to chooseReadingMode(true)");
  // Selected state = filled (accent) chip; unselected = muted. No opacity-only signal, no ✓.
  assert.match(src, /Chip variant=\{novelMode \? "muted" : "accent"\}>Branching</, "Branching selected = accent, unselected = muted");
  assert.match(src, /Chip variant=\{novelMode \? "accent" : "muted"\}>Novel</, "Novel selected = accent, unselected = muted");
  assert.ok(!/✓/.test(src), "no ✓ selected-glyph anywhere in the home source (R5.3)");
});

test("home: reading-mode selection carries accessibilityState.selected on each segment", () => {
  const src = read("app/index.tsx");
  assert.match(src, /accessibilityState=\{\{ selected: !novelMode \}\}/, "Branching announces selected when not novel");
  assert.match(src, /accessibilityState=\{\{ selected: novelMode \}\}/, "Novel announces selected when novel");
});

test("home: the explanatory caption shows only on selection change", () => {
  const src = read("app/index.tsx");
  // A dedicated visibility flag, revealed by the single chooseReadingMode entry point.
  assert.match(src, /const \[modeCaptionVisible, setModeCaptionVisible\] = useState\(false\)/, "caption starts hidden");
  assert.match(
    src,
    /const chooseReadingMode = \(novel: boolean\) => \{\s*setNovelMode\(novel\);\s*setModeCaptionVisible\(true\);/,
    "choosing a mode reveals the caption",
  );
  // The caption itself is gated on that flag.
  assert.match(
    src,
    /\{modeCaptionVisible \? \(\s*<Text muted variant="caption">/,
    "caption only renders when modeCaptionVisible is true",
  );
});

test("home: 44px touch targets on both reading-mode segments", () => {
  const src = read("app/index.tsx");
  const matches = src.match(/minHeight: 44/g) ?? [];
  assert.ok(matches.length >= 2, "each segment Pressable enforces a >=44px touch target");
});

test("home: continue-lead drops the duplicate rank chip (▣) but keeps the progress line", () => {
  const src = read("app/index.tsx");
  assert.ok(!/▣/.test(src), "the duplicate rank chip glyph ▣ is gone from the home lead (R6.2)");
  // The progress line stays and still announces the rank via the a11y label.
  assert.match(src, /librarianRankProgressLine\(librarianRank\)/, "the rank progress line stays on the continue lead");
  assert.match(src, /accessibilityLabel=\{`Librarian rank: \$\{librarianRankChipLabel\(librarianRank\)\}/, "a11y label still announces the rank name");
});

test("home: createSave readingMode threading is unchanged", () => {
  const src = read("app/index.tsx");
  assert.match(
    src,
    /\{ readingMode: novelMode \? "novel" : "branching" \}/,
    "createSave still threads the readingMode from the toggle unchanged (R6 restriction)",
  );
});
