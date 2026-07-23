// Reading-modes cleanup (A2 SEAM + CHOOSER) — tests for the shared client
// vocabulary: the `readingMode.ts` meta/mark module and the
// `gameApi.setReadingMode` binding.
//
// READING_MODE_META is imported for REAL (transpiled on the fly, react-native +
// theme stubbed out so ModeMark's imports resolve without a device runtime) so
// the copy is asserted from the actual object, not a source grep. The ModeMark
// motif and the gameApi binding are checked by reading source (they need RN /
// convex at import time), mirroring the repo's homeReadingMode/glyphSweep guards.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const libRoot = resolve(here, "..");
const modulePath = resolve(libRoot, "readingMode.ts");
const gameApiPath = resolve(libRoot, "gameApi.ts");

const require = createRequire(import.meta.url);
const ts = require("typescript");

// --- Real import of readingMode.ts with RN + theme stubbed -----------------
// react-native + ../theme are only referenced by ModeMark at RENDER time, never
// at module-eval time, so trivial stubs are enough to let READING_MODE_META load.
const reactStub =
  "data:text/javascript," +
  encodeURIComponent("export const createElement = () => null;");
const rnStub =
  "data:text/javascript," +
  encodeURIComponent("export const View = function View() { return null; };");
const themeStub =
  "data:text/javascript," +
  encodeURIComponent(
    "export const useAppTheme = () => ({ tokens: { colors: { text: '#000000' } } });",
  );

const rawSource = readFileSync(modulePath, "utf8");
const stubbedSource = rawSource
  .replace(/from "react"/g, `from ${JSON.stringify(reactStub)}`)
  .replace(/from "react-native"/g, `from ${JSON.stringify(rnStub)}`)
  .replace(/from "\.\.\/theme"/g, `from ${JSON.stringify(themeStub)}`);

const { outputText } = ts.transpileModule(stubbedSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});
const mod = await import(
  "data:text/javascript," + encodeURIComponent(outputText)
);
const { READING_MODE_META, ModeMark } = mod;

test("READING_MODE_META has both modes with non-empty label + blurb", () => {
  for (const mode of ["branching", "novel"]) {
    const meta = READING_MODE_META[mode];
    assert.ok(meta, `missing meta for ${mode}`);
    assert.equal(typeof meta.label, "string");
    assert.equal(typeof meta.blurb, "string");
    assert.ok(meta.label.trim().length > 0, `${mode} label is empty`);
    assert.ok(meta.blurb.trim().length > 0, `${mode} blurb is empty`);
  }
  // Exactly the two modes, no stray keys.
  assert.deepEqual(Object.keys(READING_MODE_META).sort(), ["branching", "novel"]);
});

test("READING_MODE_META labels match the pinned contract copy", () => {
  assert.equal(READING_MODE_META.branching.label, "Branching");
  assert.equal(READING_MODE_META.novel.label, "Novel");
  // The blurbs describe the actual behaviour (choices vs. no choices).
  assert.match(READING_MODE_META.branching.blurb, /choose|decisions/i);
  assert.match(READING_MODE_META.novel.blurb, /No choices/i);
});

test("ModeMark is an exported component drawn as a View motif (no control emoji)", () => {
  assert.equal(typeof ModeMark, "function");
  // Drawn motif (View elements), not a text/emoji glyph.
  assert.match(rawSource, /h\(\s*View/, "ModeMark must draw with View, not glyphs");
  // No emoji anywhere in the mark module (RC5 — no control emoji in UI).
  assert.ok(
    !/\p{Extended_Pictographic}/u.test(rawSource),
    "readingMode.ts must contain no emoji",
  );
  // Belt-and-braces on the specific banned UI-control set.
  for (const glyph of ["▶", "⏸", "⚙", "✦", "🔒", "✓", "×", "←", "🔀", "📖", "🌿"]) {
    assert.ok(!rawSource.includes(glyph), `banned glyph ${glyph} in readingMode.ts`);
  }
});

// --- gameApi.setReadingMode binding ---------------------------------------

test("gameApi.setReadingMode posts to readingModeFunctions:setReadingMode", () => {
  const src = readFileSync(gameApiPath, "utf8");
  assert.match(
    src,
    /export async function setReadingMode\(/,
    "setReadingMode binding must be exported from gameApi",
  );
  assert.match(
    src,
    /callConvexHttp<any>\(\s*"mutation",\s*"readingModeFunctions:setReadingMode",\s*input/,
    "must POST the full registered mutation path with the input payload",
  );
});

test("gameApi.setReadingMode threads nested auth and guards the no-backend path", () => {
  const src = readFileSync(gameApiPath, "utf8");
  // The signature carries the mutation's nested auth object.
  assert.match(
    src,
    /auth\?:\s*\{\s*accountId:\s*string;\s*guestTokenHash\?:\s*string\s*\}/,
    "setReadingMode must accept the nested auth { accountId, guestTokenHash? }",
  );
  // No-backend sentinel like every neighbour binding.
  assert.match(
    src,
    /export async function setReadingMode\([\s\S]*?if \(!convexClient\) return null;/,
    "setReadingMode must return null when convexClient is absent",
  );
});

test("gameApi exposes the pinned SetReadingModeResult union", () => {
  const src = readFileSync(gameApiPath, "utf8");
  assert.match(src, /needs_pro/);
  assert.match(src, /not_found/);
  assert.match(src, /unauthorized/);
  assert.match(src, /ok:\s*true;\s*mode:/);
});
