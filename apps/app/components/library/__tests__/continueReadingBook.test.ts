// Reading-modes R2.7 — drift guards for the "Read as book" affordance on
// finished-save rows in ContinueReading.
//
// The component imports react-native + expo-router, so (per the co-located
// vitest config: "Tests must not import React Native runtime") we do NOT
// mount it. Instead we drift-guard the source for the load-bearing branch
// and mirror the pure `isFinishedSave` predicate so the self-hide logic is
// covered with plain data. Keep the mirror in lock-step with
// `ContinueReading.tsx`.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../ContinueReading.tsx"), "utf8");

// Mirror of the exported predicate in ContinueReading.tsx.
type SaveStatus = "active" | "dead" | "ended" | "ended_safely";
function isFinishedSave(status: SaveStatus): boolean {
  return status === "dead" || status === "ended" || status === "ended_safely";
}

describe("isFinishedSave (mirror)", () => {
  it("is true for every terminal status", () => {
    expect(isFinishedSave("dead")).toBe(true);
    expect(isFinishedSave("ended")).toBe(true);
    expect(isFinishedSave("ended_safely")).toBe(true);
  });

  it("is false for an active (in-progress) save", () => {
    expect(isFinishedSave("active")).toBe(false);
  });
});

describe("ContinueReading read-as-book affordance", () => {
  it("exports the pure isFinishedSave predicate", () => {
    expect(source).toMatch(/export function isFinishedSave\(/);
  });

  it("gates the affordance on a finished save so active rows self-hide", () => {
    expect(source).toMatch(
      /const showReadAsBook = isFinishedSave\(save\.status\)/,
    );
    // The affordance renders only behind the showReadAsBook guard.
    expect(source).toMatch(/\{showReadAsBook \? \(/);
  });

  it("navigates directly to /read/[saveId]/book via the router", () => {
    expect(source).toMatch(/useRouter/);
    expect(source).toMatch(
      /router\.push\(`\/read\/\$\{save\.saveId\}\/book`\)/,
    );
  });

  it("labels the affordance for a11y and shows a 'Read as book' target", () => {
    expect(source).toMatch(/accessibilityLabel=\{`Read \$\{save\.title\} as a book`\}/);
    expect(source).toMatch(/Read as book/);
  });
});
