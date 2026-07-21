// "Candlelight Focus" immersion mode (phase-2 quick-win) — tests for the PURE
// decision logic that gates the chrome fade (apps/app/hooks/useCandlelightFocus.ts).
//
// The gating decision lives in the pure, exported `computeChromeFaded` +
// `focusGuardActive`, so we exercise them FOR REAL: the hook's .ts is
// transpiled with the repo's TypeScript, its `react` + `react-native` imports
// are stubbed (never invoked — we only call the pure functions), and the
// module is imported as a data: URL. This mirrors useAutoNarrator.test.mjs.
//
// Run:
//   node --test apps/app/components/reading/__tests__/useCandlelightFocus.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const hookPath = resolve(here, "../../../hooks/useCandlelightFocus.ts");

const require = createRequire(import.meta.url);
const ts = require("typescript");

const transpile = (src) =>
  ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

// Transpile the hook, then stub the react + react-native imports so the module
// evaluates under `node --test` (the pure functions touch neither).
let out = transpile(readFileSync(hookPath, "utf8"));
out = out.replace(
  /import\s*\{[^}]*\}\s*from\s*["']react["'];?/,
  "const useEffect=()=>{},useRef=(v)=>({current:v}),useState=(v)=>[v,()=>{}];",
);
out = out.replace(
  /import\s*\{[^}]*\}\s*from\s*["']react-native["'];?/,
  "const Animated={Value:class{constructor(v){this._v=v}setValue(){}}};",
);

const mod = await import("data:text/javascript," + encodeURIComponent(out));
const { computeChromeFaded, focusGuardActive, FOCUS_IDLE_MS, FOCUS_FADE_OUT_MS } = mod;

const NO_GUARDS = {
  anySheetOpen: false,
  atChapterBoundary: false,
  atEnding: false,
  candleGutterShown: false,
  softSignupShown: false,
  isStreaming: false,
};

const GUARD_KEYS = [
  "anySheetOpen",
  "atChapterBoundary",
  "atEnding",
  "candleGutterShown",
  "softSignupShown",
  "isStreaming",
];

// ── Constants ───────────────────────────────────────────────────────────────

test("idle threshold is ~4s and the fade-out has a positive duration", () => {
  assert.equal(FOCUS_IDLE_MS, 4000);
  assert.ok(FOCUS_FADE_OUT_MS > 0);
});

// ── focusGuardActive ────────────────────────────────────────────────────────

test("no guard active ⇒ focusGuardActive is false", () => {
  assert.equal(focusGuardActive({ ...NO_GUARDS }), false);
});

test("EACH guard individually marks the chrome as guard-held (must stay lit)", () => {
  for (const key of GUARD_KEYS) {
    assert.equal(
      focusGuardActive({ ...NO_GUARDS, [key]: true }),
      true,
      `guard '${key}' must hold the chrome lit`,
    );
  }
});

// ── computeChromeFaded matrix ───────────────────────────────────────────────

test("focusMode OFF never fades — even when idle and unguarded", () => {
  assert.equal(
    computeChromeFaded({ focusMode: false, idle: true, guards: { ...NO_GUARDS } }),
    false,
  );
});

test("focusMode ON + idle + no guards ⇒ chrome fades", () => {
  assert.equal(
    computeChromeFaded({ focusMode: true, idle: true, guards: { ...NO_GUARDS } }),
    true,
  );
});

test("focusMode ON + NOT idle ⇒ chrome stays lit (any recent input)", () => {
  assert.equal(
    computeChromeFaded({ focusMode: true, idle: false, guards: { ...NO_GUARDS } }),
    false,
  );
});

test("EACH guard keeps the chrome lit even when focusMode ON and idle", () => {
  for (const key of GUARD_KEYS) {
    assert.equal(
      computeChromeFaded({
        focusMode: true,
        idle: true,
        guards: { ...NO_GUARDS, [key]: true },
      }),
      false,
      `guard '${key}' must keep the chrome lit`,
    );
  }
});

test("guards win over idle regardless of focusMode ordering (no fade under any guard)", () => {
  // The chrome fades ONLY in the single all-clear cell: focusMode && idle &&
  // no guard. Every other combination in the 2×2×(guards) space stays lit.
  for (const focusMode of [true, false]) {
    for (const idle of [true, false]) {
      for (const key of GUARD_KEYS) {
        assert.equal(
          computeChromeFaded({ focusMode, idle, guards: { ...NO_GUARDS, [key]: true } }),
          false,
        );
      }
    }
  }
});

// ── Source-level drift guards (the React shell around the pure fn) ──────────
// Cheap assertions that the shell keeps the properties the mini-spec requires,
// so a refactor can't silently drop them (the timer/animation are not unit-
// mounted here — the pure decision above is the behavioral contract).

const source = readFileSync(hookPath, "utf8");

test("restore is INSTANT — the not-faded branch snaps opacity via setValue, not a tween", () => {
  // The `if (!faded) { opacity.setValue(1); ... }` early return must precede the
  // Animated.timing call so a restore never animates in.
  const idxSnap = source.indexOf("opacity.setValue(1)");
  const idxTiming = source.indexOf("Animated.timing");
  assert.ok(idxSnap !== -1, "expected an instant setValue(1) restore");
  assert.ok(idxTiming !== -1, "expected an Animated.timing fade-out");
  assert.ok(idxSnap < idxTiming, "the instant restore must precede the tween");
});

test("reduced-motion SNAPS the fade-out (setValue(0)) instead of animating", () => {
  assert.ok(/reducedMotion[\s\S]*opacity\.setValue\(0\)/.test(source));
});

test("feature is INERT without a DOM event target (native) — never fades there", () => {
  assert.ok(/getEventTarget/.test(source));
  assert.ok(/if \(!target\)[\s\S]*setFaded\(false\)/.test(source));
});

test("listens for pointer/touch/key/scroll input to restore the chrome", () => {
  for (const ev of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"]) {
    assert.ok(source.includes(`"${ev}"`), `expected activity listener for '${ev}'`);
  }
});
