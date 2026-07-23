// Open-book spread (R5 / OB6 / OB8) — tests for FootnoteChoices: the PURE
// numbering + Novel-collapse logic (transpiled & import-stripped, exercised for
// real) plus source-drift pins that it submits through the UNCHANGED onChoose,
// leaves ChoiceList untouched, and collapses to the page-turn in Novel mode.
//
// Run:
//   node --test apps/app/components/reading/__tests__/footnoteChoices.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const modulePath = resolve(here, "../layouts/spread/FootnoteChoices.tsx");
const choiceListPath = resolve(here, "../../choices/ChoiceList.tsx");
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
const { buildFootnotes, isNovelReading } = mod;

const branching = [
  { id: "c1", label: "Answer the signal" },
  { id: "c2", label: "Row toward the dark" },
];

test("buildFootnotes numbers submittable choices 1..N", () => {
  const entries = buildFootnotes(branching);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((e) => [e.kind, e.number, e.choice.id]),
    [
      ["choice", 1, "c1"],
      ["choice", 2, "c2"],
    ],
  );
});

test("locked rows keep a lock (no number) so the actionable sequence stays 1..N", () => {
  const withLock = [
    { id: "c1", label: "Answer the signal" },
    { id: "locked1", label: "Force the iron door", locked: true },
    { id: "c2", label: "Row toward the dark" },
  ];
  const entries = buildFootnotes(withLock);
  assert.deepEqual(
    entries.map((e) => (e.kind === "locked" ? "locked" : e.number)),
    [1, "locked", 2],
    "the locked row does not consume a footnote number",
  );
});

test("the free-form row trails only when enabled", () => {
  assert.equal(buildFootnotes(branching).at(-1).kind, "choice");
  const withFreeform = buildFootnotes(branching, { showFreeform: true });
  assert.equal(withFreeform.at(-1).kind, "freeform");
  assert.equal(withFreeform.length, 3);
});

test("buildFootnotes tolerates null/undefined/empty choice sets", () => {
  assert.deepEqual(buildFootnotes(null), []);
  assert.deepEqual(buildFootnotes(undefined), []);
  assert.deepEqual(buildFootnotes([]), []);
  assert.deepEqual(buildFootnotes([], { showFreeform: true }).map((e) => e.kind), ["freeform"]);
});

test("isNovelReading is true ONLY for the novel content axis (OB8)", () => {
  assert.equal(isNovelReading("novel"), true);
  assert.equal(isNovelReading("story"), false);
  assert.equal(isNovelReading(null), false);
  assert.equal(isNovelReading(undefined), false);
});

// --- Source-drift: submits via the UNCHANGED onChoose, no pipeline fork ------

test("footnotes submit through the raw onChoose (identical to a button tap — R5.1)", () => {
  assert.match(source, /onPress=\{\(\)\s*=>\s*onChoose\(choice\)\}/, "a footnote press calls onChoose(choice)");
  // No bespoke submit path — the choice model type is the only useTurn touch.
  assert.doesNotMatch(source, /submitChoice\(/, "must not call submitChoice directly");
  // Only the choice MODEL type is borrowed from useTurn — never a value import.
  assert.doesNotMatch(source, /^import\s+\{[^}]*\}\s+from\s+["'][^"']*useTurn/m, "no runtime dependency on useTurn");
});

// --- Source-drift: ChoiceList stays byte-identical (OB6) ---------------------

test("FootnoteChoices does NOT import or render ChoiceList (it is a NEW thin component)", () => {
  assert.doesNotMatch(source, /<ChoiceList[\s/>]/, "the spread must not render ChoiceList");
  assert.doesNotMatch(source, /import[^\n]*\bChoiceList\b/, "the spread must not import ChoiceList");
});

test("ChoiceList.tsx is untouched — no footnote/spread coupling leaked in (OB6/R5.3)", () => {
  const choiceList = readFileSync(choiceListPath, "utf8");
  assert.doesNotMatch(choiceList, /footnote/i, "ChoiceList must not learn about footnotes");
  assert.doesNotMatch(choiceList, /FootnoteChoices/);
});

test("the locked/free-form/check pieces are REUSED, not re-implemented (R5.1)", () => {
  for (const piece of ["CheckChip", "FreeformChoice", "LockedChoiceCopy"]) {
    assert.match(source, new RegExp(piece), `missing reused choice piece: ${piece}`);
  }
});

// --- Source-drift: Novel collapses to the single page-turn (OB8) -------------

test("Novel mode collapses to a single page-turn affordance via layouts/pageTurn.ts", () => {
  assert.match(source, /isNovelReading\(readingMode\)/, "novel gate reads the reading mode");
  assert.match(source, /resolvePageTurnChoice<ChoiceProjection>\(choices\)/, "resolves the server-stamped choice");
  assert.match(source, /canTurnPage\(/, "self-guards like the row it replaces");
  assert.match(source, /pageTurnLabel\(/);
  // The affordance submits the resolved server choice unchanged (never fabricated).
  assert.doesNotMatch(source, /id:\s*["']turn-page["']/, "must not fabricate the turn-page id");
  const labels = source.match(/accessibilityLabel="Turn the page"/g) ?? [];
  assert.equal(labels.length, 1, "exactly one 'Turn the page' affordance is exposed to a11y");
});

test("44px tap targets on the footnote pressables (a11y)", () => {
  const minHeights = source.match(/minHeight:\s*44/g) ?? [];
  assert.ok(minHeights.length >= 3, "choice / locked / page-turn rows keep a 44px target");
});
