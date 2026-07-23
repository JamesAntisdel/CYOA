// Reading-modes cleanup (B2) — drift-guards for the persistent in-reader mode
// indicator + live switch: chrome/ModeChip.tsx, its ReaderScreen wiring, and
// the Novel first-scene explainer. TSX with RN + hooks can't be rendered in
// node --test, so we assert source shape (same discipline as
// novelLayout.test.mjs / readingModeChooser.test.mjs).
//
// Run:
//   node --test apps/app/components/reading/__tests__/modeChip.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../../.."); // apps/app
function read(rel) {
  return readFileSync(resolve(appRoot, rel), "utf8");
}

const chip = read("components/reading/chrome/ModeChip.tsx");
const readerScreen = read("components/reading/ReaderScreen.tsx");
const novel = read("components/reading/layouts/Novel.tsx");
const gameApi = read("lib/gameApi.ts");

// --- ModeChip reads the SHARED vocabulary, never re-invents copy -------------

test("ModeChip imports the shared mode meta + mark (one vocabulary)", () => {
  assert.match(
    chip,
    /import\s*\{[^}]*READING_MODE_META[^}]*\}\s*from\s*"\.\.\/\.\.\/\.\.\/lib\/readingMode"/s,
    "ModeChip must render labels/blurbs from READING_MODE_META",
  );
  assert.match(chip, /ModeMark/, "ModeChip must draw the shared ModeMark motif");
  // No hardcoded label strings — the chip label comes from the meta record.
  assert.doesNotMatch(chip, />Branching</, "label must come from READING_MODE_META, not a literal");
});

test("ModeChip is a real button that clears the 44px target (HIG)", () => {
  assert.match(chip, /accessibilityRole="button"/);
  assert.match(chip, /minHeight:\s*44/);
});

test("ModeChip shows the current mode's blurb in its popover", () => {
  assert.match(chip, /meta\.blurb/, "the popover surfaces the always-visible blurb");
});

// --- The switch action fires onSwitch(other) and honors pending --------------

test("ModeChip switches to the OTHER mode via onSwitch", () => {
  assert.match(chip, /const OTHER:\s*Record<ReadingMode,\s*ReadingMode>/);
  assert.match(chip, /onSwitch\(target\)/, "the switch action fires onSwitch with the other mode");
  // "Read as a Novel" / "Read as Branching" affordance copy.
  assert.match(chip, /Read as a Novel/);
  assert.match(chip, /Read as Branching/);
});

test("ModeChip disables + relabels the action while a switch is pending", () => {
  assert.match(chip, /disabled=\{switchPending\}/);
  assert.match(chip, /Switching…/);
});

test("ModeChip surfaces the quiet 'next page' confirmation (no forced flip)", () => {
  assert.match(chip, /takes effect on the next page/);
  // The confirmation shows when the confirmed target matches the OTHER mode.
  assert.match(chip, /confirmedMode === target/);
});

test("ModeChip uses NO control emoji (RC5) — geometric caret only", () => {
  // The ▾ caret is the ▾▸●○ family the contract permits; assert no emoji.
  assert.doesNotMatch(chip, /[\u{1F000}-\u{1FAFF}☀-➿]/u, "no emoji in the chip");
});

// --- ReaderScreen wiring: current mode, switch handler, gate routing ---------

test("ReaderScreen renders the ModeChip in the chrome", () => {
  assert.match(readerScreen, /import\s*\{\s*ModeChip\s*\}\s*from\s*"\.\/chrome\/ModeChip"/);
  assert.match(readerScreen, /<ModeChip/);
});

test("ReaderScreen derives the current mode from projection.readingMode", () => {
  assert.match(
    readerScreen,
    /currentReadingMode:\s*ReadingMode\s*=\s*[\s\S]*?projection\.readingMode === "novel"\s*\?\s*"novel"\s*:\s*"branching"/,
    "branching when the readingMode key is absent",
  );
});

test("ReaderScreen switches through the gameApi setReadingMode seam", () => {
  assert.match(readerScreen, /import\s*\{[^}]*setReadingMode[^}]*\}\s*from\s*"\.\.\/\.\.\/lib\/gameApi"/s);
  assert.match(readerScreen, /await setReadingMode\(\{/);
  // Auth threads as the mutation's NESTED auth object (conditional-spread — no
  // undefined under exactOptionalPropertyTypes).
  assert.match(readerScreen, /\.\.\.\(remoteAuth \? \{ auth: remoteAuth \} : \{\}\)/);
});

test("ReaderScreen routes needs_pro to the Pro paywall like other reader gates", () => {
  assert.match(readerScreen, /reason === "needs_pro"/);
  assert.match(readerScreen, /router\.push\("\/paywall\?reason=pro_media"\)/);
});

test("ReaderScreen passes the switch props to the settings drawer (B3 renders)", () => {
  assert.match(readerScreen, /currentReadingMode=\{currentReadingMode\}/);
  assert.match(readerScreen, /onSwitchReadingMode=\{handleSwitchReadingMode\}/);
  assert.match(readerScreen, /switchPending=\{readingModeSwitchPending\}/);
});

// --- The gameApi seam matches the pinned contract ---------------------------

test("gameApi.setReadingMode POSTs the pinned mutation path", () => {
  assert.match(gameApi, /"readingModeFunctions:setReadingMode"/);
});

// --- Novel: the stamp is gone; the explainer greets the first scene ----------

test("Novel no longer renders its own <Stamp>Novel</Stamp> (single indicator)", () => {
  assert.doesNotMatch(novel, /<Stamp>Novel<\/Stamp>/, "the novel-only stamp must yield to the shared ModeChip");
  assert.doesNotMatch(novel, /import\s*\{[^}]*\bStamp\b[^}]*\}\s*from\s*"\.\.\/\.\.\/primitives"/s, "Stamp import removed");
});

test("Novel shows a dismissable first-scene explainer pointing at the chip", () => {
  assert.match(novel, /NovelExplainer/, "the explainer component exists");
  assert.match(novel, /reads like a novel/, "one line: linear by design");
  assert.match(novel, /reading-mode chip above/, "tells the reader where to switch");
  assert.match(novel, /onDismiss/, "the explainer is dismissable");
  // First-scene gated + persisted so it greets once, not every scene/session.
  assert.match(novel, /isFirstScene/);
  assert.match(novel, /markNovelExplainerDismissed/);
});
