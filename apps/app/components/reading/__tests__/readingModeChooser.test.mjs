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

// Real behavioral import of the extracted pure gate. The chooser TSX is
// transpiled with its RN/theme/primitives/meta imports stubbed so we can load
// the module and exercise `isReadingModeLocked` for real (the JSX component is
// never rendered — only the pure function is called).
const primitivesStub =
  "data:text/javascript," +
  encodeURIComponent("export const Text = function Text() { return null; };");
const rnPressableStub =
  "data:text/javascript," +
  encodeURIComponent(
    "export const View = function View() { return null; };\n" +
      "export const Pressable = function Pressable() { return null; };",
  );
const metaStub =
  "data:text/javascript," +
  encodeURIComponent(
    "export const ModeMark = function ModeMark() { return null; };\n" +
      "export const READING_MODE_META = { branching: {}, novel: {} };",
  );
const chooserSource = src
  .replace(/from "react-native"/g, `from ${JSON.stringify(rnPressableStub)}`)
  .replace(/from "\.\.\/\.\.\/lib\/readingMode"/g, `from ${JSON.stringify(metaStub)}`)
  .replace(/from "\.\.\/\.\.\/theme"/g, `from ${JSON.stringify(themeStub)}`)
  .replace(/from "\.\.\/primitives"/g, `from ${JSON.stringify(primitivesStub)}`);
const { outputText: chooserOut } = ts.transpileModule(chooserSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.React,
  },
});
const { isReadingModeLocked } = await import(
  "data:text/javascript," + encodeURIComponent(chooserOut)
);

test("isReadingModeLocked: only Novel-without-Pro is locked", () => {
  // Novel is the ONLY gated row, and only for a non-Pro reader.
  assert.equal(isReadingModeLocked("novel", false), true, "novel + non-Pro is locked");
  assert.equal(isReadingModeLocked("novel", true), false, "novel + Pro is never locked");
  assert.equal(isReadingModeLocked("branching", false), false, "branching is never gated");
  assert.equal(isReadingModeLocked("branching", true), false, "branching + Pro is not gated");
});

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

test("Pro-gate props are OPTIONAL and default to entitled (settings-drawer usage unchanged)", () => {
  // Both new props are optional so callers that don't pass them (the settings
  // drawer, owned elsewhere) compile and behave byte-identically.
  assert.match(src, /isPro\?:\s*boolean;/, "isPro is an optional prop");
  assert.match(src, /onNovelLocked\?:\s*\(\)\s*=>\s*void;/, "onNovelLocked is an optional callback");
  // isPro defaults to true (entitled) so nothing is ever locked unless a create
  // surface explicitly passes isPro={false}.
  assert.match(src, /isPro = true/, "isPro defaults to entitled");
});

test("non-Pro Novel row renders a ' · Pro' affordance and routes the tap to onNovelLocked", () => {
  assert.match(src, /const locked = isReadingModeLocked\(mode, isPro\)/, "row locked state comes from the pure gate");
  assert.match(src, /`\$\{meta\.label\} · Pro`/, "locked Novel row shows the ' · Pro' suffix (matches Illustrated Book)");
  // A locked tap calls onNovelLocked INSTEAD of onChange — never a silent
  // downgrade.
  assert.match(
    src,
    /if \(locked\) \{\s*onNovelLocked\?\.\(\);\s*return;\s*\}\s*onChange\(mode\);/,
    "a locked tap routes to onNovelLocked and never falls through to onChange",
  );
});

test("all four create surfaces gate Novel on the shared pro-media entitlement", () => {
  const surfaces = {
    "app/index.tsx": "..",
    "app/library/index.tsx": "..",
    "app/discover/index.tsx": "..",
    "components/creator/SeedStoryFlow.tsx": "..",
  };
  for (const rel of Object.keys(surfaces)) {
    const surfaceSrc = readFileSync(resolve(appRoot, rel), "utf8");
    assert.match(
      surfaceSrc,
      /isIllustratedBookUnlocked\(profile\)/,
      `${rel} computes Novel entitlement through the shared pro-media gate`,
    );
    assert.match(
      surfaceSrc,
      /onNovelLocked=\{\(\) => router\.push\("\/paywall\?reason=pro_media"\)\}/,
      `${rel} routes a locked Novel tap to the pro_media paywall`,
    );
    assert.match(
      surfaceSrc,
      /isPro=\{novelUnlocked\}/,
      `${rel} passes the resolved entitlement into the chooser`,
    );
  }
});
