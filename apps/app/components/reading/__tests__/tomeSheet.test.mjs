// Drift-guards for TomeSheet (reader-chrome-declutter Wave 1, R2 / RC10 / U5).
// Source-level greps in the house style. These replace the reader-save-actions
// accessibility guard (RC6): the auxiliary actions now live behind one sheet,
// so the sheet's a11y + close + focus contracts are what must not regress.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "../chrome/TomeSheet.tsx"), "utf8");

const BANNED_EMOJI = ["▶", "⏸", "⚙", "✦", "🚪", "🔒", "✓", "×"];

test("TomeSheet exports its component and the canonical TomeRow shape", () => {
  assert.match(src, /export function TomeSheet\(/);
  assert.match(src, /export type TomeRow = \{/);
  // The row shape mirrors design §1 (key/label/icon?/onPress/selected?).
  for (const field of ["key", "label", "icon", "onPress", "selected"]) {
    assert.match(src, new RegExp(`${field}[?]?:`), `TomeRow must carry a ${field} field`);
  }
});

test("TomeSheet is a Modal that closes on backdrop tap and on request", () => {
  assert.match(src, /<Modal\b/);
  assert.match(src, /onRequestClose=\{onClose\}/);
  // The full-screen backdrop Pressable closes the sheet.
  assert.match(src, /accessibilityLabel="Close the Tome"[\s\S]*?onPress=\{onClose\}/);
});

test("TomeSheet has an explicit text Close affordance (no × glyph — RC5)", () => {
  assert.match(src, />\s*Close\s*</);
  assert.match(src, /accessibilityLabel="Close the Tome"/);
});

test("web Escape closes the sheet (U5)", () => {
  assert.match(src, /Platform\.OS === "web"/);
  assert.match(src, /"Escape"/);
  assert.match(src, /event\.key === "Escape"[\s\S]*?onClose\(\)/);
});

test("focus is trapped and restored to the trigger on close (U5)", () => {
  assert.match(src, /activeElement/);
  assert.match(src, /restoreRef\.current/);
  assert.match(src, /\.focus\(\)/);
  // Tab handling implements the trap (first ⇄ last cycling).
  assert.match(src, /event\.key !== "Tab"/);
});

test("reduced motion drops the sheet animation (R2.3 instant)", () => {
  assert.match(src, /animationType=\{reducedMotion \? "none"/);
});

test("phone bottom sheet vs desktop anchored popover, max-width ≈400 (RC10/R7.4)", () => {
  assert.match(src, /isDesktop/);
  assert.match(src, /maxWidth:\s*400/);
  // Phone anchors to the bottom, desktop to the top so the popover sits under
  // the top-right Tome trigger.
  assert.match(src, /justifyContent:\s*isDesktop \? "flex-start" : "flex-end"/);
});

test("rows are ≥44px targets and render an on/off state for toggle rows", () => {
  assert.match(src, /minHeight:\s*44/);
  assert.match(src, /row\.selected \? "on" : "off"/);
});

test("a navigating row closes the sheet; a toggle row stays open (R2.3)", () => {
  assert.match(src, /if \(row\.selected === undefined\) onClose\(\);/);
});

test("no banned control emoji in TomeSheet (RC5)", () => {
  for (const glyph of BANNED_EMOJI) {
    assert.ok(!src.includes(glyph), `TomeSheet must not contain the banned glyph ${glyph}`);
  }
});

// --- P3 UI-event telemetry (analytics) ---------------------------------------

test("TomeSheet fires ui.tome_open when it opens (fire-and-forget)", () => {
  // Best-effort import of the client wrapper.
  assert.match(src, /import\s*\{\s*recordUiEvent\s*\}\s*from\s*"\.\.\/\.\.\/\.\.\/lib\/uiAnalytics"/);
  // An `open`-keyed effect fires the event once per open transition, and the
  // call is dropped (`void`) so it never blocks / throws into render.
  assert.match(src, /if \(open\) void recordUiEvent\("ui\.tome_open"\)/);
  assert.match(src, /\}, \[open\]\);/);
});
