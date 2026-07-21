// Open-book spread (R4) — behavioral tests for the PURE drop-cap split that
// ProseRenderer's optional `dropCap` treatment is built on, plus source-drift
// pins that the ABSENT-dropCap render stays byte-identical (OB6 / R7.2).
//
// `splitDropCap` lives in ProseRenderer.tsx (which imports React Native), so we
// transpile the .tsx with the repo's TypeScript, STRIP the import lines (no
// bare-specifier resolution in a data: URL — and the RN identifiers are only
// referenced inside the never-called component body), and import the emitted
// JS. Same discipline as pageTurn.test.mjs, extended to a .tsx.
//
// Run:
//   node --test apps/app/components/reading/__tests__/dropCap.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const modulePath = resolve(here, "../ProseRenderer.tsx");
const source = readFileSync(modulePath, "utf8");

const require = createRequire(import.meta.url);
const ts = require("typescript");

const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX,
  },
});
// Drop every import line: the pure export references none of them, and the
// component body (which does) is never invoked here.
const stripped = outputText.replace(/^\s*import[^\n]*\n?/gm, "");
const mod = await import("data:text/javascript," + encodeURIComponent(stripped));
const { splitDropCap, DROP_CAP_MIN_CHARS } = mod;

const LONG =
  "The floor beneath my boots is fused marrow, smooth and pale as river " +
  "stones polished by eons of silence. I take a step, and the sound does not echo.";

test("splitDropCap illuminates the first letter of a long first paragraph", () => {
  const split = splitDropCap(LONG);
  assert.equal(split.hasDropCap, true);
  assert.equal(split.cap, "T");
  assert.equal(split.lead, "");
  // lead + cap + rest reconstructs the original prose exactly (no text lost).
  assert.equal(split.lead + split.cap + split.rest, LONG);
});

test("an opening quote/dash rides in front as the un-enlarged lead", () => {
  const quoted = '"' + LONG;
  const split = splitDropCap(quoted);
  assert.equal(split.hasDropCap, true);
  assert.equal(split.lead, '"', "the quote is the lead, not the enlarged cap");
  assert.equal(split.cap, "T", "the first LETTER is enlarged, not the quote");
  assert.equal(split.lead + split.cap + split.rest, quoted);
});

test("leading whitespace is preserved in the lead", () => {
  const split = splitDropCap("  " + LONG);
  assert.equal(split.hasDropCap, true);
  assert.equal(split.lead, "  ");
  assert.equal(split.cap, "T");
});

test("a SHORT first paragraph degrades to no drop cap (no orphaned cap — R4.2)", () => {
  assert.equal(splitDropCap("The bell tolls.").hasDropCap, false);
  assert.equal(splitDropCap("Run.").hasDropCap, false);
  assert.equal(splitDropCap("").hasDropCap, false);
  assert.equal(splitDropCap("   \n  ").hasDropCap, false);
});

test("only the FIRST paragraph counts toward the length threshold", () => {
  // A short opener followed by a blank line + more prose still degrades: the
  // cap wraps the first paragraph, which is too short to hold it.
  const shortOpener = "The bell.\n\n" + LONG;
  assert.equal(splitDropCap(shortOpener).hasDropCap, false);
});

test("the threshold is tunable and defaults to DROP_CAP_MIN_CHARS", () => {
  assert.equal(typeof DROP_CAP_MIN_CHARS, "number");
  // Same short text passes when the caller lowers the bar.
  assert.equal(splitDropCap("The bell tolls.", 5).hasDropCap, true);
});

test("prose with no letters/digits never produces a cap", () => {
  const punct = "…—" .repeat(100); // long but no illuminable glyph
  assert.equal(splitDropCap(punct).hasDropCap, false);
});

// --- Source-drift: the ABSENT-dropCap render is byte-identical (OB6/R7.2) ---

test("dropCap is an OPTIONAL prop defaulting to false (absent ⇒ today's render)", () => {
  assert.match(source, /dropCap\?:\s*boolean/, "dropCap must be optional on ProseRenderer");
  assert.match(source, /dropCap\s*=\s*false/, "dropCap must default to false");
});

test("the drop cap is gated behind dropCap && !isStreaming (never fights the reveal — R4.3)", () => {
  assert.match(source, /const dropCapActive = dropCap && !isStreaming/);
});

test("the original single-Text and block renders remain the fall-through path", () => {
  // The verbatim `<Text ...>{prose}</Text>` and `{block.text}` renders still
  // exist as the else/fall-through — the absent path is unchanged.
  assert.match(source, /variant=\{textVariant\}>\s*\{prose\}\s*<\/Text>/s);
  assert.match(source, /\) : \(\s*block\.text\s*\)/s);
});
