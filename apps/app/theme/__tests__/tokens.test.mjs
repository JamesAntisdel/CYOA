// Drift check: assert that the runtime-typed primitive tokens exported by
// `apps/app/theme/tokens.generated.ts` match the canonical JSON byte-for-byte
// (structure + values). This file is intentionally pure ESM/Node so it runs
// as part of `pnpm --filter @cyoa/app test` without requiring a JS test
// framework or transpiler.
//
// If you change `apps/app/assets/design/tokens/tokens.json`, you must update
// the typed shape in `tokens.generated.ts` (and downstream `themes.ts`) so
// this test passes again.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const jsonPath = resolve(here, "../../assets/design/tokens/tokens.json");
const tsPath = resolve(here, "../tokens.generated.ts");

const json = JSON.parse(readFileSync(jsonPath, "utf8"));
const tsSource = readFileSync(tsPath, "utf8");

// Static keys we expect the typed shape to declare. Update both this list
// AND tokens.generated.ts when adding new primitives to tokens.json.
const expectedTypeKeys = [
  "color",
  "paper",
  "ink",
  "ember",
  "candle",
  "night",
  "font",
  "display",
  "body",
  "ui",
  "mono",
  "size",
  "display1",
  "display2",
  "h1",
  "h2",
  "micro",
  "stamp",
  "radius",
  "none",
  "sm",
  "md",
  "spacing",
  "shadow",
  "card",
  "plate",
];

test("tokens.json shape matches the typed primitive declaration", () => {
  for (const key of expectedTypeKeys) {
    assert.ok(
      tsSource.includes(key),
      `tokens.generated.ts is missing declared key "${key}" — design tokens drifted`,
    );
  }
});

test("tokens.json has the expected top-level groups", () => {
  const groups = ["color", "font", "size", "radius", "spacing", "shadow"].sort();
  assert.deepEqual(Object.keys(json).sort(), groups);
});

test("color scales declare exactly the documented ramps", () => {
  assert.deepEqual(Object.keys(json.color).sort(), ["candle", "ember", "ink", "night", "paper"]);
  assert.deepEqual(Object.keys(json.color.paper).sort(), ["100", "200", "300", "400", "50"]);
  assert.deepEqual(
    Object.keys(json.color.ink).sort(),
    ["300", "400", "500", "600", "700", "800", "900"],
  );
  assert.deepEqual(Object.keys(json.color.ember).sort(), ["300", "400", "500", "600", "700"]);
  assert.deepEqual(Object.keys(json.color.candle).sort(), ["300", "400", "500", "600", "700"]);
  assert.deepEqual(Object.keys(json.color.night).sort(), ["600", "700", "800", "900"]);
});

test("every color value is a 6-digit hex", () => {
  const hex = /^#[0-9a-f]{6}$/i;
  for (const [family, ramp] of Object.entries(json.color)) {
    for (const [stop, value] of Object.entries(ramp)) {
      assert.match(value, hex, `color.${family}.${stop} is not a hex literal`);
    }
  }
});

test("font, size, radius, spacing, shadow keys are stable", () => {
  assert.deepEqual(Object.keys(json.font).sort(), ["body", "display", "mono", "ui"]);
  assert.deepEqual(
    Object.keys(json.size).sort(),
    ["body", "display1", "display2", "h1", "h2", "micro", "stamp", "ui"],
  );
  assert.deepEqual(Object.keys(json.radius).sort(), ["md", "none", "sm"]);
  assert.deepEqual(
    Object.keys(json.spacing).sort(),
    ["0", "1", "10", "12", "16", "2", "3", "4", "5", "6", "8"],
  );
  assert.deepEqual(Object.keys(json.shadow).sort(), ["card", "plate"]);
});

test("primitive scales match the values referenced by themes.ts", () => {
  // Spot-check the most-load-bearing primitives. If any of these drift, the
  // semantic theme map in themes.ts becomes wrong.
  assert.equal(json.color.paper["100"], "#f4ecd8");
  assert.equal(json.color.ink["900"], "#13110d");
  assert.equal(json.color.ember["400"], "#c45445");
  assert.equal(json.color.candle["400"], "#d8b158");
  assert.equal(json.color.night["800"], "#14110b");
  assert.equal(json.spacing["4"], 16);
  assert.equal(json.size.body, 16);
  assert.equal(json.size.h1, 30);
});
