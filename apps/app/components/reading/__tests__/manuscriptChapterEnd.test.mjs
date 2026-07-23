// Manuscript pass — ChapterEnd headpiece + pill grammar (brainstorm §5).
//
// Source-drift/lint-style guard (same family as themedSurfaces.test.mjs and
// primitives.contract.test.mjs). Pins three things ChapterEnd must carry after
// the manuscript pass:
//   1. HEADPIECE — a centered hairline flourish + icon-font ornament above the
//      recap title, drawn from tokens, NEVER an emoji, and static (no Animated
//      / no transition) so it is inherently reduced-motion safe.
//   2. PAPER — the owned reading Surface opts into the `paper` treatment.
//   3. PILL GRAMMAR — ChapterEnd's own recap pill uses the canonical Chip
//      grammar (`status`, a read-only state pill), not ad-hoc caption text.
//
// Run:
//   node --test apps/app/components/reading/__tests__/manuscriptChapterEnd.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../ChapterEnd.tsx"), "utf8");

// Comment-stripped view of the source — the "no animation / no emoji" sweeps
// run against RENDERED code, not the prose in doc/JSX comments (which may
// legitimately mention "Animated" or use typographic arrows like ⇒).
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

test("ChapterEnd imports the icon-font + Chip primitives it now renders", () => {
  assert.match(
    source,
    /import\s*\{[^}]*\bIcon\b[^}]*\}\s*from\s*["']\.\.\/primitives["']/,
    "ChapterEnd must import Icon (the icon font) for the headpiece",
  );
  assert.match(
    source,
    /import\s*\{[^}]*\bChip\b[^}]*\}\s*from\s*["']\.\.\/primitives["']/,
    "ChapterEnd must import Chip for the pill grammar",
  );
});

test("the headpiece renders an icon-font ornament framed by hairline rules", () => {
  // Icon (not emoji) carries the ornament.
  assert.match(source, /<Icon\b/, "the headpiece must use the Icon font primitive");
  // Two hairline rules (the flourish arms) drawn from tokens.
  const hairlines = source.match(/height:\s*tokens\.borderWidths\.hairline/g) ?? [];
  assert.ok(
    hairlines.length >= 2,
    `expected two hairline flourish rules, found ${hairlines.length}`,
  );
  // The rules read the muted-border token, not a raw color.
  assert.match(source, /backgroundColor:\s*tokens\.colors\.borderMuted/);
  // The word "headpiece" documents intent for the next reader.
  assert.match(source, /headpiece/i);
});

test("the headpiece is reduced-motion safe (static — no animation at all)", () => {
  assert.ok(!/\bAnimated\b/.test(code), "ChapterEnd must not use Animated");
  assert.ok(
    !/useNativeDriver|withTiming|withSpring|Easing|LayoutAnimation/.test(code),
    "the headpiece must be static — no animation primitives",
  );
});

test("the headpiece uses NO emoji (icon font / tokens only)", () => {
  // Pictographic/control emoji must not appear in rendered UI code. Typographic
  // symbols in comments are excluded via `code`. Story-art glyphs (●○▮♥) are
  // exempt by policy and live only in lib/storyEngagement.ts, not here.
  const EMOJI =
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
  assert.ok(!EMOJI.test(code), "ChapterEnd must not contain emoji — use the Icon font");
});

test("ChapterEnd migrates its recap pill onto the `status` grammar", () => {
  assert.match(
    source,
    /<Chip\s+variant="status"/,
    "the read-only recap facts must ride a `status` Chip (the pill grammar)",
  );
});

test("the owned reading Surface opts into the manuscript `paper` treatment", () => {
  assert.match(source, /<Surface\b[\s\S]*?\bpaper\b[\s\S]*?>/, "ChapterEnd's Surface must set `paper`");
});
