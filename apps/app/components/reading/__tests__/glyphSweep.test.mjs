// R5 glyph-discipline sweep (reader-chrome-declutter, task 3.2 — GS-SWEEP).
//
// The app ships its own 10-glyph icon font (`primitives/Icon.tsx`); R5
// retires off-system UI-CONTROL emoji from the reader surfaces in favour of
// that font or plain text. This drift-guard asserts the flagged control set
// never creeps back into the swept files or the new reader chrome directory.
//
// EXEMPT (must NOT be in the control set below): typographic STORY-ART —
// the ●●○○ beat dots, ▮▮▮▯ candle bar, and ♥ stat glyph — is book-voice and
// stays (R5.2). Those live in `lib/storyEngagement.ts`, which is not swept.
//
// SCOPE NOTE: `reading/DoorsJournal.tsx` is intentionally NOT swept here —
// it is single-owned by RB-COUNTS (task 3.4) this wave, which performs its
// own 🚪→Icon `key` sweep. Adding it here would double-own the file.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../../.."); // apps/app

// The UI-control emoji R5 retires: ▶/⏸ Auto, ⚙ Reading, ✦ AI flag, 🚪 doors,
// 🔒 lock, ✓ selected, × close, ← back. Story-art glyphs are NOT in this set.
const CONTROL_GLYPHS = ["▶", "⏸", "⚙", "✦", "🚪", "🔒", "✓", "×", "←"];

// Files owned by this sweep (task 3.2).
const OWNED_FILES = [
  "components/moderation/AiSceneFlag.tsx",
  "components/reading/IlluminateButton.tsx",
  "components/reading/CandleGutter.tsx",
  "components/navigation/BackToSceneButton.tsx",
  "app/profile/index.tsx",
];

// Every source file under the new reader chrome directory (design §1).
const CHROME_DIR = resolve(appRoot, "components/reading/chrome");
function chromeSources() {
  return readdirSync(CHROME_DIR)
    .filter(
      (f) =>
        (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.includes(".test."),
    )
    .map((f) => join("components/reading/chrome", f));
}

const SWEEP_TARGETS = [...OWNED_FILES, ...chromeSources()];

test("the reader chrome directory contributes source files to the sweep", () => {
  // Guards against a silently-empty sweep if the directory is renamed/moved.
  const chrome = chromeSources();
  assert.ok(
    chrome.length >= 1,
    `expected ≥1 source file under components/reading/chrome, found ${chrome.length}`,
  );
});

test("no UI-control emoji remain in the swept files or the chrome directory", () => {
  for (const rel of SWEEP_TARGETS) {
    const source = readFileSync(resolve(appRoot, rel), "utf8");
    for (const glyph of CONTROL_GLYPHS) {
      assert.ok(
        !source.includes(glyph),
        `control glyph "${glyph}" must not appear in ${rel} (use primitives/Icon or plain text — R5/RC5)`,
      );
    }
  }
});

// Positive drift-guards: the replacements are actually in place, so a future
// refactor that drops the icon can't pass the absence test by deleting the
// affordance entirely.

test("AiSceneFlag discloses AI-generated content as plain text (no ✦)", () => {
  const source = readFileSync(
    resolve(appRoot, "components/moderation/AiSceneFlag.tsx"),
    "utf8",
  );
  assert.match(
    source,
    /AI-generated/,
    "AiSceneFlag must keep the visible AI-generated disclosure caption",
  );
});

test("the candle affordances render the icon-font candle glyph, not an emoji", () => {
  for (const rel of [
    "components/reading/IlluminateButton.tsx",
    "components/reading/CandleGutter.tsx",
  ]) {
    const source = readFileSync(resolve(appRoot, rel), "utf8");
    assert.match(
      source,
      /name="candle"/,
      `${rel} must render the icon-font candle glyph (Icon name="candle")`,
    );
  }
});

test("BackToSceneButton labels back navigation as plain text (no ← arrow)", () => {
  const source = readFileSync(
    resolve(appRoot, "components/navigation/BackToSceneButton.tsx"),
    "utf8",
  );
  assert.match(
    source,
    /Back to current scene/,
    "BackToSceneButton must keep its plain-text Back label",
  );
});
