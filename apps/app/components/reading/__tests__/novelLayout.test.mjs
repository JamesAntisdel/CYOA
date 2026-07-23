// Reading-modes Wave 3 (R4.6) — drift guards for the Novel "Turn the page"
// affordance (layouts/Novel.tsx) and its ReaderScreen dispatch wiring. The
// layout imports React Native so it can't be mounted here; these are
// source-level invariants, the same discipline as autoNarratorReader.test.mjs
// and illustratedBook.test.mjs.
//
// Run:
//   node --test apps/app/components/reading/__tests__/novelLayout.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
function read(rel) {
  return readFileSync(resolve(here, rel), "utf8");
}

const novel = read("../layouts/Novel.tsx");
const readerScreen = read("../ReaderScreen.tsx");
const layoutsIndex = read("../layouts/index.ts");
const readerSettings = read("../../../hooks/useReaderSettings.ts");
const book = read("../layouts/Book.tsx");

// --- Novel is a CONTENT axis, NOT a sixth cosmetic skin --------------------

test("Novel is NOT registered as a ReaderLayoutVariant / READER_LAYOUTS skin", () => {
  // The affordance changes, not the paint — novel is dispatched by
  // projection.readingMode, orthogonally to the five cosmetic skins (design §4).
  assert.doesNotMatch(layoutsIndex, /from\s*"\.\/Novel"/, "Novel must not be imported into the READER_LAYOUTS record");
  assert.doesNotMatch(layoutsIndex, /\bnovel:\s*NovelLayout/, "Novel must not be a READER_LAYOUTS record entry");
  assert.doesNotMatch(readerSettings, /"novel"/, "novel must not become a ReaderLayoutVariant");
});

// --- Novel consumes the identical ReaderLayoutProps (pipeline never forks) ---

test("NovelLayout consumes the shared ReaderLayoutProps type", () => {
  assert.match(novel, /import\s*\{[^}]*type ReaderLayoutProps[^}]*\}\s*from\s*"\.\/types"/s);
  assert.match(novel, /\}:\s*ReaderLayoutProps\)/);
  // No bespoke prop type — it must not fork the layout contract.
  assert.doesNotMatch(novel, /type\s+NovelLayoutProps\b/);
});

// --- The one contract-moving difference: page-turn REPLACES the choice row ---

test("NovelLayout renders the page-turn affordance and NOT a ChoiceList", () => {
  // Exactly one page-turn affordance; zero ChoiceList (the branching-only row).
  const affordances = novel.match(/<PageTurnAffordance/g) ?? [];
  assert.equal(affordances.length, 1, "expected exactly ONE page-turn affordance");
  assert.doesNotMatch(novel, /<ChoiceList/, "novel mode must not render the branching ChoiceList");
  assert.doesNotMatch(novel, /import\s*\{\s*ChoiceList\s*\}/, "novel must not import ChoiceList");
  // No freeform "Option D" in novel mode — the branch has collapsed.
  assert.doesNotMatch(novel, /onFreeformSubmit=\{/, "novel mode must not wire freeform");
});

test("the affordance carries a single, accessible 'Turn the page' label", () => {
  const labels = novel.match(/accessibilityLabel="Turn the page"/g) ?? [];
  assert.equal(labels.length, 1, "exactly one 'Turn the page' affordance is exposed to a11y");
});

test("the page-turn submits the server choice UNCHANGED via onChoose (RM10/R4.6)", () => {
  // It resolves the server-stamped choice off the projection and hands it to
  // onChoose — the same path a manual tap uses. useTurn is untouched.
  assert.match(novel, /resolvePageTurnChoice<ChoiceProjection>\(projection\.choices\)/);
  assert.match(novel, /onTurn=\{onChoose\}/, "the affordance's turn handler must be the raw onChoose");
  assert.match(novel, /onTurn\(choice\)/, "onTurn fires with the resolved server choice");
  // Submits nothing fabricated — the id is never string-literal-constructed here.
  assert.doesNotMatch(novel, /id:\s*["']turn-page["']/, "novel UI must not fabricate the turn-page id");
});

test("the affordance supports BOTH tap and swipe, and self-guards like the row it replaces", () => {
  assert.match(novel, /Pressable/, "tap affordance");
  assert.match(novel, /PanResponder/, "swipe affordance");
  assert.match(novel, /canTurnPage\(/, "guards on streaming/pending/locked before firing");
  assert.match(novel, /accessibilityState=\{\{\s*disabled:\s*!active\s*\}\}/);
});

// --- Novel keeps the shared reading seams (media / HUD / endings / fallback) -

test("NovelLayout keeps the shared media/HUD/ending/fallback seams", () => {
  for (const seam of [
    "SceneMedia",
    "ProseRenderer",
    "StatsHud",
    "EndingPanel",
    "endingPanelHandlers",
    "FallbackTurnPanel",
    "WhatMightHaveBeen",
  ]) {
    assert.match(novel, new RegExp(seam), `missing shared seam: ${seam}`);
  }
});

test("NovelLayout forwards onReadAsBook into endingPanelHandlers like the cosmetic skins", () => {
  // Same terminal-panel contract as Book/GraphicNovel (R2.7 handoff).
  assert.match(novel, /onSeeMap, onShareEnding, onReadAsBook \}\)/);
  assert.match(book, /onSeeMap, onShareEnding, onReadAsBook \}\)/);
});

// --- ReaderScreen dispatch: readingMode selects Novel over the cosmetic skin -

test("ReaderScreen imports NovelLayout", () => {
  assert.match(readerScreen, /import\s*\{\s*NovelLayout\s*\}\s*from\s*"\.\/layouts\/Novel"/);
});

test("ReaderScreen dispatch: projection.readingMode === 'novel' selects NovelLayout", () => {
  // The novel branch takes over the layout dispatch; absent/branching falls
  // through to the cosmetic READER_LAYOUTS map, byte-identical to today.
  assert.match(
    readerScreen,
    /projection\.readingMode === "novel"\s*\?\s*NovelLayout\s*:\s*\(READER_LAYOUTS\[activeLayout\]\s*\?\?\s*READER_LAYOUTS\.book\)/s,
    "novel dispatch must gate on projection.readingMode and fall back to the skin map",
  );
});

test("branching / legacy saves still dispatch through READER_LAYOUTS (choice row)", () => {
  // The fallback arm is unchanged — a save without readingMode renders the
  // normal skin (and therefore the normal ChoiceList row), unchanged (R5.3).
  assert.match(readerScreen, /READER_LAYOUTS\[activeLayout\]\s*\?\?\s*READER_LAYOUTS\.book/);
});

// --- B2: the novel-only Stamp yields to the single shared ModeChip -----------

test("Novel no longer stamps its own 'Novel' badge (one indicator for both modes)", () => {
  // Reading-modes cleanup B2: the persistent ModeChip in the reader chrome is
  // now the SINGLE mode indicator, so the novel-only <Stamp>Novel</Stamp> and
  // its import are gone — a Branching save reads its mode from the same chip.
  assert.doesNotMatch(novel, /<Stamp>Novel<\/Stamp>/, "the novel-only stamp must be removed");
  assert.doesNotMatch(novel, /\bStamp\b\s*,?\s*Surface/, "the Stamp primitive import must be dropped");
});
