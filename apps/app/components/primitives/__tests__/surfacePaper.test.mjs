// Surface `paper` opt-in — byte-identity drift guard (manuscript §5, move 2).
//
// The `paper` treatment (candlelight edge + elevation) must be a pure
// conditional-spread: when `paper` is absent/false NOTHING is added to the
// style object, so every existing Surface renders byte-identically to today.
// This is a source-drift/lint-style test (same family as
// primitives.contract.test.mjs) — it pins the shape rather than the pixels.
//
// Run:
//   node --test apps/app/components/primitives/__tests__/surfacePaper.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../Surface.tsx"), "utf8");

test("`paper` is an OPTIONAL prop defaulting to false (absent ⇒ today's render)", () => {
  assert.match(source, /paper\?:\s*boolean/, "paper must be optional on Surface");
  assert.match(source, /paper\s*=\s*false/, "paper must default to false");
});

test("the base surface style keys are unchanged", () => {
  // These five keys defined the pre-paper Surface. They must still be present
  // and unconditional (not gated behind `paper`).
  for (const key of [
    "backgroundColor:",
    "borderColor:",
    "borderRadius:",
    "borderWidth:",
    "padding:",
  ]) {
    assert.ok(source.includes(key), `base Surface style lost its "${key}" key`);
  }
});

test("paper styles are added ONLY via a conditional spread (byte-identical when absent)", () => {
  // The paper branch must be a `...(paper ? { … } : {})` spread — the empty
  // object in the false arm guarantees zero added keys, never `undefined`.
  assert.match(
    source,
    /\.\.\.\(paper\s*\?/,
    "paper must be applied via a conditional spread `...(paper ? … : {})`",
  );
  assert.match(source, /:\s*\{\}\s*\)/, "the false arm of the paper spread must be `{}`");

  // Every shadow/elevation STYLE KEY (matched with its colon, so prose in the
  // doc comment doesn't count) introduced by paper must live AFTER the spread
  // opens — i.e. none of them leak into the always-on base object.
  const spreadIdx = source.indexOf("...(paper");
  assert.ok(spreadIdx > 0, "could not locate the paper conditional spread");
  for (const key of ["shadowColor:", "shadowRadius:", "elevation:"]) {
    const at = source.indexOf(key);
    assert.ok(at > spreadIdx, `${key} must appear inside the paper spread, not the base style`);
  }
});

test("the candlelight edge routes through the `paperEdge` token (no raw color)", () => {
  assert.match(
    source,
    /shadowColor:\s*tokens\.colors\.paperEdge/,
    "paper's edge must read the per-theme `paperEdge` token",
  );
});

// --- The `paperEdge` candlelight token in themes.ts (move 2, theme side) ---

const themesSrc = readFileSync(resolve(here, "../../../theme/themes.ts"), "utf8");

test("`paperEdge` is declared on ThemeColors and painted for all three themes", () => {
  assert.match(themesSrc, /paperEdge:\s*string/, "ThemeColors must declare paperEdge");
  // dayColors / nightColors / sepiaColors each assign it. Three assignments in
  // the three palette literals.
  const assignments = themesSrc.match(/paperEdge:\s*withAlpha\(/g) ?? [];
  assert.ok(
    assignments.length >= 3,
    `expected paperEdge painted in all 3 palettes, found ${assignments.length}`,
  );
});

test("Night and Sepia warm the edge to candlelight (the `candle` ramp)", () => {
  // The whole point of the treatment: a lit page reads as lit only in the dark
  // themes. Both night/sepia paperEdge values must come off the candle ramp.
  const candleEdges = themesSrc.match(/paperEdge:\s*withAlpha\(p\.color\.candle\[/g) ?? [];
  assert.ok(
    candleEdges.length >= 2,
    `Night and Sepia paperEdge must use the candle ramp, found ${candleEdges.length}`,
  );
});

test("themes.ts stays free of raw hex (paper token routes through primitives)", () => {
  // Reuse the primitives' hex rule: no 6-digit hex literal outside comments.
  const HEX = /["'`]#[0-9a-fA-F]{6}["'`]/;
  for (const [i, line] of themesSrc.split("\n").entries()) {
    const stripped = line.replace(/\/\/.*$/, "");
    assert.ok(!HEX.test(stripped), `themes.ts:${i + 1} has a raw hex literal: ${line.trim()}`);
  }
});
