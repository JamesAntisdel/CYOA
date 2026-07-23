// Reading-modes Wave 3 (R4.6) — behavioral tests for the pure Novel page-turn
// logic. Like autoNarrator.test.mjs (and unlike the source-drift guards), this
// exercises the REAL module: the .ts is transpiled with the repo's TypeScript
// and imported as an ES module, so resolvePageTurnChoice / canTurnPage /
// pageTurnLabel are tested for real.
//
// node --test cannot import .ts on Node 20, so we strip types on the fly with
// `ts.transpileModule` and import the emitted JS via a data: URL — no temp
// files, no loader flags, no runtime deps beyond `typescript` (already a dep).
//
// Run:
//   node --test apps/app/components/reading/__tests__/pageTurn.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const modulePath = resolve(here, "../layouts/pageTurn.ts");

const require = createRequire(import.meta.url);
const ts = require("typescript");

const source = readFileSync(modulePath, "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});
const mod = await import("data:text/javascript," + encodeURIComponent(outputText));

const {
  PAGE_TURN_CHOICE_ID,
  PAGE_TURN_FALLBACK_LABEL,
  resolvePageTurnChoice,
  canTurnPage,
  pageTurnLabel,
} = mod;

// The exact server-stamped synthetic novel choice (R4.2/R4.4).
const TURN_PAGE = { id: "turn-page", label: "Turn the page" };
// A representative branching choice row (2..4 of these in a branching save).
const branching = [
  { id: "c1", label: "Draw the blade" },
  { id: "c2", label: "Slip into the dark" },
  { id: "c3", label: "Call out" },
];

test("the pure module imports nothing from React / React Native", () => {
  // design §Code Architecture — pure module; grep the source (imports are
  // erased by transpile, so assert on the .ts directly).
  assert.ok(!/from\s+["']react/.test(source), "pageTurn.ts must not import react/react-native");
});

test("the synthetic id is EXACTLY 'turn-page' (lock-step with the server stamp)", () => {
  assert.equal(PAGE_TURN_CHOICE_ID, "turn-page");
  assert.equal(PAGE_TURN_FALLBACK_LABEL, "Turn the page");
});

test("resolvePageTurnChoice returns the SERVER-PROVIDED turn-page choice UNCHANGED (R4.6)", () => {
  const choices = [TURN_PAGE];
  const picked = resolvePageTurnChoice(choices);
  // Same reference — the id round-trips to submitChoice exactly, never fabricated.
  assert.strictEqual(picked, TURN_PAGE, "must return the exact server choice object");
  assert.equal(picked.id, "turn-page");
});

test("resolvePageTurnChoice prefers the turn-page id even if the server sends extra rows", () => {
  // Defensive: should never happen (novel schema is .max(1)), but if a stray
  // row rode along, the explicit id wins so the correct id is submitted.
  const picked = resolvePageTurnChoice([{ id: "stray", label: "x" }, TURN_PAGE]);
  assert.strictEqual(picked, TURN_PAGE);
});

test("resolvePageTurnChoice falls back to a lone choice under a different id", () => {
  const lone = { id: "next", label: "Read on" };
  assert.strictEqual(resolvePageTurnChoice([lone]), lone);
});

test("resolvePageTurnChoice returns null for a 0-choice terminal payload", () => {
  // The novel schema permits .min(0); the terminal EndingPanel owns that case.
  assert.equal(resolvePageTurnChoice([]), null);
  assert.equal(resolvePageTurnChoice(null), null);
  assert.equal(resolvePageTurnChoice(undefined), null);
});

test("resolvePageTurnChoice does NOT pick from a real branching set (no turn-page, >1 rows)", () => {
  // A branching projection has 2..4 distinct choices and no `turn-page` — the
  // page-turn must NOT invent one (that's the ChoiceList's job in that mode).
  assert.equal(resolvePageTurnChoice(branching), null);
});

test("canTurnPage gates on streaming / pending / locked exactly like the row it replaces", () => {
  assert.equal(canTurnPage({ choice: TURN_PAGE }), true);
  assert.equal(canTurnPage({ choice: TURN_PAGE, isStreaming: true }), false);
  assert.equal(canTurnPage({ choice: TURN_PAGE, pendingChoiceId: "turn-page" }), false);
  assert.equal(canTurnPage({ choice: TURN_PAGE, pendingChoiceId: "" }), true);
  assert.equal(canTurnPage({ choice: TURN_PAGE, pendingChoiceId: null }), true);
  assert.equal(canTurnPage({ choice: { id: "turn-page", locked: true } }), false);
  assert.equal(canTurnPage({ choice: null }), false);
});

test("pageTurnLabel uses the server label, falling back when absent/blank", () => {
  assert.equal(pageTurnLabel(TURN_PAGE), "Turn the page");
  assert.equal(pageTurnLabel({ id: "turn-page", label: "Read on" }), "Read on");
  assert.equal(pageTurnLabel({ id: "turn-page" }), PAGE_TURN_FALLBACK_LABEL);
  assert.equal(pageTurnLabel({ id: "turn-page", label: "   " }), PAGE_TURN_FALLBACK_LABEL);
  assert.equal(pageTurnLabel(null), PAGE_TURN_FALLBACK_LABEL);
});

// Simulate the full submit path the layout runs: resolve the choice, gate it,
// hand it to onChoose — proving the SAME turn-page id reaches submitChoice
// unchanged, and that a branching set never produces a page-turn submission.
test("end-to-end: a novel scene submits the turn-page id unchanged; branching does not", () => {
  const submitted = [];
  const onChoose = (choice) => submitted.push(choice.id);

  // Novel scene: one page-turn choice.
  const novelChoice = resolvePageTurnChoice([TURN_PAGE]);
  if (canTurnPage({ choice: novelChoice, isStreaming: false, pendingChoiceId: null })) {
    onChoose(novelChoice);
  }
  assert.deepEqual(submitted, ["turn-page"], "novel scene submits exactly the turn-page id");

  // Branching scene: no page-turn affordance fires.
  submitted.length = 0;
  const branchingChoice = resolvePageTurnChoice(branching);
  if (branchingChoice && canTurnPage({ choice: branchingChoice })) {
    onChoose(branchingChoice);
  }
  assert.deepEqual(submitted, [], "branching scene never submits through the page-turn");
});
