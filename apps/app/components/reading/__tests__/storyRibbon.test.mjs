// Drift-guards for StoryRibbon (reader-chrome-declutter Wave 1, R3). Source-
// level greps in the house style (see readerSaveActions.test.mjs) — the pure
// segment model is exercised behaviourally by the co-located vitest file
// ribbonSegments.test.ts. These pin the composition contracts that RC2/R3.3
// depend on and can't be expressed as pure logic.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "../chrome/StoryRibbon.tsx"), "utf8");

// The control-emoji set the R5 sweep bans (story-art ●○▮▯♥ and the geometric
// chevrons ▸▾ are exempt).
const BANNED_EMOJI = ["▶", "⏸", "⚙", "✦", "🚪", "🔒", "✓", "×", "🕯", "🔥", "🧵", "🗝"];

test("StoryRibbon renders from the pure buildRibbonSegments model", () => {
  assert.match(src, /import\s*\{[^}]*buildRibbonSegments[^}]*\}\s*from\s*"\.\/ribbonSegments"/);
});

test("StoryRibbon composes the EXISTING strip components unchanged (RC2)", () => {
  for (const name of ["QuestLine", "ThreadsPill", "DoorsJournal", "DailyPulseChip", "CandleBurnMeter"]) {
    assert.match(src, new RegExp(`<${name}[\\s/>]`), `must mount <${name}>`);
  }
});

test("the detail stays MOUNTED while collapsed so toasts still fire (R3.3)", () => {
  // ThreadsPill must be mounted whenever an arc exists, not only when expanded —
  // its thread-fired echo toast fires from the collapsed state.
  assert.match(src, /arc\s*\?\s*\(\s*\n?\s*<ThreadsPill/);
  // Code-review fix: the collapsed detail uses display:none (NOT a height-0
  // clip — on react-native-web clipped Pressables stay keyboard-Tab-focusable
  // while invisible). display:none keeps the components MOUNTED so the R3.3
  // toast/fetch effects still run, and drops them from the a11y + tab order.
  assert.match(src, /display:\s*"none"/);
  assert.ok(!/height:\s*0/.test(src), "no height-0 clip hiding (invisible-focusable bug)");
  assert.match(src, /no-hide-descendants/);
});

test("candle detail carries the full meter + the patronage door (R3.4)", () => {
  assert.match(src, /<CandleBurnMeter/);
  assert.match(src, /onOpenPatronage/);
  assert.match(src, /Keep the candle burning/);
});

test("all chrome is capped to the shared page column (RC9 / R7.1)", () => {
  assert.match(src, /PAGE_COLUMN_MAX/);
  assert.match(src, /maxWidth:\s*PAGE_COLUMN_MAX/);
});

test("the collapsed row exposes an expanded a11y state and a 44px target", () => {
  assert.match(src, /accessibilityState=\{\{\s*expanded\s*\}\}/);
  assert.match(src, /minHeight:\s*44/);
});

test("StoryRibbon returns null when every signal is absent (RC2)", () => {
  assert.match(src, /if\s*\(segments\.length === 0\)\s*return null;/);
});

test("no banned control emoji in StoryRibbon (RC5)", () => {
  for (const glyph of BANNED_EMOJI) {
    assert.ok(!src.includes(glyph), `StoryRibbon must not contain the banned glyph ${glyph}`);
  }
});

// --- P3 UI-event telemetry (analytics) ---------------------------------------

test("StoryRibbon fires ui.ribbon_expand only on the collapse→expand edge", () => {
  assert.match(src, /import\s*\{\s*recordUiEvent\s*\}\s*from\s*"\.\.\/\.\.\/\.\.\/lib\/uiAnalytics"/);
  // Fires on the pre-toggle `!expanded` (true only when this tap opens the
  // detail), passes the anonymous accountId when available, and is dropped
  // (`void`) so it never blocks / throws into render.
  assert.match(src, /if \(!expanded\)/);
  assert.match(src, /void recordUiEvent\("ui\.ribbon_expand", undefined, auth\?\.accountId\)/);
});
