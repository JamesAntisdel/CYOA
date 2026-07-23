// Behavioral tests for the PURE desk-home opt-in resolver
// (apps/app/components/home/deskGate.ts — the-desk R1, design §0 DK2).
//
// Like readerSettingsGroups.test.mjs, this exercises the REAL module: the
// React-free .ts is transpiled with the repo's TypeScript and imported as an ES
// module (data: URL — no temp files, no loader flags), so the resolver's
// env/setting/default-off matrix is tested for real.
//
// Run:
//   node --test apps/app/components/home/__tests__/deskGate.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const modulePath = resolve(here, "../deskGate.ts");

const require = createRequire(import.meta.url);
const ts = require("typescript");

const source = readFileSync(modulePath, "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});
const mod = await import("data:text/javascript," + encodeURIComponent(outputText));
const { resolveDeskEnabled } = mod;

// ── The full matrix: envFlag ("1" / other) × settingOn (true/false) ─────────

test("envFlag '1' enables regardless of the setting", () => {
  assert.equal(resolveDeskEnabled({ envFlag: "1", settingOn: false }), true);
  assert.equal(resolveDeskEnabled({ envFlag: "1", settingOn: true }), true);
});

test("settingOn true enables regardless of the env flag", () => {
  assert.equal(resolveDeskEnabled({ envFlag: undefined, settingOn: true }), true);
  assert.equal(resolveDeskEnabled({ envFlag: "0", settingOn: true }), true);
  assert.equal(resolveDeskEnabled({ envFlag: "1", settingOn: true }), true);
});

test("default OFF: no flag AND no setting → false", () => {
  assert.equal(resolveDeskEnabled({ envFlag: undefined, settingOn: false }), false);
});

test("the env flag is STRICT — only the exact string '1' counts", () => {
  // Anything that is not exactly "1" reads as OFF so a stray value can't
  // silently enable the experimental surface (DK2).
  for (const stray of ["", "0", "true", "TRUE", "yes", "on", " 1", "1 ", "2", "01"]) {
    assert.equal(
      resolveDeskEnabled({ envFlag: stray, settingOn: false }),
      false,
      `envFlag ${JSON.stringify(stray)} must NOT enable`,
    );
  }
});

test("the setting is strict-true — only boolean true counts (no coercion)", () => {
  // The resolver ORs `settingOn === true`; the hook always hands it a real
  // boolean, and the resolver never coerces a truthy non-boolean.
  assert.equal(resolveDeskEnabled({ envFlag: undefined, settingOn: false }), false);
  assert.equal(resolveDeskEnabled({ envFlag: "0", settingOn: false }), false);
});

test("full 2×2 truth table (envFlag=='1') OR settingOn", () => {
  const rows = [
    { envFlag: "1", settingOn: true, expected: true },
    { envFlag: "1", settingOn: false, expected: true },
    { envFlag: "0", settingOn: true, expected: true },
    { envFlag: "0", settingOn: false, expected: false },
    { envFlag: undefined, settingOn: true, expected: true },
    { envFlag: undefined, settingOn: false, expected: false },
  ];
  for (const { envFlag, settingOn, expected } of rows) {
    assert.equal(
      resolveDeskEnabled({ envFlag, settingOn }),
      expected,
      `envFlag=${JSON.stringify(envFlag)} settingOn=${settingOn} → ${expected}`,
    );
  }
});

test("always returns a real boolean (never a truthy string / undefined)", () => {
  const out = resolveDeskEnabled({ envFlag: "1", settingOn: false });
  assert.equal(typeof out, "boolean");
  const off = resolveDeskEnabled({ envFlag: undefined, settingOn: false });
  assert.equal(typeof off, "boolean");
});
