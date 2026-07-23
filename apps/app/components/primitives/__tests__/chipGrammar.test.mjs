// Pill-grammar contract (manuscript design-language pass, brainstorm §5).
//
// The canonical grammar is exactly TWO semantic roles — `control` (actionable)
// and `status` (read-only) — layered over the retained visual variants
// (default/muted/accent). This test pins:
//   1. The pure `resolveChipTones` paints each variant from the right tokens.
//   2. `default`/`muted`/`accent` are BYTE-IDENTICAL to the pre-grammar Chip
//      (no silent restyle of existing call sites).
//   3. `control` === `accent` (actionable = eye-drawing) and `status` is the
//      quiet read-only treatment.
//   4. The grammar is documented in the source header.
//
// `Chip.tsx` imports React Native, so we transpile the .tsx, STRIP the import
// lines (the pure export references none of them; the component body that does
// is never invoked here), and import the emitted JS — same discipline as
// dropCap.test.mjs.
//
// Run:
//   node --test apps/app/components/primitives/__tests__/chipGrammar.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const modulePath = resolve(here, "../Chip.tsx");
const source = readFileSync(modulePath, "utf8");

const require = createRequire(import.meta.url);
const ts = require("typescript");

const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX,
  },
});
const stripped = outputText.replace(/^\s*import[^\n]*\n?/gm, "");
const mod = await import("data:text/javascript," + encodeURIComponent(stripped));
const { resolveChipTones, CHIP_VARIANTS } = mod;

// Distinct sentinels so we can assert exactly which token each slot reads.
const C = {
  surface: "SURFACE",
  surfaceMuted: "SURFACE_MUTED",
  accent: "ACCENT",
  accentMuted: "ACCENT_MUTED",
  border: "BORDER",
  text: "TEXT",
  textMuted: "TEXT_MUTED",
};

test("CHIP_VARIANTS declares the full grammar (retained + semantic)", () => {
  for (const v of ["default", "muted", "accent", "control", "status"]) {
    assert.ok(CHIP_VARIANTS.includes(v), `CHIP_VARIANTS missing "${v}"`);
  }
  // The three retained visual variants must remain, in their original order,
  // so nothing downstream that indexes/enumerates them shifts.
  assert.deepEqual(CHIP_VARIANTS.slice(0, 3), ["default", "muted", "accent"]);
});

test("default/muted/accent are byte-identical to the pre-grammar Chip", () => {
  assert.deepEqual(resolveChipTones("default", C), {
    backgroundColor: C.surface,
    borderColor: C.border,
    labelColor: C.text,
  });
  assert.deepEqual(resolveChipTones("muted", C), {
    backgroundColor: C.surfaceMuted,
    borderColor: C.border,
    labelColor: C.text,
  });
  assert.deepEqual(resolveChipTones("accent", C), {
    backgroundColor: C.accentMuted,
    borderColor: C.accent,
    labelColor: C.accent,
  });
});

test("control is the actionable pill — identical paint to accent", () => {
  assert.deepEqual(resolveChipTones("control", C), resolveChipTones("accent", C));
});

test("status is the quiet read-only pill — muted surface, muted ink", () => {
  assert.deepEqual(resolveChipTones("status", C), {
    backgroundColor: C.surfaceMuted,
    borderColor: C.border,
    labelColor: C.textMuted,
  });
  // A status pill must NOT read as actionable (no accent paint anywhere).
  const tones = resolveChipTones("status", C);
  assert.ok(
    ![tones.backgroundColor, tones.borderColor, tones.labelColor].includes(C.accent),
    "status must not use the accent color — it is read-only, not actionable",
  );
});

test("the pill grammar is documented in the Chip source header", () => {
  assert.match(source, /grammar/i, "Chip.tsx header must name the grammar");
  assert.match(source, /control/, "Chip.tsx header must document `control`");
  assert.match(source, /status/, "Chip.tsx header must document `status`");
  assert.match(source, /actionable/i);
  assert.match(source, /read-only/i);
});
