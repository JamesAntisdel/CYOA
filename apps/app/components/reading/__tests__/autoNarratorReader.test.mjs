// Reading-modes Wave 1 — drift guards for the auto-narrator wiring inside
// ReaderScreen (task 1.3, R1.5/R1.8) + the read-as-books ending-panel handoff
// (R2.7). Mounting ReaderScreen needs the full RN + Convex harness the rest of
// components/reading/__tests__ avoids, so these are source-level invariants —
// the same discipline as readerSaveActions.test.mjs / useTurnReactivity.test.mjs.
//
// Run:
//   node --test apps/app/components/reading/__tests__/autoNarratorReader.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const readerScreenSource = readFileSync(resolve(here, "../ReaderScreen.tsx"), "utf8");
const typesSource = readFileSync(resolve(here, "../layouts/types.ts"), "utf8");
const LAYOUTS = ["Book", "Mobile", "Journal", "GraphicNovel", "ModernApp"].map((name) =>
  readFileSync(resolve(here, `../layouts/${name}.tsx`), "utf8"),
);

test("ReaderScreen mounts useAutoNarrator with the full R1.2 guard set", () => {
  assert.ok(
    /useAutoNarrator</.test(readerScreenSource),
    "ReaderScreen must mount the useAutoNarrator hook",
  );
  // Every halt guard from R1.2 must be threaded into the hook's guard bag.
  for (const guard of [
    "isStreaming",
    "pendingChoiceId",
    "hasEnding",
    "atChapterBoundary",
    "candleGuttered",
    "hasError",
  ]) {
    assert.ok(
      new RegExp(`${guard}`).test(readerScreenSource),
      `ReaderScreen must pass the '${guard}' halt guard to useAutoNarrator`,
    );
  }
  // The candle-gutter guard reuses the derived showCandleGutter, the ending +
  // boundary guards come off the projection / chapterBoundary.
  assert.ok(
    /candleGuttered:\s*showCandleGutter/.test(readerScreenSource),
    "candleGuttered guard must be the derived showCandleGutter (R1.2)",
  );
  assert.ok(
    /hasEnding:\s*Boolean\(projection\.ending\)/.test(readerScreenSource),
    "hasEnding guard must be derived from projection.ending",
  );
});

test("the auto flag rides submitChoice unchanged and stays reduced-motion aware", () => {
  // RM10: auto re-fires the EXISTING submitChoice; the hook receives it raw.
  assert.ok(
    /submitChoice,\s*$/m.test(readerScreenSource) || /submitChoice,/.test(readerScreenSource),
    "useAutoNarrator must receive the raw submitChoice (RM10)",
  );
  assert.ok(
    /reducedMotion:\s*reduceMotion\s*\|\|\s*settings\.reduceMotion/.test(readerScreenSource),
    "the hook's pacing must be reduced-motion aware (R1.8/R1.9)",
  );
});

test("chapter interstitial auto-acknowledges via acknowledgeChapter (R1.8, OQ8 default)", () => {
  assert.ok(
    /onChapterAdvance:\s*acknowledgeChapter/.test(readerScreenSource),
    "the chapter-boundary default must auto-acknowledge via acknowledgeChapter (R1.8)",
  );
});

test("the one-tap auto toggle is reachable on ANY page-state (R1.5)", () => {
  // The pill lives in the ReaderSaveActions row, which renders ABOVE the
  // chapterBoundary / Layout branch — so it shows on live, chapter, ending, and
  // streaming states alike.
  assert.ok(
    /accessibilityLabel="Auto-narrator"/.test(readerScreenSource),
    "an 'Auto-narrator' toggle pill must render",
  );
  assert.ok(
    /accessibilityState=\{\{\s*selected:\s*autoOn\s*\}\}/.test(readerScreenSource),
    "the toggle must expose its ON/OFF state to assistive tech",
  );
  const actionsIdx = readerScreenSource.indexOf("<ReaderSaveActions");
  const boundaryIdx = readerScreenSource.indexOf("{chapterBoundary ? (");
  const layoutIdx = readerScreenSource.indexOf("<Layout");
  assert.ok(actionsIdx > 0, "ReaderSaveActions must render");
  assert.ok(
    actionsIdx < boundaryIdx && actionsIdx < layoutIdx,
    "the toggle row must render before the chapter/ending/layout branch so it is reachable on any page",
  );
  // The row receives the live flag + toggle from the hook.
  assert.ok(
    /<ReaderSaveActions\s+saveId=\{saveId\}\s+autoOn=\{autoOn\}\s+onToggleAuto=\{toggleAuto\}/.test(
      readerScreenSource,
    ),
    "ReaderSaveActions must receive autoOn + onToggleAuto from the hook",
  );
});

test("a manual choice tap grabs the wheel — flips auto OFF then submits (R1.5/OQ8)", () => {
  assert.ok(
    /const handleManualChoose = useCallback\(/.test(readerScreenSource),
    "manual taps must go through a wrapper that can reassert control",
  );
  assert.ok(
    /setAutoOn\(false\)/.test(readerScreenSource),
    "a manual tap must flip auto OFF (grab the wheel — OQ8 default)",
  );
  assert.ok(
    /onChoose=\{handleManualChoose\}/.test(readerScreenSource),
    "the layout's onChoose must be the grab-the-wheel wrapper, not the raw submitChoice",
  );
});

test("the read-as-books handler is wired to the ending panel (R2.7)", () => {
  // ReaderScreen → Layout onReadAsBook → book route.
  assert.ok(
    /onReadAsBook=\{\(\)\s*=>\s*router\.push\(`\/read\/\$\{saveId\}\/book`\)\}/.test(
      readerScreenSource,
    ),
    "ReaderScreen must wire onReadAsBook to the /read/[saveId]/book route",
  );
  // types.ts threads it through endingPanelHandlers (conditional — never undefined).
  assert.ok(
    /onReadAsBook\?:\s*Nav/.test(typesSource) && /onReadAsBook\?:\s*\(\)\s*=>\s*void/.test(typesSource),
    "endingPanelHandlers must accept + emit onReadAsBook",
  );
  assert.ok(
    /if\s*\(props\.onReadAsBook\)\s*handlers\.onReadAsBook\s*=\s*props\.onReadAsBook/.test(
      typesSource,
    ),
    "onReadAsBook must be conditionally spread (BC4 — never undefined)",
  );
  // Every layout forwards it into endingPanelHandlers.
  for (const [i, src] of LAYOUTS.entries()) {
    assert.ok(
      /onSeeMap, onShareEnding, onReadAsBook \}\)/.test(src),
      `layout #${i} must pass onReadAsBook into endingPanelHandlers`,
    );
  }
});
