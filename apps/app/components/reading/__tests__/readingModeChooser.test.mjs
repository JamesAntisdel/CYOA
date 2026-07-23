// Reading-modes cleanup (A2 SEAM + CHOOSER) — drift-guards for
// ReadingModeChooser: the ONE two-option control that replaces the three
// duplicated inline reading-mode toggles. TSX with RN + hooks can't be rendered
// in node --test, so we assert its source shape (same pattern as
// homeReadingMode.test.mjs). READING_MODE_META is imported for real to prove the
// blurbs the chooser renders are actually non-empty.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../../.."); // apps/app
const chooserPath = resolve(appRoot, "components/reading/ReadingModeChooser.tsx");
const src = readFileSync(chooserPath, "utf8");

// Real META import (RN + theme stubbed — see readingMode.test.mjs rationale).
const require = createRequire(import.meta.url);
const ts = require("typescript");
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
const metaSource = readFileSync(resolve(appRoot, "lib/readingMode.ts"), "utf8")
  .replace(/from "react"/g, `from ${JSON.stringify(reactStub)}`)
  .replace(/from "react-native"/g, `from ${JSON.stringify(rnStub)}`)
  .replace(/from "\.\.\/theme"/g, `from ${JSON.stringify(themeStub)}`);
const { outputText } = ts.transpileModule(metaSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});
const { READING_MODE_META } = await import(
  "data:text/javascript," + encodeURIComponent(outputText)
);

test("chooser is a radiogroup of two radio options", () => {
  assert.match(src, /accessibilityRole="radiogroup"/, "outer container is a radiogroup");
  assert.match(src, /accessibilityRole="radio"/, "each option row is a radio");
  // Two options, driven by mapping the mode list rather than hand-written rows.
  assert.match(src, /MODES\.map\(\(mode\)/, "renders one row per reading mode");
  assert.match(
    src,
    /const MODES:\s*readonly ReadingMode\[\]\s*=\s*\["branching",\s*"novel"\]/,
    "both modes are present in the option list",
  );
});

test("each option enforces a 44px touch target and announces selection", () => {
  assert.match(src, /minHeight: 44/, "rows enforce a >=44px touch target");
  assert.match(
    src,
    /accessibilityState=\{\{ selected \}\}/,
    "each row announces its selected state",
  );
  assert.match(src, /const selected = mode === value/, "selection derives from value");
});

test("each option shows the drawn mark + label + always-visible blurb", () => {
  assert.match(src, /<ModeMark mode=\{mode\}/, "renders the drawn ModeMark per row");
  assert.match(src, /READING_MODE_META\[mode\]/, "pulls copy from the shared meta");
  assert.match(src, /meta\.label/, "renders the label");
  assert.match(src, /meta\.blurb/, "renders the always-visible blurb");
  // The blurbs actually exist and are non-trivial.
  assert.ok(READING_MODE_META.branching.blurb.length > 10);
  assert.ok(READING_MODE_META.novel.blurb.length > 10);
});

test("chooser is presentational — value + onChange only, no data fetching", () => {
  assert.match(src, /onChange\(mode\)/, "onPress delegates to onChange");
  assert.match(
    src,
    /value:\s*ReadingMode;\s*onChange:\s*\(mode:\s*ReadingMode\)\s*=>\s*void;/,
    "props are the pinned value + onChange contract",
  );
  // No server / account / fetch imports — the owner handles persistence.
  assert.ok(!/gameApi/.test(src), "must not import gameApi");
  assert.ok(!/useAccountProfile|useAccount/.test(src), "must not read account state");
  assert.ok(!/\bfetch\(/.test(src), "must not fetch");
});

test("chooser uses theme tokens and no control emoji", () => {
  assert.match(src, /useAppTheme/, "styles from theme tokens");
  assert.ok(
    !/\p{Extended_Pictographic}/u.test(src),
    "no emoji in the chooser (RC5)",
  );
});
