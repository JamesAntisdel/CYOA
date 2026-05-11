// Smoke + content-shape tests for the NarratorContinuity preview surface.
// Same harness convention as useNarratorVoice.test.ts (no vitest dep).

import { NARRATOR_CONTINUITY_STEPS, NarratorContinuity } from "../NarratorContinuity";

type TestCase = { name: string; run: () => void };

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} — expected ${String(expected)} but got ${String(actual)}`);
  }
}

export const tests: TestCase[] = [
  {
    name: "exposes exactly the four canvas-defined continuity steps in order",
    run: () => {
      assertEqual(NARRATOR_CONTINUITY_STEPS.length, 4, "step count");
      assertEqual(NARRATOR_CONTINUITY_STEPS[0]!.kicker, "1 · Pick", "step 1");
      assertEqual(NARRATOR_CONTINUITY_STEPS[1]!.kicker, "2 · Save", "step 2");
      assertEqual(NARRATOR_CONTINUITY_STEPS[2]!.kicker, "3 · Resume", "step 3");
      assertEqual(NARRATOR_CONTINUITY_STEPS[3]!.kicker, "4 · Change", "step 4");
    },
  },
  {
    name: "every step has a kicker, title, and non-empty body",
    run: () => {
      for (const step of NARRATOR_CONTINUITY_STEPS) {
        assert(step.kicker.length > 0, `kicker for ${step.title}`);
        assert(step.title.length > 0, "title");
        assert(step.body.length > 20, "body has enough copy");
      }
    },
  },
  {
    name: "exports a React component named NarratorContinuity",
    run: () => {
      assertEqual(typeof NarratorContinuity, "function", "component is a function");
      assertEqual(NarratorContinuity.name, "NarratorContinuity", "component name");
    },
  },
  {
    name: "the change step references confirmation copy",
    run: () => {
      const changeStep = NARRATOR_CONTINUITY_STEPS[3]!;
      assert(/confirm/i.test(changeStep.body), "mentions confirm");
      assert(/re-?plays?/i.test(changeStep.body), "mentions re-play");
    },
  },
];

export function runTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  for (const t of tests) {
    try {
      t.run();
      passed += 1;
    } catch (err) {
      failures.push(`${t.name}: ${(err as Error).message}`);
    }
  }
  return { passed, failed: failures.length, failures };
}
