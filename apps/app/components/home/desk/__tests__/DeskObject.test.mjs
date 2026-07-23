// Contract / drift guard for the shared DeskObject seam (the-desk Wave 1, task
// 1.2 — R2.2, R3.2, R3.3, R6.1, DK5).
//
// DeskObject.tsx is TSX and — like the other component drift-guards in this
// repo (illustratedBookPicker, readerSaveActions, returningHomeAndPaywall) —
// cannot be rendered under `node --test` (no JSX parser / transpiler). So this
// file reads the source by path and pins the load-bearing wiring that makes
// DeskObject a REAL labeled button under a swap-safe diegetic frame:
//
//   1. It is a Pressable with accessibilityRole="button" and the REQUIRED
//      plain-words `label` piped to accessibilityLabel (DK5 / R2.2).
//   2. It meets the 44px minimum tappable target (WCAG 2.5.5 / R6.1).
//   3. `onPress` is wired straight to the Pressable (the object fires nav).
//   4. The `art` slot is OPTIONAL and swap-safe: present art renders, absent
//      art falls back to a clean token frame (`art ??` — R3.2 / R2.3).
//   5. Tokens only — no raw hex, no new image assets, theme-driven (R3.1/3.3).
//   6. No control emoji — icon font / text only (RC5).
//   7. Reduced-motion safe: no ambient motion / Animated in the wrapper (DK8).
//   8. A visible focus state exists (R6.1).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "../DeskObject.tsx"), "utf8");

// Strip block + line comments so prose in the doc-comment can't satisfy an
// assertion that must be met by REAL code.
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

test("DeskObject is a Pressable with role button (DK5)", () => {
  assert.match(code, /<Pressable\b/, "must render a Pressable control");
  assert.match(
    code,
    /accessibilityRole=["']button["']/,
    "the control must expose role 'button'",
  );
});

test("the REQUIRED label drives accessibilityLabel (R2.2)", () => {
  // `label` is a required (non-optional) prop on the type.
  assert.match(
    code,
    /\blabel:\s*string;/,
    "`label` must be a required string prop (no `?`)",
  );
  assert.doesNotMatch(
    code,
    /\blabel\?:/,
    "`label` must NOT be optional — it is the plain-words a11y destination",
  );
  assert.match(
    code,
    /accessibilityLabel=\{label\}/,
    "the label must be piped to accessibilityLabel",
  );
});

test("meets the 44px minimum tappable target (R6.1)", () => {
  assert.match(
    code,
    /MIN_TAPPABLE\s*=\s*44\b/,
    "the 44px WCAG floor must be a named constant = 44",
  );
  assert.match(code, /minHeight:\s*MIN_TAPPABLE/, "minHeight must be >= 44");
  assert.match(code, /minWidth:\s*MIN_TAPPABLE/, "minWidth must be >= 44");
});

test("onPress fires the nav straight from the control", () => {
  assert.match(
    code,
    /\bonPress:\s*\(/,
    "onPress must be part of the prop signature",
  );
  assert.match(
    code,
    /onPress=\{onPress\}/,
    "onPress must be wired directly to the Pressable so a press fires nav",
  );
});

test("the art slot is optional and swap-safe (R3.2)", () => {
  // Optional prop on the type...
  assert.match(code, /\bart\?:\s*ReactNode;/, "`art` must be an optional ReactNode");
  // ...that renders when provided, and falls back to a clean frame when absent.
  assert.match(
    code,
    /\{art\s*\?\?/,
    "absent art must fall back (`art ??`) to a clean token frame — never broken",
  );
});

test("art-light: tokens only, no raw hex, no new image assets (R3.1/R3.3)", () => {
  assert.match(
    code,
    /useAppTheme\(\)/,
    "must consume the theme so colors/spacing flow through tokens",
  );
  assert.doesNotMatch(
    code,
    /["'`]#[0-9a-fA-F]{3,8}["'`]/,
    "no raw hex color literals — tokens only",
  );
  assert.doesNotMatch(
    code,
    /\brequire\(["'][^"']*\.(png|jpg|jpeg|webp|svg)["']\)/i,
    "no bundled image assets — the art slot is filled by the caller",
  );
});

test("no control emoji — icon font / text only (RC5)", () => {
  // Any non-ASCII glyph would be an emoji/decorative unicode; the wrapper is
  // pure structure, so the source stays ASCII.
  const nonAscii = code.match(/[^\x00-\x7F]/g);
  assert.equal(
    nonAscii,
    null,
    `no control emoji / decorative unicode allowed; found: ${JSON.stringify(nonAscii)}`,
  );
});

test("reduced-motion safe: no ambient motion in the wrapper (DK8)", () => {
  assert.doesNotMatch(
    code,
    /\bAnimated\b|useSharedValue|withTiming|withRepeat|Easing/,
    "the shared wrapper must render NO ambient motion (a still desk is baseline)",
  );
});

test("a visible focus state exists (R6.1)", () => {
  assert.match(code, /onFocus=/, "must track focus");
  assert.match(code, /onBlur=/, "must clear focus");
  assert.match(
    code,
    /focused\s*\?\s*tokens\.colors\.accent/,
    "focus must be visibly reflected (accent border on focus)",
  );
});
