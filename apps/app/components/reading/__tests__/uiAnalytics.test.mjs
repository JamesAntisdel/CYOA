// Client half of the minimal UI-event telemetry path (P3 debt). Exercises the
// `recordUiEvent` wrapper FOR REAL: the .ts is transpiled with the repo's
// TypeScript and its `./convexHttp` import is rewired to a stub so we can drive
// the transport (capturing, rejecting) without a live backend.
//
// node --test can't import .ts on Node 20, hence the data:-URL transpile dance
// (mirrors useAutoNarrator.test.mjs).
//
// Run:
//   node --test apps/app/components/reading/__tests__/uiAnalytics.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const wrapperPath = resolve(here, "../../../lib/uiAnalytics.ts");

const require = createRequire(import.meta.url);
const ts = require("typescript");

const transpile = (src) =>
  ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

// Load the wrapper with `./convexHttp` rewired to a per-instance stub that
// records the last call and returns whatever `mode` dictates.
async function loadWrapper(mode) {
  const calls = [];
  const stub =
    mode === "reject"
      ? "async function convexHttp(){throw new Error('transport exploded');}"
      : "async function convexHttp(kind,path,args){globalThis.__uiCalls.push({kind,path,args});return null;}";
  let out = transpile(readFileSync(wrapperPath, "utf8"));
  out = out.replace(
    /import\s*\{[^}]*\}\s*from\s*["']\.\/convexHttp["'];?/,
    stub,
  );
  globalThis.__uiCalls = calls;
  const mod = await import(
    "data:text/javascript," + encodeURIComponent(out)
  );
  return { mod, calls };
}

test("recordUiEvent posts a mutation to the full registered path (BC1)", async () => {
  const { mod, calls } = await loadWrapper("capture");
  assert.equal(mod.RECORD_UI_EVENT_PATH, "uiAnalytics:recordUiEvent");
  await mod.recordUiEvent("ui.tome_open");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, "mutation");
  assert.equal(calls[0].path, "uiAnalytics:recordUiEvent");
  assert.deepEqual(calls[0].args, { event: "ui.tome_open" });
});

test("payload + anonymous accountId are conditionally spread (never undefined)", async () => {
  const { mod, calls } = await loadWrapper("capture");
  await mod.recordUiEvent("ui.auto_toggle", { on: true }, "acct_1");
  assert.deepEqual(calls[0].args, {
    event: "ui.auto_toggle",
    payload: { on: true },
    accountId: "acct_1",
  });
  // No payload / no accountId ⇒ those keys are ABSENT, not `undefined`.
  await mod.recordUiEvent("ui.ribbon_expand");
  assert.deepEqual(Object.keys(calls[1].args), ["event"]);
});

test("recordUiEvent is fire-and-forget — a rejected transport is swallowed", async () => {
  const { mod } = await loadWrapper("reject");
  // Must RESOLVE (not reject) even though the transport throws.
  await assert.doesNotReject(() => mod.recordUiEvent("ui.tome_open"));
  const result = await mod.recordUiEvent("ui.auto_toggle", { on: false });
  assert.equal(result, undefined);
});
