// Drift-guard for shared UI primitives.
//
// These tests pin the contract that every file under
// `apps/app/components/primitives/*.tsx` must satisfy. They keep primitives
// the single source of truth for colors, typography and spacing so consumers
// can't silently drift back to hardcoded values.
//
// They are intentionally implementation-agnostic — pure ESM/Node running via
// `node --test`. No JSX parser, no transpiler.
//
// If a test here fails, the primitive file violated one of:
//   1. It must consume `useAppTheme` (so colors/typography/spacing flow
//      through the theme tokens, not literals).
//   2. It must not contain raw 6-digit hex strings.
//   3. Each documented variant must appear in the source via a static map
//      below so the contract test catches accidental removals/renames.
//
// Update both the primitive source AND this file when adding variants.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const primitivesDir = resolve(here, "..");

const PRIMITIVE_FILES = readdirSync(primitivesDir).filter(
  (name) => name.endsWith(".tsx"),
);

const HEX_LITERAL = /["'`]#[0-9a-fA-F]{6}["'`]/;

// Static variant map. Keep in sync with the corresponding `*_VARIANTS`
// exports in each primitive module. If you add or rename a variant, update
// BOTH the source file AND this map.
const VARIANT_CONTRACT = {
  "Button.tsx": ["default", "primary", "secondary", "ghost", "danger", "locked"],
  "Chip.tsx": ["default", "muted", "accent"],
  "Surface.tsx": ["base", "muted"],
  "Text.tsx": ["display", "title", "subtitle", "body", "bodySmall", "caption"],
};

// Primitives that don't consume theme colors directly because they only
// compose other primitives (which already consume the theme). The contract
// still expects them to import from "../../theme" if they reference any
// styling, but listing them here keeps the assertion explicit.
const PRIMITIVES_WITHOUT_DIRECT_THEME_USE = new Set([
  // Note delegates entirely to Text via the `tone="accent"` prop.
  "Note.tsx",
]);

test("every primitive file ends with .tsx and is readable", () => {
  assert.ok(PRIMITIVE_FILES.length > 0, "no primitive files discovered");
  for (const file of PRIMITIVE_FILES) {
    const src = readFileSync(resolve(primitivesDir, file), "utf8");
    assert.ok(src.length > 0, `${file} is empty`);
  }
});

test("each primitive imports from the theme module (or is explicitly exempt)", () => {
  for (const file of PRIMITIVE_FILES) {
    const src = readFileSync(resolve(primitivesDir, file), "utf8");
    if (PRIMITIVES_WITHOUT_DIRECT_THEME_USE.has(file)) {
      // Composed primitives must NOT pull useAppTheme themselves — they
      // should defer to the primitive they wrap.
      assert.ok(
        !src.includes("useAppTheme"),
        `${file} is listed as theme-exempt but still imports useAppTheme — ` +
          `either remove it from PRIMITIVES_WITHOUT_DIRECT_THEME_USE or drop ` +
          `the import.`,
      );
      continue;
    }
    assert.ok(
      src.includes('from "../../theme"'),
      `${file} must import from "../../theme" so it can consume tokens`,
    );
    assert.ok(
      src.includes("useAppTheme"),
      `${file} must call useAppTheme() so its styles route through theme tokens`,
    );
  }
});

test("no primitive contains a raw hex color literal", () => {
  for (const file of PRIMITIVE_FILES) {
    const src = readFileSync(resolve(primitivesDir, file), "utf8");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Allow hex inside line comments (documentation). This keeps the door
      // open for inline notes like "// was #efe2c8" without breaking the rule.
      const stripped = line.replace(/\/\/.*$/, "");
      if (HEX_LITERAL.test(stripped)) {
        assert.fail(
          `${file}:${i + 1} contains a hex color literal — primitives must ` +
            `route colors through tokens. Offending line:\n  ${line.trim()}`,
        );
      }
    }
  }
});

test("each documented variant is referenced in its primitive source", () => {
  for (const [file, variants] of Object.entries(VARIANT_CONTRACT)) {
    const src = readFileSync(resolve(primitivesDir, file), "utf8");
    for (const variant of variants) {
      // The variant must appear as a quoted string somewhere in the source
      // (in the variants array, switch/conditional, or both).
      const single = `'${variant}'`;
      const double = `"${variant}"`;
      assert.ok(
        src.includes(single) || src.includes(double),
        `${file} no longer references variant "${variant}" — did you rename ` +
          `or remove it? Update VARIANT_CONTRACT in the contract test too.`,
      );
    }
  }
});

test("Button exports BUTTON_VARIANTS that matches the contract", () => {
  const src = readFileSync(resolve(primitivesDir, "Button.tsx"), "utf8");
  // Roughly check the exported array is complete. The TS-level type is the
  // hard contract; this assertion catches accidental edits to the runtime
  // constant.
  for (const variant of VARIANT_CONTRACT["Button.tsx"]) {
    assert.ok(
      src.includes(`"${variant}"`),
      `Button.tsx BUTTON_VARIANTS is missing "${variant}"`,
    );
  }
});

test("Text enforces a 12px minimum font size floor", () => {
  const src = readFileSync(resolve(primitivesDir, "Text.tsx"), "utf8");
  assert.ok(
    src.includes("MIN_LEGIBLE_FONT_SIZE"),
    "Text.tsx must declare a MIN_LEGIBLE_FONT_SIZE floor so caption + " +
      "compact font-scale never drops below 12px.",
  );
  assert.ok(
    /MIN_LEGIBLE_FONT_SIZE\s*=\s*1[2-9]/.test(src),
    "Text.tsx MIN_LEGIBLE_FONT_SIZE must be >= 12 (raw value floor).",
  );
});

test("Button avoids reflow on press (no border/padding change in pressed branch)", () => {
  const src = readFileSync(resolve(primitivesDir, "Button.tsx"), "utf8");
  // The pressed state should ONLY adjust opacity. We grep the file and
  // ensure the only ternary tied to `pressed` produces an opacity value.
  // A cheap heuristic: every occurrence of `pressed ?` should be on the
  // same line/expression that sets `opacity`.
  const pressedLines = src
    .split("\n")
    .map((line, idx) => ({ line, idx }))
    .filter((entry) => /\bpressed\s*\?/.test(entry.line));
  for (const { line, idx } of pressedLines) {
    assert.ok(
      /opacity/.test(line),
      `Button.tsx:${idx + 1} mutates a non-opacity property on press, which ` +
        `causes layout reflow. Keep pressed-state changes to opacity only.`,
    );
  }
});

test("Field consumes tokens and stays free of inline hex", () => {
  // Field is owned by the primitives layer (shared by account, login,
  // settings, etc). The general hex-literal sweep above already covers it,
  // but pin the explicit expectations here so a future regression surfaces
  // with a focused error.
  const src = readFileSync(resolve(primitivesDir, "Field.tsx"), "utf8");
  assert.ok(src.includes("useAppTheme"), "Field.tsx must consume useAppTheme");
  assert.ok(
    src.includes("tokens.colors.border") || src.includes("tokens.colors.borderMuted"),
    "Field.tsx must route its border through token colors",
  );
  assert.ok(
    src.includes("tokens.typography"),
    "Field.tsx must route font sizing through tokens.typography",
  );
});
