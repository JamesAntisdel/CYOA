// Reading-modes cleanup (SWITCH-UX #7) — behavioral tests for the pure
// result→action decision `routeReadingModeResult`. Like autoNarrator.test.mjs,
// this exercises the REAL module: the .ts is transpiled with the repo's
// TypeScript and imported as an ES module (its only imports are `import type`,
// erased by transpile), so every arm — ok / needs_pro / not_found /
// unauthorized / null — is tested for real, not grepped.
//
// Run:
//   node --test apps/app/lib/__tests__/readingModeRouting.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const libRoot = resolve(here, "..");
const modulePath = resolve(libRoot, "readingModeRouting.ts");

const require = createRequire(import.meta.url);
const ts = require("typescript");

const source = readFileSync(modulePath, "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});
const mod = await import(
  "data:text/javascript," + encodeURIComponent(outputText)
);

const { routeReadingModeResult } = mod;

test("the pure module imports nothing at runtime (types only)", () => {
  // Only `import type` — erased by transpile — so the emitted JS has no imports.
  assert.doesNotMatch(outputText, /\bimport\b/, "no runtime imports remain");
  assert.doesNotMatch(outputText, /\brequire\(/, "no runtime require");
});

test("ok → confirm, carrying the mode the switch moved TO (novel)", () => {
  assert.deepEqual(routeReadingModeResult({ ok: true, mode: "novel" }), {
    kind: "confirm",
    mode: "novel",
  });
});

test("ok → confirm (branching)", () => {
  assert.deepEqual(routeReadingModeResult({ ok: true, mode: "branching" }), {
    kind: "confirm",
    mode: "branching",
  });
});

test("needs_pro → paywall", () => {
  assert.deepEqual(routeReadingModeResult({ ok: false, reason: "needs_pro" }), {
    kind: "paywall",
  });
});

test("not_found → noop (benign server reject, never a dead-end)", () => {
  assert.deepEqual(routeReadingModeResult({ ok: false, reason: "not_found" }), {
    kind: "noop",
  });
});

test("unauthorized → noop", () => {
  assert.deepEqual(
    routeReadingModeResult({ ok: false, reason: "unauthorized" }),
    { kind: "noop" },
  );
});

test("null (no remote backend / local demo save) → noop", () => {
  assert.deepEqual(routeReadingModeResult(null), { kind: "noop" });
});
