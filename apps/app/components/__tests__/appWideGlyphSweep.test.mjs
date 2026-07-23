// App-wide control-emoji sweep (GLYPH quick-win — finishes the RC5 sweep the
// reader-chrome-declutter started).
//
// The reader-chrome-declutter (see components/reading/__tests__/glyphSweep.test.mjs)
// retired off-system UI-CONTROL emoji from the reader chrome only. This sweep
// extends the same discipline to the remaining control surfaces: the narrator
// control, the choice list, the stats HUD modes, the scene archive, the trophy
// crypt, and the paywall back-affordance.
//
// EXEMPT (must NOT be in the control set below): typographic STORY-ART — the
// ●●○○ beat dots, ▮▮▮▯ candle bar, and ♥ stat glyph — is book-voice and stays.
// Those live in `lib/storyEngagement.ts`, which is NOT owned/swept here. The
// unflagged book-voice stat glyphs ♥ (vitality) and ◈ (nerve) in stats/types.ts
// are likewise intentionally kept — only the overloaded ✦ is retired.
//
// SCOPE NOTE: this file owns ONLY the eight source files listed below. The
// DailyResults surface (KILLCAM) and lib/storyEngagement.ts (story-art) are
// deliberately excluded so ownership stays disjoint.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../.."); // apps/app

// The UI-control emoji retired by RC5: ▶/⏸ play/pause, ⚙ settings, ✦ AI/insight
// flag, 🚪 doors, 🔒 lock, ✓ selected, × close, ← back, ▣ close. Story-art
// glyphs are NOT in this set.
const CONTROL_GLYPHS = ["▶", "⏸", "⚙", "✦", "🚪", "🔒", "✓", "×", "←", "▣"];

// Files owned by this sweep (disjoint from the other three quick-wins).
const OWNED_FILES = [
  "components/media/NarratorControl.tsx",
  "components/choices/ChoiceList.tsx",
  "components/stats/types.ts",
  "components/stats/modes/Persistent.tsx",
  "components/stats/modes/PeekDrawer.tsx",
  "app/read/[saveId]/history/index.tsx",
  "components/endings/TrophyCrypt.tsx",
  "app/paywall/index.tsx",
];

const read = (rel) => readFileSync(resolve(appRoot, rel), "utf8");

test("no control-emoji remain in any owned source file", () => {
  for (const rel of OWNED_FILES) {
    const source = read(rel);
    for (const glyph of CONTROL_GLYPHS) {
      assert.ok(
        !source.includes(glyph),
        `control glyph "${glyph}" must not appear in ${rel} (use primitives/Icon or plain text — RC5)`,
      );
    }
  }
});

// Positive drift-guards: the replacements are actually in place, so a future
// refactor that drops the affordance entirely can't pass the absence test.

test("NarratorControl keeps a plain-text Pause/Resume label", () => {
  const source = read("components/media/NarratorControl.tsx");
  assert.match(source, /"Resume"/, "narrator toggle must keep its Resume label");
  assert.match(source, /"Pause"/, "narrator toggle must keep its Pause label");
});

test("ChoiceList renders the icon-font key for locked rows (no 🔒 emoji)", () => {
  const source = read("components/choices/ChoiceList.tsx");
  assert.match(
    source,
    /name="key"/,
    "locked choice rows must render the icon-font key (Icon name=\"key\")",
  );
});

test("stats/types keeps Vitality/Nerve glyphs and retires ✦ for Insight", () => {
  const source = read("components/stats/types.ts");
  // Unflagged book-voice stat glyphs are kept…
  assert.match(source, /glyph: "♥"/, "Vitality must keep its ♥ glyph");
  assert.match(source, /glyph: "◈"/, "Nerve must keep its ◈ glyph");
  // …and Insight carries a non-flagged marker instead of the retired ✦.
  assert.match(
    source,
    /key: "insight", label: "Insight", glyph: "[^✦]"/u,
    "Insight must carry a non-✦ glyph marker",
  );
});

test("stats HUD modes render the icon-font sack for inventory (no ✦ prefix)", () => {
  for (const rel of [
    "components/stats/modes/Persistent.tsx",
    "components/stats/modes/PeekDrawer.tsx",
  ]) {
    const source = read(rel);
    assert.match(
      source,
      /name="sack"/,
      `${rel} must render the icon-font sack for inventory chips`,
    );
  }
});

test("scene archive keeps a plain-text Narrate label (no ▶)", () => {
  const source = read("app/read/[saveId]/history/index.tsx");
  assert.match(source, /"Narrate"/, "archive narrator pill must keep its Narrate label");
});

test("TrophyCrypt labels the collapse affordance as plain text (no ▣)", () => {
  const source = read("components/endings/TrophyCrypt.tsx");
  assert.match(source, /"Close"/, "trophy crypt must keep its plain-text Close label");
});

test("paywall labels its back-affordance as plain text (no ← arrow)", () => {
  const source = read("app/paywall/index.tsx");
  assert.match(
    source,
    /label="Back to account"/,
    "paywall back button must keep its plain-text Back label",
  );
});
