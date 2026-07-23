// Behavioral tests for the persisted `deskHome` reader setting
// (apps/app/hooks/useReaderSettings.ts — the-desk R1.2, design §0 DK2).
//
// Exercises the REAL parse/persist path. useReaderSettings.ts imports React +
// the native-aware storage module, so we transpile it, strip those two imports
// (the pure `readSettings`/`writeSettings` functions never touch React), inject
// a Map-backed fake storage in place of `getStorage`, and export the two
// functions — then assert persistence + the TOLERANT parse of a legacy blob
// that predates the key.
//
// Run:
//   node --test apps/app/components/home/__tests__/deskHomeSetting.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const modulePath = resolve(here, "../../../hooks/useReaderSettings.ts");

const require = createRequire(import.meta.url);
const ts = require("typescript");

const source = readFileSync(modulePath, "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});

// Rewrite the transpiled ESM so it evaluates standalone under a data: URL:
//  - drop the bare `react` import (only the uncalled hook body references it),
//  - replace the storage import with a stub reading a test-controlled global,
//  - export the internal parse/persist functions we want to drive.
const rewritten =
  outputText
    .replace(/import\s+\{[^}]*\}\s+from\s+["']react["'];?/g, "")
    .replace(
      /import\s+\{[^}]*\}\s+from\s+["']\.\.\/lib\/storage["'];?/g,
      "const getStorage = () => globalThis.__DESK_TEST_STORAGE__ ?? null;",
    ) + "\nexport { readSettings, writeSettings };\n";

const mod = await import("data:text/javascript," + encodeURIComponent(rewritten));
const { readSettings, writeSettings, READER_SETTINGS_KEY } = mod;

function makeStorage(seed) {
  const map = new Map(seed ? Object.entries(seed) : []);
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
    _map: map,
  };
}

function withStorage(storage, fn) {
  const prev = globalThis.__DESK_TEST_STORAGE__;
  globalThis.__DESK_TEST_STORAGE__ = storage;
  try {
    return fn();
  } finally {
    globalThis.__DESK_TEST_STORAGE__ = prev;
  }
}

// ── Default OFF ─────────────────────────────────────────────────────────────

test("deskHome defaults to false when no settings are stored", () => {
  withStorage(makeStorage(), () => {
    assert.equal(readSettings().deskHome, false);
  });
});

// ── Persistence roundtrip ───────────────────────────────────────────────────

test("deskHome persists: writing true reads back true", () => {
  const storage = makeStorage();
  withStorage(storage, () => {
    const base = readSettings(); // defaults (deskHome false)
    assert.equal(base.deskHome, false);
    writeSettings({ ...base, deskHome: true });
    // The persisted blob actually carries the key (real localStorage write).
    const raw = JSON.parse(storage.getItem(READER_SETTINGS_KEY));
    assert.equal(raw.deskHome, true, "the written JSON blob carries deskHome");
    // And it round-trips back through the parse.
    assert.equal(readSettings().deskHome, true);
  });
});

test("deskHome persists false and reads back false (explicit opt-out)", () => {
  const storage = makeStorage();
  withStorage(storage, () => {
    const base = readSettings();
    writeSettings({ ...base, deskHome: false });
    assert.equal(readSettings().deskHome, false);
  });
});

// ── Tolerant parse of a LEGACY blob missing the key (DK2) ────────────────────

test("an old blob without deskHome still loads; deskHome defaults false", () => {
  // A representative pre-feature blob: real keys, but NO deskHome field.
  const legacy = {
    theme: "night",
    fontScale: "large",
    hudMode: "quiet",
    layout: "modernApp",
    muted: true,
    reduceMotion: true,
    imagesEnabled: false,
    audioEnabled: false,
    videoEnabled: false,
    cinematicMode: "stills_only",
    narratorPlaybackRate: 1.25,
    dialogBlocksEnabled: false,
    focusMode: false,
    // note: no `deskHome`, and a stray retired `layoutMode` legacy blobs carry
    layoutMode: "focus",
  };
  const storage = makeStorage({ [READER_SETTINGS_KEY]: JSON.stringify(legacy) });
  withStorage(storage, () => {
    const parsed = readSettings();
    // The missing key tolerantly defaults OFF — no throw, no undefined.
    assert.equal(parsed.deskHome, false);
    // The rest of the legacy blob still parses cleanly (sibling fields intact).
    assert.equal(parsed.theme, "night");
    assert.equal(parsed.layout, "modernApp");
    assert.equal(parsed.focusMode, false);
    assert.equal(parsed.imagesEnabled, false);
  });
});

test("only an explicit true opts in; a truthy non-boolean does NOT (strict)", () => {
  for (const [stored, expected] of [
    [true, true],
    [false, false],
    ["true", false],
    [1, false],
    ["1", false],
    [null, false],
    [undefined, false],
  ]) {
    const blob = { deskHome: stored };
    const storage = makeStorage({ [READER_SETTINGS_KEY]: JSON.stringify(blob) });
    withStorage(storage, () => {
      assert.equal(
        readSettings().deskHome,
        expected,
        `deskHome=${JSON.stringify(stored)} → ${expected}`,
      );
    });
  }
});

test("a corrupt blob falls back to defaults (deskHome false), no throw", () => {
  const storage = makeStorage({ [READER_SETTINGS_KEY]: "{not json" });
  withStorage(storage, () => {
    assert.equal(readSettings().deskHome, false);
  });
});
