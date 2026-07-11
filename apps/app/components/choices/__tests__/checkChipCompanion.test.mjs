// Drift-guards for the QW-LEGIBILITY companion bond on the CheckChip
// (design §4.2). Source-level greps, matching the rest of components/*
// __tests__ — the pure phrase derivation is covered by the vitest projection
// suite (convex/tests/checkCompanionProjection.test.ts); here we pin the
// wiring that puts the phrase (and only the phrase — BC10) on the chip.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../../..");

function read(rel) {
  return readFileSync(resolve(appRoot, rel), "utf8");
}

test("CheckChip renders the optional companion phrase as a whisper line", () => {
  const src = read("components/choices/CheckChip.tsx");
  // Structural read — the chip must tolerate servers that predate the field.
  assert.match(
    src,
    /\(check as \{ companion\?: unknown \}\)\.companion/,
    "CheckChip must read the companion phrase structurally (BC2/BC4 tolerance)",
  );
  assert.match(
    src,
    /typeof rawCompanion === "string"/,
    "CheckChip must accept the companion phrase only as a string",
  );
  // The phrase renders conditionally — chips without it are unchanged.
  assert.match(
    src,
    /\{companion \? \(/,
    "CheckChip must render the companion line only when the phrase is present",
  );
  // The a11y label folds the phrase in.
  assert.match(
    src,
    /\$\{checkChipAccessibilityLabel\(check\)\} \$\{companion\}\./,
    "CheckChip a11y label must include the companion phrase",
  );
  // BC10: the chip must never render check math — no numeric interpolation.
  assert.ok(
    !/check\.(threshold|roll|total|value|bonus)/.test(src),
    "CheckChip must never touch raw check math fields (BC10)",
  );
});
