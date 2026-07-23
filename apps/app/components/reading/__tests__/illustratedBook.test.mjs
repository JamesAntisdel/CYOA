// Reading-modes Wave 2 (R3) — Illustrated Book layout + registration + the
// mode-aware MediaPlate placeholder.
//
// Pure-Node, matching the rest of components/reading/__tests__: source-level
// drift guards on the layout + registration (the layout components import
// React Native so they can't be imported here), plus a MIRROR of MediaPlate's
// pure `resolveMediaPlateView` view-logic exercised across every plate state.
//
// IMPORTANT: keep the `resolveMediaPlateViewMirror` below in lock-step with
// `components/media/MediaPlate.tsx` `resolveMediaPlateView` — change one,
// change the other.

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

const illustrated = read("components/reading/layouts/IllustratedBook.tsx");
const graphicNovel = read("components/reading/layouts/GraphicNovel.tsx");
const layoutsIndex = read("components/reading/layouts/index.ts");
const readerSettings = read("hooks/useReaderSettings.ts");
const mediaPlate = read("components/media/MediaPlate.tsx");

// --- Registration: layout variant + record + cinematic literal -------------

test("READER_LAYOUTS registers illustratedBook", () => {
  assert.match(layoutsIndex, /import\s*\{\s*IllustratedBookLayout\s*\}\s*from\s*"\.\/IllustratedBook"/);
  assert.match(layoutsIndex, /illustratedBook:\s*IllustratedBookLayout/);
});

test("ReaderLayoutVariant union + array carry illustratedBook", () => {
  // Union member and the runtime array entry must both be present, or the
  // isLayoutVariant guard (which reads the array) would reject a stored value.
  assert.match(readerSettings, /\|\s*"illustratedBook"/);
  assert.match(readerSettings, /READER_LAYOUT_VARIANTS[^]*?"illustratedBook"[^]*?\]\s*as const/);
});

test("CinematicMode union + CINEMATIC_MODES carry illustrated_book (LOCKSTEP with server, RM6)", () => {
  // The snake_case strategy literal is EXACTLY "illustrated_book".
  assert.match(readerSettings, /\|\s*"illustrated_book"/);
  assert.match(readerSettings, /CINEMATIC_MODES[^]*?"illustrated_book"[^]*?\]\s*as const/);
});

// --- Layout consumes the IDENTICAL ReaderLayoutProps (R3.2) ----------------

test("IllustratedBook consumes the identical ReaderLayoutProps type", () => {
  assert.match(illustrated, /import\s*\{[^}]*type ReaderLayoutProps[^}]*\}\s*from\s*"\.\/types"/s);
  assert.match(illustrated, /\}:\s*ReaderLayoutProps\)/);
  // No bespoke prop type of its own — it must not fork the pipeline.
  assert.doesNotMatch(illustrated, /type\s+IllustratedBookProps/);
});

test("IllustratedBook destructures the same ReaderLayoutProps keys as GraphicNovel", () => {
  // The clone must accept the SAME contract so the dispatch never forks. Pull
  // the destructured identifiers from each component signature and compare.
  const keysOf = (src) => {
    const m = src.match(/Layout\(\{([^]*?)\}:\s*ReaderLayoutProps\)/);
    assert.ok(m, "component signature not found");
    return new Set(
      m[1]
        .split(",")
        .map((s) => s.trim().split(/[:=]/)[0].trim())
        .filter(Boolean),
    );
  };
  const gn = keysOf(graphicNovel);
  const ib = keysOf(illustrated);
  for (const k of gn) {
    assert.ok(ib.has(k), `IllustratedBook is missing the ReaderLayoutProps key "${k}"`);
  }
});

// --- Image-first re-weighting (R3.2): plate above prose above choices -------

test("IllustratedBook renders image-first: SceneMedia before prose before choices", () => {
  const plateAt = illustrated.indexOf("<SceneMedia");
  const proseAt = illustrated.indexOf("<ProseRenderer");
  const choiceAt = illustrated.indexOf("<ChoiceList");
  assert.ok(plateAt > 0 && proseAt > 0 && choiceAt > 0, "expected all three slots present");
  assert.ok(plateAt < proseAt, "illustration plate must sit above the prose");
  assert.ok(proseAt < choiceAt, "prose must sit above the choices (quiet footnotes)");
});

test("IllustratedBook keeps the shared endings/HUD/freeform/fallback wiring", () => {
  // Same pipeline seams as the sibling skins — the clone must not drop them.
  for (const seam of ["FallbackTurnPanel", "StatsHud", "EndingPanel", "endingPanelHandlers", "onFreeformSubmit"]) {
    assert.match(illustrated, new RegExp(seam), `missing shared seam: ${seam}`);
  }
});

// --- MediaPlate placeholder wiring (R3.4/R3.6) -----------------------------

test("MediaPlate reacts to the outOfCredits signal and renders a placeholder", () => {
  assert.match(mediaPlate, /outOfCredits/);
  assert.match(mediaPlate, /MediaPlatePlaceholder/);
  // The nudge copy + that prose is never blocked.
  assert.match(mediaPlate, /top up/i);
});

// --- Pure mirror of resolveMediaPlateView (lock-step) ----------------------

/**
 * MIRROR of MediaPlate.tsx `resolveMediaPlateView`. Keep in lock-step.
 */
function resolveMediaPlateViewMirror({ state, outOfCredits, hasPoster }) {
  if (state === "image" && hasPoster) return "image";
  if (outOfCredits) return "placeholder";
  if (state === "image") return "skeleton";
  return state;
}

test("out-of-credits degrades to placeholder, never a bare skeleton (R3.4)", () => {
  // Queued/generating still with no poster: legacy readers see a skeleton;
  // the guaranteed-still mode NEVER does.
  assert.equal(
    resolveMediaPlateViewMirror({ state: "skeleton", outOfCredits: true, hasPoster: false }),
    "placeholder",
  );
  // Even with no media queued at all (idle), the signal shows the placeholder.
  assert.equal(
    resolveMediaPlateViewMirror({ state: "idle", outOfCredits: true, hasPoster: false }),
    "placeholder",
  );
  // Image state that lost its poster still degrades to placeholder in-mode.
  assert.equal(
    resolveMediaPlateViewMirror({ state: "image", outOfCredits: true, hasPoster: false }),
    "placeholder",
  );
});

test("a ready still always wins, even under the out-of-credits signal", () => {
  assert.equal(
    resolveMediaPlateViewMirror({ state: "image", outOfCredits: true, hasPoster: true }),
    "image",
  );
});

test("without the signal, every plate view is byte-identical to legacy behavior", () => {
  // outOfCredits=false must reproduce the pre-feature mapping exactly, so
  // every non-illustrated reader is untouched (RM8 regression pin).
  assert.equal(resolveMediaPlateViewMirror({ state: "idle", outOfCredits: false, hasPoster: false }), "idle");
  assert.equal(resolveMediaPlateViewMirror({ state: "skeleton", outOfCredits: false, hasPoster: false }), "skeleton");
  assert.equal(resolveMediaPlateViewMirror({ state: "image", outOfCredits: false, hasPoster: true }), "image");
  assert.equal(resolveMediaPlateViewMirror({ state: "image", outOfCredits: false, hasPoster: false }), "skeleton");
});
