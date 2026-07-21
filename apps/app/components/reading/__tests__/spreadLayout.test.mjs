// Open-book Wave 2 (Agent OB-SPREAD) — the two-page Spread layout + its
// registration + the ReaderScreen `spread`-wins dispatch (open-book R2/R6/R7,
// OB1/OB4/OB7/OB8).
//
// Spread.tsx imports React Native, so — like footnoteChoices/marginalia/dropCap
// — this file reads the SOURCE and pins the load-bearing wiring with
// source-drift assertions (the component itself is never rendered here; a
// headless RN render is out of scope for node --test). The PURE selection
// matrix that decides WHEN spread is chosen lives in spreadSelect.test.mjs.
//
// Run:
//   node --test apps/app/components/reading/__tests__/spreadLayout.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../../..");
const read = (rel) => readFileSync(resolve(appRoot, rel), "utf8");

const spread = read("components/reading/layouts/Spread.tsx");
const indexSrc = read("components/reading/layouts/index.ts");
const readerScreen = read("components/reading/ReaderScreen.tsx");
const propsTypes = read("components/reading/layouts/types.ts");

// ── OB1 — a DROP-IN over the UNCHANGED ReaderLayoutProps (no pipeline fork) ────

test("Spread consumes ReaderLayoutProps and adds NO fields to it (no-fork pin)", () => {
  // The layout signature is the shared props type — not a bespoke widened shape.
  assert.match(
    spread,
    /export function SpreadLayout\(props:\s*ReaderLayoutProps\)/,
    "SpreadLayout must consume the shared ReaderLayoutProps directly",
  );
  assert.match(
    spread,
    /import\s*\{[\s\S]*?type ReaderLayoutProps[\s\S]*?\}\s*from\s*"\.\/types"/,
    "ReaderLayoutProps must be imported from ./types (the SHARED shape)",
  );
  // types.ts is the pipeline contract — Spread must not have caused a field add.
  // (The full byte-identical pin lives in the merge gate; here we assert the
  // Spread source never references a field outside the known props surface by
  // never importing useTurn/engine/convex as VALUES.)
  assert.doesNotMatch(
    spread,
    /^import\s+\{[^}]*\}\s+from\s+["'][^"']*hooks\/useTurn/m,
    "Spread must not take a runtime dependency on useTurn (type-only import is fine)",
  );
  assert.doesNotMatch(spread, /submitChoice\(/, "Spread must not call submitChoice — onChoose is the only path");
  assert.doesNotMatch(spread, /from\s+["']convex/, "Spread must not touch convex (client-only, OB1)");
  assert.doesNotMatch(spread, /useQuery|useMutation/, "Spread must not open its own queries/mutations (OB1/RC2)");
});

test("the ChoiceProjection type is borrowed type-only (no useTurn value import)", () => {
  assert.match(
    spread,
    /import type \{\s*ChoiceProjection\s*\}\s*from\s*"\.\.\/\.\.\/\.\.\/hooks\/useTurn"/,
    "only the choice MODEL type is borrowed from useTurn",
  );
});

// ── R2.2 / OB4 — capped ≤ SPREAD_MAX, centered; chrome width NOT touched ──────

test("the whole spread is capped at SPREAD_MAX and centered (R2.2)", () => {
  assert.match(spread, /import\s*\{[^}]*SPREAD_MAX[^}]*\}\s*from\s*"\.\.\/\.\.\/\.\.\/lib\/responsive"/);
  assert.match(spread, /maxWidth:\s*SPREAD_MAX/, "the desk ground caps at SPREAD_MAX");
  assert.match(spread, /alignSelf:\s*"center"/, "the spread is centered on the desk");
});

// ── R2.1 — two facing pages: verso plate + margin | spine | recto prose + fn ──

test("verso mounts the SceneMedia illustration plate above the Marginalia rail", () => {
  assert.match(spread, /<SceneMedia[\s/>]/, "verso renders the scene illustration plate");
  assert.match(spread, /<Marginalia[\s/>]/, "verso renders the marginalia rail beneath the plate");
  // Marginalia is derived ENTIRELY from the projection (no new props — OB1).
  assert.match(spread, /stats=\{projection\.stats\}/);
  assert.match(spread, /inventory=\{projection\.inventory\}/);
  assert.match(spread, /saveId=\{saveId \?\? projection\.saveId\}/, "saveId falls back to the projection's");
});

test("recto renders drop-cap prose above the footnote choices (R4/R5)", () => {
  assert.match(spread, /<ProseRenderer[\s\S]*?dropCap[\s\S]*?\/>/, "the recto prose uses the dropCap treatment");
  assert.match(spread, /<FootnoteChoices[\s/>]/, "the recto renders numbered footnote choices");
  // The footnotes submit through the WRAPPED handler (page-turn after submit).
  assert.match(spread, /onChoose=\{handleChoose\}/, "footnotes commit via the page-turn-wrapping handler");
  // Novel-on-spread collapse is delegated to FootnoteChoices via readingMode.
  assert.match(spread, /readingMode=\{projection\.readingMode \?\? null\}/, "Novel collapse is threaded to FootnoteChoices (OB8)");
});

// ── R6.3 — the page-turn is DECORATIVE and never gates the submit ─────────────

test("a committed choice submits FIRST, then animates the page-turn (R6.3)", () => {
  assert.match(spread, /import\s*\{\s*usePageTurnDriver\s*\}\s*from\s*"\.\/spread\/pageTurnAnim"/);
  // handleChoose calls onChoose BEFORE pageTurn.animate — submit is never gated.
  assert.match(
    spread,
    /onChoose\(choice\);\s*[\r\n]+\s*pageTurn\.animate\(\);/,
    "onChoose must be called before pageTurn.animate() (decorative, never blocks — R6.3)",
  );
  // The driver style binds to the turning recto Animated.View.
  assert.match(spread, /<Animated\.View style=\{\[\{ flex: 1 \}, pageTurn\.style/, "the recto is the turning leaf, bound to the driver style");
});

// ── R1.4 / R2.2 — single-page fallback below SPREAD_MIN (no clipped columns) ──

test("below SPREAD_MIN the spread falls back to a single Book-like page (R1.4)", () => {
  assert.match(spread, /import\s*\{[^}]*SPREAD_MIN[^}]*\}\s*from\s*"\.\.\/\.\.\/\.\.\/lib\/responsive"/);
  assert.match(spread, /if \(width < SPREAD_MIN\)/, "the fallback gates on width < SPREAD_MIN");
  // A Novel save narrows to the linear Novel page; everything else to Book.
  assert.match(spread, /projection\.readingMode === "novel"[\s\S]*?<NovelLayout \{\.\.\.props\} \/>/, "Novel save → the Novel single page");
  assert.match(spread, /<BookLayout \{\.\.\.props\} \/>/, "otherwise a single Book-like page");
});

// ── OB7 — terminal renders the EXISTING EndingPanel (unforked) ────────────────

test("a terminal projection renders the EXISTING EndingPanel, centered (OB7)", () => {
  assert.match(spread, /projection\.ending \?/, "terminal branch keys on projection.ending");
  assert.match(spread, /<EndingPanel[\s/>]/, "the existing EndingPanel renders");
  // The ending prop bags reuse the shared builders — the ending logic is NOT forked.
  assert.match(spread, /endingPanelHandlers\(\{/, "reuses the shared endingPanelHandlers builder");
  assert.match(spread, /endingVariantProps\(\{/, "reuses the shared endingVariantProps builder");
  assert.match(spread, /whatMightHaveBeenProps\(\{/, "reuses the shared whatMightHaveBeenProps builder");
  assert.match(spread, /<ConsequenceReel[\s/>]/, "the ConsequenceReel recap is preserved");
});

// ── R2.4 — the verso degrades gracefully with no illustration ─────────────────

test("Marginalia self-hiding is what lets the verso degrade gracefully (R2.4)", () => {
  // Spread does NOT re-implement the empty-rail predicate — it mounts Marginalia,
  // which self-hides (shouldRenderMarginalia) so the plate takes the page.
  assert.doesNotMatch(spread, /shouldRenderMarginalia/, "Spread must not re-derive the rail gate — Marginalia owns it (RC2)");
});

// ── Registration: READER_LAYOUTS.spread = SpreadLayout ────────────────────────

test("the registry maps `spread` to the real SpreadLayout (Wave 2 swaps the placeholder)", () => {
  assert.match(indexSrc, /import\s*\{\s*SpreadLayout\s*\}\s*from\s*"\.\/Spread"/, "index imports the real SpreadLayout");
  assert.match(indexSrc, /spread:\s*SpreadLayout/, "READER_LAYOUTS.spread = SpreadLayout");
  assert.doesNotMatch(indexSrc, /spread:\s*BookLayout/, "the Wave 1 BookLayout placeholder is gone");
});

// ── OB8 / design §2 — `spread` WINS the ReaderScreen dispatch ─────────────────

test("ReaderScreen dispatch: `spread` wins, checked BEFORE the Novel override", () => {
  // The spread branch must precede the readingMode === "novel" branch so a Novel
  // save at spread renders INSIDE Spread (its footnotes collapse) — design §2.
  assert.match(
    readerScreen,
    /activeLayout === "spread"\s*\?\s*READER_LAYOUTS\.spread\s*:\s*projection\.readingMode === "novel"\s*\?\s*NovelLayout/,
    "the dispatch must branch on activeLayout === 'spread' BEFORE the Novel override (OB8)",
  );
  // The '?? READER_LAYOUTS.book' guard survives for the non-spread branch (OB3).
  assert.match(
    readerScreen,
    /READER_LAYOUTS\[activeLayout\]\s*\?\?\s*READER_LAYOUTS\.book/,
    "dispatch retains the '?? READER_LAYOUTS.book' fallback guard",
  );
});

// ── OB4 / OB5 — chrome stays; StoryRibbon is suppressed at spread (RC2) ────────

test("the StoryRibbon is suppressed at spread so Marginalia is the single signal mount (OB5/RC2)", () => {
  assert.match(
    readerScreen,
    /activeLayout === "spread" \? null : \(\s*[\r\n]+\s*<StoryRibbon/,
    "StoryRibbon must not double-mount the self-fetching signals at spread (Marginalia owns them)",
  );
  // The chrome top bar is NOT gated on spread — it stays as the chrome (OB4).
  assert.match(readerScreen, /<ReaderTopBar/, "the ReaderTopBar chrome stays above the layout at every width (OB4)");
});

// ── RC5 — no banned control emoji in the Spread source ────────────────────────

test("no banned control emoji in Spread (RC5)", () => {
  for (const glyph of ["▶", "⏸", "⚙", "✦", "🚪", "🔒", "✓", "×", "🕯", "🔥", "🧵", "🗝"]) {
    assert.ok(!spread.includes(glyph), `Spread must not contain the banned glyph ${glyph}`);
  }
});

// ── A sanity pin that ReaderLayoutProps did not silently grow a spread field ──

test("ReaderLayoutProps carries no spread-specific field (OB1 — the pipeline never forks)", () => {
  assert.doesNotMatch(propsTypes, /spread|dropCap|footnote|pageTurn/i, "no spread-specific field leaked into the shared props contract");
});
