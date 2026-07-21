// Behavioral tests for the PURE Tome-menu row builder
// (components/reading/chrome/tomeRows.ts, design §1 / R2.1).
//
// Unlike the source-grep drift-guards elsewhere in this dir, this exercises the
// REAL module: the .ts is transpiled with the repo's TypeScript and imported as
// an ES module (data: URL — no temp files, no loader flags), so the row order,
// the terminal-scene / read-as-book gating, the selected wiring, and the
// onPress plumbing are all tested for real (same pattern as autoNarrator.test.mjs).
//
// Run:
//   node --test apps/app/components/reading/__tests__/tomeRows.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const modulePath = resolve(here, "../chrome/tomeRows.ts");

const require = createRequire(import.meta.url);
const ts = require("typescript");

const source = readFileSync(modulePath, "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});
const { buildTomeRows } = await import(
  "data:text/javascript," + encodeURIComponent(outputText)
);

// A fresh input where every callback is a distinct spy so we can prove each row
// wires to the right handler.
function makeInput(overrides = {}) {
  const calls = [];
  const spy = (name) => () => calls.push(name);
  const input = {
    autoOn: false,
    hasEnding: false,
    readAsBookAvailable: true,
    onToggleAuto: spy("auto"),
    onPathMap: spy("map"),
    onRunHistory: spy("history"),
    onReadAsBook: spy("book"),
    onReadingSettings: spy("settings"),
    onFlagScene: spy("flag"),
    onLeave: spy("leave"),
    ...overrides,
  };
  return { input, calls };
}

const keysOf = (rows) => rows.map((r) => r.key);

test("the pure module imports nothing from react / react-native", () => {
  // Only an erased `import type` for IconName is allowed (design §Code
  // Architecture — pure render-model helper).
  assert.ok(
    !/from\s+["']react/.test(source),
    "tomeRows.ts must not import react / react-native",
  );
  const imports = source.match(/^\s*import\b.*$/gm) ?? [];
  for (const line of imports) {
    assert.ok(
      /^\s*import\s+type\b/.test(line),
      `every import in tomeRows.ts must be a type-only import, got: ${line.trim()}`,
    );
  }
  assert.ok(!/\brequire\(/.test(source), "no runtime require in the pure module");
});

test("full row set: auto ON, not terminal, read-as-book available (design §3 order)", () => {
  const { input } = makeInput({ autoOn: true });
  const rows = buildTomeRows(input);
  assert.deepEqual(keysOf(rows), [
    "auto",
    "map",
    "history",
    "book",
    "settings",
    "flag",
    "leave",
  ]);
});

test("labels are canonical + stable (drift guard)", () => {
  const { input } = makeInput({ autoOn: true });
  const byKey = Object.fromEntries(buildTomeRows(input).map((r) => [r.key, r.label]));
  assert.equal(byKey.auto, "Auto-read");
  assert.equal(byKey.map, "Path map");
  assert.equal(byKey.history, "Run history");
  assert.equal(byKey.book, "Read as book");
  assert.equal(byKey.settings, "Reading settings");
  assert.equal(byKey.flag, "Flag this scene");
  assert.equal(byKey.leave, "Leave the tale");
});

test("the Auto-read row reflects the session flag via `selected`", () => {
  const onRows = buildTomeRows(makeInput({ autoOn: true }).input);
  const offRows = buildTomeRows(makeInput({ autoOn: false }).input);
  assert.equal(onRows.find((r) => r.key === "auto").selected, true);
  assert.equal(offRows.find((r) => r.key === "auto").selected, false);
});

test("only the Auto-read row carries `selected` (exactOptional — others omit it)", () => {
  const rows = buildTomeRows(makeInput({ autoOn: true }).input);
  for (const row of rows) {
    if (row.key === "auto") continue;
    assert.ok(
      !("selected" in row),
      `row '${row.key}' must not carry a selected key (never undefined inline)`,
    );
  }
});

test("terminal scene hides the Auto-read row (auto is meaningless at an ending)", () => {
  const rows = buildTomeRows(makeInput({ hasEnding: true }).input);
  assert.deepEqual(keysOf(rows), [
    "map",
    "history",
    "book",
    "settings",
    "flag",
    "leave",
  ]);
  assert.ok(!rows.some((r) => r.key === "auto"), "no Auto-read row at a terminal scene");
});

test("read-as-book unavailable omits the Read-as-book row", () => {
  const rows = buildTomeRows(makeInput({ readAsBookAvailable: false }).input);
  assert.deepEqual(keysOf(rows), [
    "auto",
    "map",
    "history",
    "settings",
    "flag",
    "leave",
  ]);
});

test("terminal AND read-as-book unavailable drops both rows", () => {
  const rows = buildTomeRows(
    makeInput({ hasEnding: true, readAsBookAvailable: false }).input,
  );
  assert.deepEqual(keysOf(rows), ["map", "history", "settings", "flag", "leave"]);
});

test("every row's onPress fires its matching callback", () => {
  const { input, calls } = makeInput({ autoOn: true });
  const rows = buildTomeRows(input);
  for (const row of rows) {
    assert.equal(typeof row.onPress, "function", `row '${row.key}' must have an onPress`);
    row.onPress();
  }
  assert.deepEqual(calls, ["auto", "map", "history", "book", "settings", "flag", "leave"]);
});

test("the Flag row is the report ACTION only — not the disclosure (U3/R2.5)", () => {
  const rows = buildTomeRows(makeInput().input);
  const flag = rows.find((r) => r.key === "flag");
  assert.equal(flag.label, "Flag this scene");
  // The disclosure lives in the ReaderScreen footer; no sheet row may carry the
  // "AI-generated" disclosure text.
  assert.ok(
    !rows.some((r) => /AI-generated/i.test(r.label)),
    "no Tome row may carry the AI-generated disclosure — it is a footer (U3)",
  );
});

test("every row has a non-empty key + label and a function onPress", () => {
  const rows = buildTomeRows(makeInput({ autoOn: true }).input);
  const seen = new Set();
  for (const row of rows) {
    assert.ok(row.key && typeof row.key === "string", "each row needs a key");
    assert.ok(!seen.has(row.key), `duplicate row key '${row.key}'`);
    seen.add(row.key);
    assert.ok(row.label && typeof row.label === "string", "each row needs a label");
    assert.equal(typeof row.onPress, "function");
  }
});
