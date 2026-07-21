// Open-book spread (R6) — tests for the page-turn driver. The PURE
// `shouldAnimatePageTurn` predicate is transpiled & import-stripped and
// exercised over the full reduced-motion matrix; source-drift pins the
// reduced-motion no-op (instant swap — R6.2) and that the motion never gates
// the submit (R6.3). Same discipline as pageTurn.test.mjs.
//
// Run:
//   node --test apps/app/components/reading/__tests__/pageTurnAnim.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const modulePath = resolve(here, "../layouts/spread/pageTurnAnim.ts");
const source = readFileSync(modulePath, "utf8");

const require = createRequire(import.meta.url);
const ts = require("typescript");

const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});
// Strip the react / react-native imports: the pure predicate needs none of
// them, and the hook (which does) is never invoked here.
const stripped = outputText.replace(/^\s*import[^\n]*\n?/gm, "");
const mod = await import("data:text/javascript," + encodeURIComponent(stripped));
const { shouldAnimatePageTurn, PAGE_TURN_DURATION_MS } = mod;

test("shouldAnimatePageTurn matrix: reduced-motion snaps, otherwise animates (R6.2)", () => {
  assert.equal(shouldAnimatePageTurn(false), true, "motion on ⇒ animate");
  assert.equal(shouldAnimatePageTurn(true), false, "reduced-motion ⇒ instant swap, no partial motion");
});

test("shouldAnimatePageTurn is pure/total (idempotent, no throw)", () => {
  assert.equal(shouldAnimatePageTurn(false), shouldAnimatePageTurn(false));
  assert.equal(shouldAnimatePageTurn(true), shouldAnimatePageTurn(true));
});

test("the curl/slide duration is a finite positive constant", () => {
  assert.equal(typeof PAGE_TURN_DURATION_MS, "number");
  assert.ok(PAGE_TURN_DURATION_MS > 0 && Number.isFinite(PAGE_TURN_DURATION_MS));
});

// --- Source-drift ------------------------------------------------------------

test("the pure module boundary: shouldAnimatePageTurn takes no RN dependency", () => {
  // The predicate is a one-liner over the boolean — assert it doesn't reach for
  // Animated/timers (so the transpile-and-import above tests the REAL logic).
  assert.match(source, /export function shouldAnimatePageTurn\(reducedMotion: boolean\): boolean/);
  assert.match(source, /return !reducedMotion;/);
});

test("animate() is a no-op under reduced-motion (instant swap — R6.2)", () => {
  // The driver guards on the same predicate before starting any timing.
  assert.match(source, /if \(!shouldAnimatePageTurn\(reducedMotion\)\) return;/);
});

test("the animation uses the native driver and NEVER awaits/blocks the turn (R6.3)", () => {
  assert.match(source, /useNativeDriver:\s*true/);
  // Decorative only: no await, no promise the caller must resolve before turning.
  assert.doesNotMatch(source, /await\b/);
  assert.doesNotMatch(source, /async\b/);
});
