// Reading-modes Wave 1 — tests for the auto-narrator session hook (task 1.2,
// R1.1/R1.2/R1.4/R1.6/R1.7). The guard/decision logic lives in the PURE,
// exported `resolveAutoAdvance`, so we exercise it FOR REAL: the hook's .ts is
// transpiled with the repo's TypeScript, its `react` import is stubbed out
// (we never mount the hook — only call the pure function), and its
// `../components/reading/autoNarrator` import is rewired to the transpiled pure
// module so `pickAutoChoice` + `autoDelayMs` run as shipped.
//
// node --test can't import .ts on Node 20, hence the data:-URL transpile dance
// (mirrors autoNarrator.test.mjs). The React wiring around `resolveAutoAdvance`
// is a thin timer shell drift-guarded by source assertions at the bottom.
//
// Run:
//   node --test apps/app/components/reading/__tests__/useAutoNarrator.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const readingRoot = resolve(here, "..");
const purePath = resolve(readingRoot, "autoNarrator.ts");
const hookPath = resolve(here, "../../../hooks/useAutoNarrator.ts");

const require = createRequire(import.meta.url);
const ts = require("typescript");

const transpile = (src) =>
  ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

const hookSource = readFileSync(hookPath, "utf8");

// 1) Transpile the pure policy module and expose it as a data: URL.
const pureUrl =
  "data:text/javascript," + encodeURIComponent(transpile(readFileSync(purePath, "utf8")));

// 2) Transpile the hook, stub React (never invoked — we only call the pure
//    function), and rewire the pure-module import to the data: URL above.
let hookOut = transpile(hookSource);
hookOut = hookOut.replace(
  /import\s*\{[^}]*\}\s*from\s*["']react["'];?/,
  "const useState=()=>[undefined,()=>{}],useEffect=()=>{},useMemo=(f)=>f(),useRef=(v)=>({current:v}),useCallback=(f)=>f;",
);
hookOut = hookOut.replace(
  /["']\.\.\/components\/reading\/autoNarrator["']/,
  JSON.stringify(pureUrl),
);

const hook = await import("data:text/javascript," + encodeURIComponent(hookOut));
const pure = await import(pureUrl);

const { resolveAutoAdvance } = hook;
const { AUTO_DELAY_MS, AUTO_DELAY_REDUCED_MS, AUTO_SESSION_ADVANCE_CAP } = pure;

const NO_GUARDS = {
  isStreaming: false,
  pendingChoiceId: null,
  hasEnding: false,
  atChapterBoundary: false,
  candleGuttered: false,
  hasError: false,
  isNarrating: false,
};
const TWO_CHOICES = [
  { id: "a", label: "A" },
  { id: "b", label: "B" },
];
const base = (overrides = {}) => ({
  autoOn: true,
  choices: TWO_CHOICES,
  guards: { ...NO_GUARDS },
  reducedMotion: false,
  advancesThisSession: 0,
  ...overrides,
});

test("auto OFF (the default) never advances", () => {
  const d = resolveAutoAdvance(base({ autoOn: false }));
  assert.equal(d.kind, "off");
});

test("guard truth-table — EACH halt guard individually blocks the advance (R1.2)", () => {
  // One guard true at a time, everything else clear + a submittable choice.
  const guardKeys = [
    ["isStreaming", true],
    ["pendingChoiceId", "turn-1"],
    ["hasEnding", true],
    ["atChapterBoundary", true],
    ["candleGuttered", true],
    ["hasError", true],
    // While the TTS narrator is speaking, auto holds the page-turn (never skips
    // over the narration). When it finishes (isNarrating→false) the advance
    // schedules normally.
    ["isNarrating", true],
  ];
  for (const [key, value] of guardKeys) {
    const d = resolveAutoAdvance(base({ guards: { ...NO_GUARDS, [key]: value } }));
    assert.equal(d.kind, "blocked", `guard '${key}' must block auto-advance`);
  }
});

test("re-entrancy — a pending choice blocks a second auto-advance (RM10/R1.4)", () => {
  // The double-fire case: an in-flight submission (pendingChoiceId set) means
  // the decision no-ops here, mirroring submitChoice's own self-guard.
  const d = resolveAutoAdvance(base({ guards: { ...NO_GUARDS, pendingChoiceId: "turn-1" } }));
  assert.equal(d.kind, "blocked");
});

test("halt-on-error — a surfaced turn error (incl. budget rejection) halts (R1.7)", () => {
  const d = resolveAutoAdvance(base({ guards: { ...NO_GUARDS, hasError: true } }));
  assert.equal(d.kind, "blocked");
});

test("all-locked choices STALL auto and hand control back (R1.2/R1.3)", () => {
  const allLocked = [
    { id: "a", label: "A", locked: true },
    { id: "b", label: "B", locked: true },
  ];
  assert.equal(resolveAutoAdvance(base({ choices: allLocked })).kind, "stall");
  // Empty / absent choice lists stall too (total).
  assert.equal(resolveAutoAdvance(base({ choices: [] })).kind, "stall");
  assert.equal(resolveAutoAdvance(base({ choices: null })).kind, "stall");
  assert.equal(resolveAutoAdvance(base({ choices: undefined })).kind, "stall");
});

test("per-session advance cap halts auto once reached (R1.9)", () => {
  assert.equal(
    resolveAutoAdvance(base({ advancesThisSession: AUTO_SESSION_ADVANCE_CAP })).kind,
    "capped",
  );
  // One below the cap still advances.
  assert.equal(
    resolveAutoAdvance(base({ advancesThisSession: AUTO_SESSION_ADVANCE_CAP - 1 })).kind,
    "advance",
  );
});

test("happy path advances with a submittable pick after the readable pause (R1.1)", () => {
  const d = resolveAutoAdvance(base());
  assert.equal(d.kind, "advance");
  assert.ok(["a", "b"].includes(d.choice.id), "picks among the submittable choices");
  assert.equal(d.choice.locked, undefined, "never picks a locked row");
  assert.equal(d.delayMs, AUTO_DELAY_MS, "uses the full inter-turn pause");
});

test("reduced motion shortens the inter-turn pause (R1.8/R1.9)", () => {
  const d = resolveAutoAdvance(base({ reducedMotion: true }));
  assert.equal(d.kind, "advance");
  assert.equal(d.delayMs, AUTO_DELAY_REDUCED_MS);
  assert.ok(AUTO_DELAY_REDUCED_MS < AUTO_DELAY_MS);
});

// ── Source-level drift guards on the React shell (never mounted here) ────────

test("autoOn is SESSION state defaulting OFF — never routed through useReaderSettings (R1.6)", () => {
  assert.ok(
    /useState\(\s*false\s*\)/.test(hookSource),
    "autoOn must be a useState defaulting to false (session state, default OFF)",
  );
  // Must not IMPORT or CALL useReaderSettings (the word may appear in the
  // rationale comment — we forbid the wiring, not the mention).
  assert.ok(
    !/import[^;]*useReaderSettings/.test(hookSource),
    "auto flag must NEVER import useReaderSettings (persists localStorage + mediaPrefs)",
  );
  assert.ok(
    !/useReaderSettings\s*\(/.test(hookSource),
    "auto flag must NEVER call useReaderSettings",
  );
});

test("the hook rides the pure policy module and does NOT touch useTurn (RM10)", () => {
  assert.ok(
    /from\s+["']\.\.\/components\/reading\/autoNarrator["']/.test(hookSource),
    "hook must import the pure pick policy from components/reading/autoNarrator",
  );
  assert.ok(/\bpickAutoChoice\b/.test(hookSource), "hook must use pickAutoChoice");
  assert.ok(/\bautoDelayMs\b/.test(hookSource), "hook must use the reduced-motion-aware autoDelayMs");
  assert.ok(
    !/from\s+["'][^"']*hooks\/useTurn["']/.test(hookSource),
    "hook must not import useTurn — it is reserved-by-contract (RM10)",
  );
});

test("the advance effect schedules a timer and clears it on cleanup", () => {
  assert.ok(/setTimeout\(/.test(hookSource), "advance must be scheduled on a timer");
  assert.ok(/clearTimeout\(/.test(hookSource), "the timer must be cleared on cleanup / re-arm");
});

test("chapter-boundary behavior is reduced-motion aware and gated on the boundary (R1.8)", () => {
  // The chapter auto-acknowledge fires only at a boundary and via a beat whose
  // duration is the reduced-motion-aware autoDelayMs (shortens under reduced
  // motion). Both facts are load-bearing per R1.8.
  assert.ok(
    /atChapterBoundary/.test(hookSource),
    "the boundary flag must gate the chapter effect",
  );
  assert.ok(
    /autoDelayMs\(\s*reducedMotion\s*\)/.test(hookSource),
    "the pause/beat must be reduced-motion aware via autoDelayMs(reducedMotion)",
  );
});
