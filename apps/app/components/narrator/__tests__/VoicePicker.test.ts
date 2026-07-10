// Surface-only tests for VoicePicker. Validates that the component module
// exports the expected entry points and that the seed catalogue surfaced to
// it stays in sync. Behaviour tests for picker state live in the hook test.

import { NARRATOR_VOICES } from "../../../hooks/useNarratorVoice";
import { ConfirmDialog, VoicePicker } from "../VoicePicker";

type TestCase = { name: string; run: () => void };

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} — expected ${String(expected)} but got ${String(actual)}`);
  }
}

export const tests: TestCase[] = [
  {
    name: "exports a VoicePicker component",
    run: () => {
      assertEqual(typeof VoicePicker, "function", "component is a function");
      assertEqual(VoicePicker.name, "VoicePicker", "component name");
    },
  },
  {
    name: "exports a ConfirmDialog for mid-tale changes",
    run: () => {
      assertEqual(typeof ConfirmDialog, "function", "dialog is a function");
      assertEqual(ConfirmDialog.name, "ConfirmDialog", "dialog name");
    },
  },
  {
    name: "the picker surfaces all six seeded voices",
    run: () => {
      // Indirect verification — the picker iterates NARRATOR_VOICES verbatim.
      assertEqual(NARRATOR_VOICES.length, 6, "voice count surfaced to picker");
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
