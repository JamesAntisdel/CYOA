// Drift-guards for the Story-Engagement Wave 1 client surfaces (design §4.1).
//
// These are source-level greps (the rest of components/reading/__tests__
// follows the same pattern — see fallbackTurnPanel.test.mjs) because mounting
// the RN + Convex tree is out of scope for `node --test`. The pure derivation
// logic behind these surfaces has full behavioral coverage in the vitest suite
// `apps/app/lib/__tests__/storyEngagement.test.ts`; here we assert the wiring
// that connects that logic to the reader UI can't silently regress.

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

test("QuestLine hides on legacy (arc-less) saves and renders the pursuit strip", () => {
  const src = read("components/reading/QuestLine.tsx");
  assert.match(src, /if \(!arc\) return null;/, "QuestLine must render nothing without an arc (R1.6/BC9)");
  assert.match(src, /arc\.dramaticQuestion/, "QuestLine must surface the dramatic question");
  assert.match(src, /beatDots\(arc\.beatsFired, arc\.beatsTotal\)/, "QuestLine must show count-only beat dots");
  assert.match(src, /romanAct\(arc\.act\)/, "QuestLine must show the current act");
  // Tap → peek drawer with the fuller panel.
  assert.match(src, /setOpen\(/, "QuestLine strip must toggle a peek drawer");
  assert.match(src, /threadsPending/, "QuestLine drawer must show the thread count");
});

test("ThreadsPill hides at zero and fires a one-shot echo toast on a fired thread", () => {
  const src = read("components/reading/ThreadsPill.tsx");
  assert.match(src, /threadsPending <= 0\) return null;/, "ThreadsPill must hide at zero");
  assert.match(src, /threadFiredInDiffs\(recentDiffs\)/, "ThreadsPill must detect a fired thread from the diffs");
  assert.match(src, /An earlier choice echoes\./, "ThreadsPill must raise the canonical echo toast (R3.3)");
  assert.match(src, /announcedSceneRef/, "ThreadsPill toast must be a one-shot per scene");
});

test("ChoiceList renders locked choices as a non-submitting shake+reveal card", () => {
  const src = read("components/choices/ChoiceList.tsx");
  assert.match(src, /if \(choice\.locked\)/, "ChoiceList must branch locked choices to a dedicated row");
  assert.match(src, /LockedChoiceRow/, "ChoiceList must render a LockedChoiceRow for locked choices");
  assert.match(src, /🔒/, "locked choices must show the lock affordance");
  assert.match(src, /Animated\.sequence/, "locked press must shake (Animated.sequence)");
  assert.match(src, /reducedMotion\) return;/, "shake must respect reduced motion");
  assert.match(src, /LockedChoiceCopy hint=\{choice\.hint\}/, "locked press must reveal the in-world hint");
  assert.match(src, /Locked — \$\{choice\.label\}/, "locked card must carry a 'Locked —' a11y label");
  // The locked row must NOT wire onChoose — pressing it never submits.
  const rowStart = src.indexOf("function LockedChoiceRow");
  assert.ok(rowStart > -1, "LockedChoiceRow must exist");
  assert.ok(
    !src.slice(rowStart).includes("onChoose"),
    "LockedChoiceRow must never call onChoose (no submit on locked press)",
  );
});

test("ChapterEnd stamps the act when the boundary turn advanced an act", () => {
  const src = read("components/reading/ChapterEnd.tsx");
  assert.match(src, /actNumber\?: number;/, "ChapterEnd must accept an optional actNumber");
  assert.match(src, /actLabel\?: string;/, "ChapterEnd must accept an optional actLabel");
  assert.match(src, /Act \$\{actRoman\(actNumber\)\}/, "ChapterEnd must render the 'Act II' stamp");
});

test("ReaderScreen wires QuestLine + ThreadsPill under AppNav and the act stamp into ChapterEnd", () => {
  const src = read("components/reading/ReaderScreen.tsx");
  assert.match(src, /import \{ QuestLine \}/, "ReaderScreen must import QuestLine");
  assert.match(src, /import \{ ThreadsPill \}/, "ReaderScreen must import ThreadsPill");
  assert.match(src, /<QuestLine arc=\{projection\.arc\}/, "ReaderScreen must render QuestLine from the projection arc");
  assert.match(src, /<ThreadsPill/, "ReaderScreen must render ThreadsPill");
  assert.match(
    src,
    /actStampProps\(actStampFromDiffs\(projection\.recentDiffs, projection\.arc\)\)/,
    "ReaderScreen must feed the act stamp into ChapterEnd",
  );
});

test("useTurn derives the signed echo from diffs and toasts a locked-choice denial", () => {
  const src = read("hooks/useTurn.ts");
  assert.match(src, /deriveSignedEcho\(adaptRecentDiffs\(scene\.recentDiffs\), scene\.visibleStats\)/, "the remote echo must derive from recentDiffs with a stat-snapshot fallback");
  assert.match(src, /remoteEchoFields\(/, "history entries must use the signed echo + tone");
  assert.match(src, /choice_not_available/, "a locked-choice race must be handled defensively (R4.3)");
  // The old stat-snapshot-only echo must be gone.
  assert.ok(
    !/const visibleStats = scene\.visibleStats\?\.slice\(0, 2\)/.test(src),
    "the legacy snapshot-only deriveRemoteEcho must be replaced",
  );
});
