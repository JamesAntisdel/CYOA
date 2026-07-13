// Drift-guards for the locked-choice UX polish (copy, a11y, near-miss
// legibility, first-lock coach). Source-level greps, matching the house
// pattern in components/reading/__tests__ (mounting the RN tree is out of
// scope for `node --test`). Behavioral coverage for the underlying logic
// lives in the vitest suites: `packages/engine/tests/locked-ux.test.ts`
// (fallback hints + nearness bands) and `convex/tests/lockedNearness.test.ts`
// (BC10 phrase-only projection threading).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../../..");

function read(rel) {
  return readFileSync(resolve(appRoot, rel), "utf8");
}

test("locked row a11y is truthful: pressable-with-disclosure, not disabled", () => {
  const src = read("components/choices/ChoiceList.tsx");
  const rowStart = src.indexOf("function LockedChoiceRow");
  assert.ok(rowStart > -1, "LockedChoiceRow must exist");
  const row = src.slice(rowStart);
  assert.ok(
    !row.includes("disabled: true"),
    "locked row must NOT announce as disabled — pressing it reveals the why-card",
  );
  assert.match(
    row,
    /accessibilityState=\{\{ expanded: revealed \}\}/,
    "locked row must expose the reveal as an expanded/collapsed disclosure state",
  );
  assert.match(
    row,
    /will not submit a choice/,
    "the a11y hint must say activation does not submit",
  );
});

test("locked a11y label strips a leading Needs/Requires from the hint (no double prefix)", () => {
  const src = read("components/choices/ChoiceList.tsx");
  assert.match(
    src,
    /replace\(\/\^\\s\*\(\?:needs\|requires\)\\s\+\/iu, ""\)/,
    "hint must have one leading Needs/Requires stripped before composing",
  );
  assert.match(
    src,
    /Locked — \$\{choice\.label\}\. Requires \$\{a11yHint\}\./,
    "label must compose 'Locked — <label>. Requires <stripped hint>.'",
  );
  // Behavioral spot-check of the exact strip expression used in the source.
  const strip = (hint) => hint.replace(/^\s*(?:needs|requires)\s+/iu, "");
  assert.equal(strip("Needs bone_key"), "bone_key");
  assert.equal(strip("Requires the Bone Key"), "the Bone Key");
  assert.equal(strip("The door is barred."), "The door is barred.");
});

test("near-miss band renders as tome copy — a phrase, never a number (BC10)", () => {
  const copy = read("components/choices/LockedChoiceCopy.tsx");
  assert.match(copy, /nearness\?: "near" \| "far"/, "LockedChoiceCopy must accept the band");
  assert.match(copy, /NEARNESS_COPY\[nearness\]/, "the band must render its tome-voice line");
  const near = copy.match(/near: "([^"]+)"/)?.[1];
  const far = copy.match(/far: "([^"]+)"/)?.[1];
  assert.ok(near && far, "both bands must have copy");
  assert.doesNotMatch(near, /\d/, "near copy must not leak numbers");
  assert.doesNotMatch(far, /\d/, "far copy must not leak numbers");

  const list = read("components/choices/ChoiceList.tsx");
  assert.match(
    list,
    /LockedChoiceCopy hint=\{choice\.hint\} nearness=\{choice\.nearness\}/,
    "ChoiceList must thread the band into the revealed copy",
  );

  const adapter = read("lib/storyEngagement.ts");
  assert.match(
    adapter,
    /\.\.\.\(nearness && locked \? \{ nearness \} : \{\}\)/,
    "adaptRemoteChoice must only carry the band on a still-locked choice",
  );
});

test("first-lock coach is a persisted one-shot inline line, not a modal", () => {
  const coach = read("components/choices/lockCoach.ts");
  assert.match(
    coach,
    /LOCK_COACH_SEEN_KEY = "cyoa\.lockCoachSeen\.v1"/,
    "coach must persist under a versioned key (READER_LAYOUT_OVERRIDE_KEY pattern)",
  );
  assert.match(
    coach,
    /Locked pages can be opened — the story will show you how\./,
    "coach copy must match the tome voice line",
  );
  // Panel-review-2 merged doors-journal idea: the coach now points the reader
  // up at the doors-journal pill so the locked door and the journal that
  // tracks it read as one teaching loop.
  assert.match(
    coach,
    /Watch the doors the tome remembers, in the journal above\./,
    "coach copy must point at the doors-journal pill",
  );
  assert.match(coach, /try \{/, "storage access must be guarded (native has no localStorage)");
  assert.match(coach, /getItem\(LOCK_COACH_SEEN_KEY\) === "1"/, "seen check must read the flag");
  assert.match(coach, /setItem\(LOCK_COACH_SEEN_KEY, "1"\)/, "mark must write the flag");

  const list = read("components/choices/ChoiceList.tsx");
  assert.match(list, /hasSeenLockCoach\(\)/, "ChoiceList must check the persisted flag");
  assert.match(list, /markLockCoachSeen\(\);/, "ChoiceList must mark the coach seen when shown");
  assert.match(
    list,
    /coachVisible && choice\.id === firstLockedId/,
    "coach must render once, beneath the first locked row only",
  );
  assert.match(list, /\{LOCK_COACH_COPY\}/, "coach line must render the shared copy");
  assert.ok(!list.includes("Modal"), "coach must be inline — no modal");
});
