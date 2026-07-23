// Reading-modes Wave 1 — behavioral tests for the pure auto-narrator pick
// policy (R1.3, R1.9). Unlike most components/* drift-guards (which grep
// source), this exercises the REAL module: the .ts is transpiled with the
// repo's TypeScript and imported as an ES module, so the locked-filter,
// all-locked->null, seeded determinism, and weighting are tested for real.
//
// node --test cannot import .ts on Node 20, so we strip types on the fly with
// `ts.transpileModule` and import the emitted JS via a data: URL — no temp
// files, no loader flags, no runtime deps beyond `typescript` (already a dep).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const readingRoot = resolve(here, "..");
const modulePath = resolve(readingRoot, "autoNarrator.ts");

const require = createRequire(import.meta.url);
const ts = require("typescript");

const source = readFileSync(modulePath, "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});
const mod = await import(
  "data:text/javascript," + encodeURIComponent(outputText)
);

const {
  pickAutoChoice,
  autoDelayMs,
  AUTO_DELAY_MS,
  AUTO_DELAY_REDUCED_MS,
  AUTO_SESSION_ADVANCE_CAP,
} = mod;

const choice = (id, extra = {}) => ({ id, label: `Choice ${id}`, ...extra });

test("the pure module imports nothing from React / React Native", () => {
  // R1.3 / design §Code Architecture — pure module; grep the source (imports
  // are erased by transpile, so assert on the .ts directly).
  assert.ok(
    !/from\s+["']react/.test(source),
    "autoNarrator.ts must not import react/react-native",
  );
  assert.ok(!/\brequire\(/.test(source), "no runtime require in the pure module");
});

test("pickAutoChoice filters out locked rows — never returns a locked choice", () => {
  const choices = [
    choice("a", { locked: true }),
    choice("b"),
    choice("c", { locked: true }),
    choice("d"),
  ];
  // Sweep many seeds; the pick must always be one of the two unlocked rows.
  for (let seed = 0; seed < 500; seed++) {
    const pick = pickAutoChoice(choices, { seed });
    assert.ok(pick, "a submittable choice exists, so a pick is returned");
    assert.equal(pick.locked, undefined, "never picks a locked row");
    assert.ok(["b", "d"].includes(pick.id), "picks only among the unlocked");
  }
});

test("pickAutoChoice returns null when EVERY choice is locked (stalls auto)", () => {
  const allLocked = [
    choice("a", { locked: true }),
    choice("b", { locked: true }),
  ];
  assert.equal(pickAutoChoice(allLocked), null, "all-locked -> null (R1.2)");
});

test("pickAutoChoice is total — null/undefined/empty never throw, yield null", () => {
  assert.equal(pickAutoChoice(null), null);
  assert.equal(pickAutoChoice(undefined), null);
  assert.equal(pickAutoChoice([]), null);
  // A single unlocked choice is returned directly.
  const only = [choice("solo")];
  assert.equal(pickAutoChoice(only)?.id, "solo");
});

test("pickAutoChoice is deterministic under a fixed seed", () => {
  const choices = [choice("a"), choice("b"), choice("c"), choice("d")];
  for (let seed = 0; seed < 50; seed++) {
    const first = pickAutoChoice(choices, { seed });
    // Repeated calls with the same seed + choices are byte-stable.
    for (let repeat = 0; repeat < 5; repeat++) {
      assert.equal(pickAutoChoice(choices, { seed })?.id, first?.id);
    }
  }
});

test("pickAutoChoice is deterministic per-scene WITHOUT an explicit seed", () => {
  // Same settled scene (same choice ids) -> same pick across re-renders, so a
  // React re-render never flips the chosen path.
  const choices = [choice("north"), choice("south"), choice("east")];
  const baseline = pickAutoChoice(choices)?.id;
  for (let i = 0; i < 20; i++) {
    assert.equal(pickAutoChoice(choices)?.id, baseline);
  }
});

test("the narrator's pick is WEIGHTED toward the earlier, more salient path", () => {
  const choices = [choice("first"), choice("second"), choice("third"), choice("last")];
  const counts = { first: 0, second: 0, third: 0, last: 0 };
  const N = 8000;
  for (let seed = 0; seed < N; seed++) {
    const pick = pickAutoChoice(choices, { seed });
    counts[pick.id]++;
  }
  // Descending linear weights (4:3:2:1) — earlier choices are strictly more
  // likely, and the first beats the last by a wide margin. All are reachable.
  assert.ok(counts.first > counts.last, "first is favored over last");
  assert.ok(counts.first > counts.second, "monotone: first > second");
  assert.ok(counts.second > counts.third, "monotone: second > third");
  assert.ok(counts.third > counts.last, "monotone: third > last");
  assert.ok(counts.last > 0, "every submittable choice keeps a non-zero chance");
  // Sanity on the 4:3:2:1 shape — first ≈ 40% of the mass.
  assert.ok(
    counts.first / N > 0.3 && counts.first / N < 0.5,
    "first-choice share tracks its 4/10 weight",
  );
});

test("reduced-motion-aware pacing constants are present and ordered (R1.9)", () => {
  assert.equal(typeof AUTO_DELAY_MS, "number");
  assert.equal(typeof AUTO_DELAY_REDUCED_MS, "number");
  assert.equal(typeof AUTO_SESSION_ADVANCE_CAP, "number");
  assert.ok(AUTO_DELAY_MS > 0, "the readable pause is positive");
  assert.ok(
    AUTO_DELAY_REDUCED_MS < AUTO_DELAY_MS,
    "reduced-motion shortens the pause (R1.8/R1.9)",
  );
  assert.ok(AUTO_SESSION_ADVANCE_CAP > 0, "per-session advance cap is positive");
  // The pure selector maps the flag to the right constant.
  assert.equal(autoDelayMs(false), AUTO_DELAY_MS);
  assert.equal(autoDelayMs(true), AUTO_DELAY_REDUCED_MS);
});
