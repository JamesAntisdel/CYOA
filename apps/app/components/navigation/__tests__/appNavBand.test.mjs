// Band-matrix guard for the AppNav 768–1023 fix (R7.3 / RC10, task 3.3).
//
// The bug this pins: `NAV_ROW_MIN_WIDTH = 1024` used to gate the pill row
// itself, so every 768–1023 desktop-class viewport fell back to the PHONE
// hamburger. R7.3 splits the two concerns:
//
//   - hamburger  vs. pill row  → MEASURED from the live tab count
//     (`navRowNeededWidth`) against the ≥768 desktop breakpoint. Below 768
//     (or any width the row can't fit) → hamburger; ≥768 that fits → pills.
//   - wordmark hidden vs. shown → the 1024 threshold, and ONLY that.
//
// node:test has no React renderer, so this file does two things:
//   1. Structural drift-guard — assert the source wires the decision the way
//      the mirror below assumes (breakpoint + measured need + wordmark gate).
//   2. Band matrix — replicate the component's exact geometry with the real
//      token values and assert 500 / 800 / 1100 → hamburger / compact row /
//      full-wordmark row (plus the band boundaries).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appNavPath = resolve(here, "../AppNav.tsx");
const appNavSource = readFileSync(appNavPath, "utf8");

// --- Token values, pinned from apps/app/theme/themes.ts (sharedSpacing ->
// primitive spacing scale in assets/design/tokens/tokens.json). If these
// drift, the mirror below drifts from the component and the matrix should be
// re-derived deliberately. ---
const SPACING = { xs: 4, sm: 8, md: 12 }; // p.spacing[1|2|3]
const TAB_MIN_WIDTH = 96;
const BRAND_GLYPH_WIDTH = 32;
const WORDMARK_WIDTH = 150;
const TABLET_BREAKPOINT = 768; // BREAKPOINTS.tablet
const PHONE_BREAKPOINT = 520; // BREAKPOINTS.phone
const NAV_ROW_MIN_WIDTH = 1024; // wordmark-visibility threshold

// Faithful mirror of AppNav's render-time decision. `loggedIn` toggles the
// tab count (logged-out adds the "Login" pill → 6 items; logged-in → 5).
function decide(width, loggedIn) {
  const items = loggedIn ? 5 : 6;
  const isPhone = width < PHONE_BREAKPOINT;
  const wordmarkVisible = !!width && width >= NAV_ROW_MIN_WIDTH;
  const brandWidth =
    BRAND_GLYPH_WIDTH + (wordmarkVisible ? SPACING.sm + WORDMARK_WIDTH : 0);
  const navRowNeededWidth =
    brandWidth +
    SPACING.md +
    items * TAB_MIN_WIDTH +
    (items - 1) * SPACING.xs +
    SPACING.xs * 2;
  const showPillRow =
    !isPhone && !!width && width >= TABLET_BREAKPOINT && width >= navRowNeededWidth;
  if (!showPillRow) return "hamburger";
  return wordmarkVisible ? "full-row" : "compact-row";
}

// --- 1. Structural drift-guards: the source must wire the decision the way
// the mirror assumes. ---

test("AppNav gates the pill row on the ≥768 tablet breakpoint + a measured need", () => {
  assert.match(
    appNavSource,
    /import\s*\{[^}]*\bBREAKPOINTS\b[^}]*\}\s*from\s*"\.\.\/\.\.\/lib\/responsive"/,
    "AppNav must import BREAKPOINTS from lib/responsive to gate on ≥768",
  );
  // showPillRow must reference BOTH the tablet breakpoint and the measured
  // per-tab-count need — not a single hard-coded 1024 constant.
  const decl = appNavSource.match(/const\s+showPillRow\s*=\s*([\s\S]*?);/);
  assert.ok(decl, "AppNav must define a showPillRow constant");
  assert.match(
    decl[1],
    /BREAKPOINTS\.tablet/,
    "showPillRow must gate on BREAKPOINTS.tablet (≥768), not NAV_ROW_MIN_WIDTH",
  );
  assert.match(
    decl[1],
    /navRowNeededWidth/,
    "showPillRow must require the MEASURED navRowNeededWidth (measure, don't assume)",
  );
  assert.doesNotMatch(
    decl[1],
    /NAV_ROW_MIN_WIDTH/,
    "the pill-row gate must NOT reference NAV_ROW_MIN_WIDTH — 1024 is wordmark-only now",
  );
});

test("AppNav derives navRowNeededWidth from the live tab count and token gaps", () => {
  const decl = appNavSource.match(/const\s+navRowNeededWidth\s*=\s*([\s\S]*?);/);
  assert.ok(decl, "AppNav must define navRowNeededWidth");
  assert.match(decl[1], /items\.length\s*\*\s*TAB_MIN_WIDTH/, "must scale by items.length * TAB_MIN_WIDTH");
  assert.match(decl[1], /tokens\.spacing\.xs/, "must include the inter-pill / scroll-pad gaps");
});

test("AppNav uses NAV_ROW_MIN_WIDTH solely as the wordmark-visibility threshold", () => {
  const match = appNavSource.match(/NAV_ROW_MIN_WIDTH\s*=\s*(\d+)/);
  assert.ok(match, "AppNav must define NAV_ROW_MIN_WIDTH");
  assert.equal(Number(match[1]), 1024, "wordmark threshold stays at 1024");
  const decl = appNavSource.match(/const\s+wordmarkVisible\s*=\s*([\s\S]*?);/);
  assert.ok(decl, "AppNav must define wordmarkVisible");
  assert.match(
    decl[1],
    /width\s*>=\s*NAV_ROW_MIN_WIDTH/,
    "wordmarkVisible must gate on width >= NAV_ROW_MIN_WIDTH (1024)",
  );
  // The wordmark <Text> must render off wordmarkVisible, not isPhone.
  assert.match(
    appNavSource,
    /wordmarkVisible\s*\?\s*\(\s*<Text/,
    "the wordmark must render when wordmarkVisible, not gated on isPhone",
  );
});

// --- 2. Band matrix: the load-bearing 500 / 800 / 1100 assertions. ---

test("band matrix: 500 → hamburger, 800 → compact row, 1100 → full-wordmark row", () => {
  // Checked for BOTH auth states (5 vs 6 pills) — the fix must hold whether or
  // not the "Login" pill is present.
  for (const loggedIn of [true, false]) {
    assert.equal(decide(500, loggedIn), "hamburger", `500px (loggedIn=${loggedIn}) must show the hamburger`);
    assert.equal(decide(800, loggedIn), "compact-row", `800px (loggedIn=${loggedIn}) must show the compact pill row (no wordmark)`);
    assert.equal(decide(1100, loggedIn), "full-row", `1100px (loggedIn=${loggedIn}) must show the full pill row with wordmark`);
  }
});

test("band boundaries: <768 hamburger, ≥768 compact, ≥1024 wordmark", () => {
  // 767 is the last hamburger width; 768 is the first compact-row width.
  assert.equal(decide(767, false), "hamburger", "767px is still below the tablet breakpoint → hamburger");
  assert.equal(decide(768, false), "compact-row", "768px is the first compact pill-row width");
  // 1023 is the last wordmark-hidden width; 1024 is the first wordmark width.
  assert.equal(decide(1023, false), "compact-row", "1023px keeps the wordmark hidden");
  assert.equal(decide(1024, false), "full-row", "1024px is the first width showing the wordmark");
});

test("desktop-class widths never fall back to the phone hamburger", () => {
  // The core regression R7.3 fixes: no 768–1023 width may render the hamburger
  // for the normal 5/6-tab menus (both comfortably fit by 768).
  for (let w = 768; w <= 1023; w += 17) {
    assert.notEqual(decide(w, false), "hamburger", `${w}px must not fall back to the hamburger`);
    assert.notEqual(decide(w, true), "hamburger", `${w}px must not fall back to the hamburger`);
  }
});

test("a falsy/zero width falls back to the hamburger", () => {
  // Some webviews/tunnels report width 0 before layout — never render an
  // unmeasured pill row.
  assert.equal(decide(0, false), "hamburger", "width 0 must fall back to the drawer");
});
