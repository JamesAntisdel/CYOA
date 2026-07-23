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
const drawer = read("components/reading/ReaderSettingsDrawer.tsx");
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

test("ReaderScreen dispatches the switch result through the pure router helper (SWITCH-UX #7)", () => {
  // The needs_pro→paywall / ok→confirm / else→noop decision now lives in the
  // unit-tested lib/readingModeRouting.ts; the component keeps only the wiring.
  assert.match(
    readerScreen,
    /import\s*\{[^}]*routeReadingModeResult[^}]*\}\s*from\s*"\.\.\/\.\.\/lib\/readingModeRouting"/s,
  );
  assert.match(readerScreen, /routeReadingModeResult\(result\)/);
  assert.match(readerScreen, /action\.kind === "confirm"/);
  assert.match(readerScreen, /action\.kind === "paywall"/);
  assert.match(readerScreen, /router\.push\("\/paywall\?reason=pro_media"\)/);
});

// --- SWITCH-UX #2 — close the open sheet(s) BEFORE the paywall push ----------

test("ReaderScreen closes the mode sheet + drawer before routing to the paywall (SWITCH-UX #2)", () => {
  // The chip's sheet is a lifted/controlled state so the parent can close it;
  // both it and the drawer must close in the same commit that navigates, or the
  // paywall renders UNDER the still-open Modal on native.
  assert.match(readerScreen, /open=\{modeChipOpen\}/, "ModeChip open is controlled by the parent");
  assert.match(readerScreen, /onOpenChange=\{setModeChipOpen\}/);
  // In the paywall branch, both setters fire before router.push.
  assert.match(
    readerScreen,
    /action\.kind === "paywall"[\s\S]*?setModeChipOpen\(false\)[\s\S]*?setDrawerOpen\(false\)[\s\S]*?router\.push\("\/paywall/,
    "both sheets close before the paywall push",
  );
});

test("ModeChip supports controlled open state so the parent can close it (SWITCH-UX #2)", () => {
  assert.match(chip, /open\?:\s*boolean/);
  assert.match(chip, /onOpenChange\?:\s*\(open:\s*boolean\)\s*=>\s*void/);
  // Falls back to internal state when uncontrolled.
  assert.match(chip, /controlledOpen \?\? openInternal/);
});

// --- SWITCH-UX #4 — confirmed-mode desync on the drawer ----------------------

test("Drawer binds the chooser to the CONFIRMED mode, not the current-scene stamp (SWITCH-UX #4)", () => {
  assert.match(drawer, /confirmedMode\?:\s*ReadingMode\s*\|\s*null/, "drawer takes confirmedMode");
  assert.match(drawer, /confirmedMode \?\? current/, "chooser selection prefers the confirmed target");
  assert.match(drawer, /value=\{selectedMode\}/, "the chooser binds the confirmed-aware selection");
  // Quiet 'next page' note when the confirmed target differs from the scene mode.
  assert.match(drawer, /takes effect on the next page/);
  assert.match(drawer, /pendingNextPage/);
});

test("ReaderScreen threads confirmedMode into the drawer + guards the revert on the effective mode (SWITCH-UX #4)", () => {
  assert.match(readerScreen, /confirmedMode=\{readingModeConfirmed\}/);
  // The no-op guard compares against the EFFECTIVE (pending-aware) mode so a
  // revert tap after a forward switch isn't silently swallowed.
  assert.match(readerScreen, /readingModeConfirmed \?\? currentReadingMode/);
  assert.match(readerScreen, /mode === effectiveMode/);
});

// --- SWITCH-UX #5 — no dead switch on local/demo saves -----------------------

test("ReaderScreen derives a `switchable` flag and passes it to the chip + drawer (SWITCH-UX #5)", () => {
  assert.match(readerScreen, /readingModeSwitchable = supportsFreeform/);
  assert.match(readerScreen, /switchable=\{readingModeSwitchable\}/);
});

test("ModeChip shows the mode as a LABEL-only indicator when not switchable (SWITCH-UX #5)", () => {
  assert.match(chip, /switchable\?:\s*boolean/);
  assert.match(chip, /Mode switching isn&apos;t available for this tale/);
  // The affordance caret is dropped when the save can't switch (label, not toggle).
  assert.match(chip, /switchable \? \(\s*<Text aria-hidden/);
});

test("Drawer shows a LABEL-only indicator (no chooser) when not switchable (SWITCH-UX #5)", () => {
  assert.match(drawer, /switchable\?:\s*boolean/);
  assert.match(drawer, /if \(!switchable\)/);
  assert.match(drawer, /Mode switching isn&apos;t available for this tale/);
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
