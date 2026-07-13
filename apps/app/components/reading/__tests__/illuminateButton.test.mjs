// Reader-side coverage for the "Illuminate this page" candle
// (components/reading/IlluminateButton.tsx + lib/illuminateApi.ts). Pure-Node,
// matching the rest of components/reading/__tests__: source-level drift guards
// on the component, plus a mirror of illuminateApi's pure view-logic exercised
// across every candle state. The mirror is kept in lock-step with
// `lib/illuminateApi.ts` — change one, change the other.

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

// --- Pure mirror of lib/illuminateApi.ts's view-logic ----------------------

function illuminateCandleMode(state, kind) {
  if (!state || !state.sceneId || !state.resolved) return "hidden";
  const slot = kind === "cinematic" ? state.cinematic : state.still;
  if (!slot.present) return "idle";
  if (slot.status === "ready") return "illuminated";
  if (slot.status === "generating") return "generating";
  if (slot.status === "blocked" || slot.status === "failed") return "idle";
  return "queued";
}
function candleIsTappable(mode) {
  return mode === "idle";
}
function canAffordIllumination(state, kind) {
  if (!state) return false;
  const cost = kind === "cinematic" ? state.costs.cinematic : state.costs.still;
  return state.balance >= cost;
}
function candleGlyph(mode) {
  return mode === "idle" ? "🕯" : "🔥";
}
function alightCopy(cost) {
  return `Set this page alight — ${cost} ${cost === 1 ? "spark" : "sparks"}`;
}

const baseState = (over = {}) => ({
  sceneId: "scene_1",
  resolved: true,
  balance: 100,
  costs: { still: 15, cinematic: 240 },
  still: { present: false },
  cinematic: { present: false },
  ...over,
});

test("candle mode: hidden when there is no resolved page to light", () => {
  assert.equal(illuminateCandleMode(null, "still"), "hidden");
  assert.equal(illuminateCandleMode(baseState({ resolved: false }), "still"), "hidden");
  assert.equal(illuminateCandleMode(baseState({ sceneId: null }), "still"), "hidden");
});

test("candle mode: idle → queued → generating → illuminated across asset states", () => {
  assert.equal(illuminateCandleMode(baseState(), "still"), "idle");
  assert.equal(
    illuminateCandleMode(baseState({ still: { present: true, status: "queued" } }), "still"),
    "queued",
  );
  assert.equal(
    illuminateCandleMode(baseState({ still: { present: true, status: "generating" } }), "still"),
    "generating",
  );
  assert.equal(
    illuminateCandleMode(baseState({ still: { present: true, status: "ready" } }), "still"),
    "illuminated",
  );
  // A failed/blocked asset falls back to idle so the reader can re-light it.
  assert.equal(
    illuminateCandleMode(baseState({ still: { present: true, status: "failed" } }), "still"),
    "idle",
  );
});

test("candle mode tracks the requested kind independently (still vs cinematic)", () => {
  const s = baseState({ still: { present: true, status: "ready" } });
  assert.equal(illuminateCandleMode(s, "still"), "illuminated");
  assert.equal(illuminateCandleMode(s, "cinematic"), "idle");
});

test("only an idle candle is tappable (illuminated/kindling states no-op)", () => {
  assert.equal(candleIsTappable("idle"), true);
  assert.equal(candleIsTappable("illuminated"), false);
  assert.equal(candleIsTappable("queued"), false);
  assert.equal(candleIsTappable("generating"), false);
  assert.equal(candleIsTappable("hidden"), false);
});

test("affordability gates the confirm against the reader's balance", () => {
  assert.equal(canAffordIllumination(baseState({ balance: 15 }), "still"), true);
  assert.equal(canAffordIllumination(baseState({ balance: 14 }), "still"), false);
  assert.equal(canAffordIllumination(baseState({ balance: 100 }), "cinematic"), false);
  assert.equal(canAffordIllumination(baseState({ balance: 240 }), "cinematic"), true);
});

test("copy: unlit candle glyph, lit flame; alight line pluralizes sparks", () => {
  assert.equal(candleGlyph("idle"), "🕯");
  assert.equal(candleGlyph("illuminated"), "🔥");
  assert.equal(candleGlyph("generating"), "🔥");
  assert.equal(alightCopy(15), "Set this page alight — 15 sparks");
  assert.equal(alightCopy(1), "Set this page alight — 1 spark");
});

// --- Drift guards on the source ---------------------------------------------

test("illuminateApi exposes the mutation/query transports + pure helpers", () => {
  const api = read("lib/illuminateApi.ts");
  assert.match(api, /media\/illuminate:requestIllumination/, "requests the public mutation");
  assert.match(api, /media\/illuminate:getSparkBalance/, "reads the spark balance query");
  assert.match(
    api,
    /media\/illuminate:getReaderIlluminationState/,
    "reads the one-round-trip button state query",
  );
  assert.match(api, /export function illuminateCandleMode/, "exports the candle-mode helper");
});

test("IlluminateButton self-hides, honors reduced motion, and never gates reading", () => {
  const src = read("components/reading/IlluminateButton.tsx");
  // Self-hide on any un-illuminable page / missing session.
  assert.match(
    src,
    /if \(!accountId \|\| mode === "hidden"\) return null;/,
    "candle renders nothing when there is no session or nothing to light",
  );
  // Cosmetic-only: it confirms into requestRemoteIllumination, never a story call.
  assert.match(src, /requestRemoteIllumination/, "confirm calls the illumination mutation");
  // Reduced-motion respected on the sheet animation.
  assert.match(
    src,
    /animationType=\{reducedMotion \? "none" : "fade"\}/,
    "sheet honors prefers-reduced-motion",
  );
  // The always-free preview shows the existing still.
  assert.match(src, /previewUrl/, "sheet shows the scene's existing still as the free preview");
});

test("every reading layout mounts the candle behind the saveId+auth guard", () => {
  for (const layout of ["Book", "Mobile", "ModernApp", "GraphicNovel", "Journal"]) {
    const src = read(`components/reading/layouts/${layout}.tsx`);
    assert.match(
      src,
      /saveId && illuminateAuth \? \(\s*<IlluminateButton/,
      `${layout} mounts <IlluminateButton> only when saveId + auth are present`,
    );
  }
});
