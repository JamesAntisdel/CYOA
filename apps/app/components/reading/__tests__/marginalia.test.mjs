// Open-book spread (R3 / OB5) — tests for the verso Marginalia rail. The PURE
// self-hide gates (`shouldRenderMarginalia`, `hasStatsSignal`) are transpiled &
// import-stripped and exercised for real over the per-note matrix; source-drift
// pins that the rail COMPOSES the existing signal components (no new queries /
// no re-derived predicates — RC2), returns null when every signal is absent,
// and reads the two-stage candle straight off the shared buildRibbonSegments
// model (never forked). Same discipline as footnoteChoices.test.mjs /
// storyRibbon.test.mjs.
//
// Run:
//   node --test apps/app/components/reading/__tests__/marginalia.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const modulePath = resolve(here, "../layouts/spread/Marginalia.tsx");
const source = readFileSync(modulePath, "utf8");

const require = createRequire(import.meta.url);
const ts = require("typescript");

const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX,
  },
});
// Strip the react / react-native / component imports: the pure gates need none
// of them (the JSX component below is never invoked here — only the exported
// predicates are).
const stripped = outputText.replace(/^\s*import[^\n]*\n?/gm, "");
const mod = await import("data:text/javascript," + encodeURIComponent(stripped));
const { shouldRenderMarginalia, hasStatsSignal } = mod;

const ZERO_STATS = { vitality: 0, nerve: 0, insight: 0 };
const LIVE_STATS = { vitality: 3, nerve: 0, insight: 0 };
const ARC = { dramaticQuestion: "Find the bell before dawn", act: 2, beatsFired: 1, beatsTotal: 4, threadsPending: 2 };
const CANDLE = { turnsUsed: 8, turnsAllowed: 10 };

// --- hasStatsSignal: the carried-signal predicate ----------------------------

test("hasStatsSignal is false for empty inventory + all-zero stats", () => {
  assert.equal(hasStatsSignal(ZERO_STATS, []), false);
  assert.equal(hasStatsSignal(ZERO_STATS, undefined), false);
  assert.equal(hasStatsSignal(ZERO_STATS, null), false);
});

test("hasStatsSignal is true when the reader carries an item OR a non-zero stat", () => {
  assert.equal(hasStatsSignal(ZERO_STATS, [{ id: "i1", label: "A rusted key" }]), true);
  assert.equal(hasStatsSignal(LIVE_STATS, []), true);
});

// --- shouldRenderMarginalia: each note self-hides; all-absent ⇒ null ---------

test("the rail renders when an arc is present (pursuit + threads)", () => {
  assert.equal(shouldRenderMarginalia({ arc: ARC, stats: ZERO_STATS, inventory: [] }), true);
});

test("the rail renders when the candle is lit (≥50%, stage 1)", () => {
  assert.equal(shouldRenderMarginalia({ candle: CANDLE, stats: ZERO_STATS, inventory: [] }), true);
});

test("the rail renders when the reader carries stats/inventory", () => {
  assert.equal(shouldRenderMarginalia({ stats: LIVE_STATS, inventory: [] }), true);
  assert.equal(
    shouldRenderMarginalia({ stats: ZERO_STATS, inventory: [{ id: "i1", label: "A rusted key" }] }),
    true,
  );
});

test("ALL signals absent ⇒ the rail returns null so the illustration takes the page (RC2)", () => {
  assert.equal(shouldRenderMarginalia({ stats: ZERO_STATS, inventory: [] }), false);
  // Doors + daily-pulse ride the arc gate (like the declutter ribbon): an
  // arc-less legacy save with no candle and no carried stats stays quiet.
  assert.equal(
    shouldRenderMarginalia({ arc: undefined, candle: undefined, stats: ZERO_STATS, inventory: [] }),
    false,
  );
});

// --- Source-drift: composes the EXISTING signal components (RC2) -------------

test("Marginalia composes the SAME components the declutter StoryRibbon reuses (OB5)", () => {
  for (const name of ["QuestLine", "ThreadsPill", "DoorsJournal", "DailyPulseChip", "StatsHud", "CandleBurnMeter"]) {
    assert.match(source, new RegExp(`<${name}[\\s/>]`), `must mount <${name}>`);
  }
});

test("no new queries / no re-derived predicates — it renders the existing components", () => {
  // The self-fetching surfaces are mounted, not re-implemented: no direct data
  // fetch lives in the margin (RC2 — the components own their queries).
  assert.doesNotMatch(source, /getRemoteDoorsJournal|getRemoteChoicePulse/, "must not fetch — the components do");
});

test("each note self-hides on its predicate (conditional mounts + component self-hide)", () => {
  // ThreadsPill / DailyPulseChip mount only when their driving prop exists; the
  // components themselves self-hide at their zero-state (threadsPending<=0, no
  // committed pulse, no teased doors). The rail-level gate handles all-absent.
  assert.match(source, /arc\s*\?\s*\(?\s*<ThreadsPill/, "threads mount gated on arc");
  assert.match(source, /dailyId\s*\?\s*\(?\s*<DailyPulseChip/, "daily pulse mount gated on dailyId");
  assert.match(source, /if\s*\(!shouldRenderMarginalia\(/, "the rail returns null via the pure gate");
});

// --- Source-drift: the two-stage candle is REUSED, not forked (R3.2) ---------

test("the candle two-stage note reads off the shared buildRibbonSegments model (not forked)", () => {
  assert.match(source, /import\s*\{[^}]*buildRibbonSegments[^}]*\}\s*from\s*"\.\.\/\.\.\/chrome\/ribbonSegments"/);
  // The ≥80% "candle burns low" note is the shared model's candle segment.
  assert.match(source, /buildRibbonSegments\(\{\s*candle\s*\}\)\.find\(/, "reads the shared candle segment");
  assert.match(source, /segment\.key === "candle"/);
  // Stage 1 (≥50%) is the shared CandleBurnMeter; no re-derived 0.8 threshold.
  assert.match(source, /<CandleBurnMeter/);
  assert.ok(!/0\.8|CANDLE_LOW_BURN\s*=/.test(source), "must not fork the two-stage threshold");
});

test("the ≥80% candle note keeps its patronage destination (R3.3)", () => {
  assert.match(source, /onPress=\{onOpenPatronage\}/, "the burns-low note opens the patronage door");
  assert.match(source, /candleNote\s*\?/, "the note only shows at the ≥80% second stage");
});

// --- a11y / RC5 --------------------------------------------------------------

test("the interactive candle note keeps a 44px target + button semantics", () => {
  assert.match(source, /minHeight:\s*44/);
  assert.match(source, /accessibilityRole="button"/);
});

test("no banned control emoji in Marginalia (RC5)", () => {
  // Story-art (●○▮▯♥) lives in the reused components (lib/storyEngagement), never
  // in this source. The margin's own text must be glyph-clean.
  for (const glyph of ["▶", "⏸", "⚙", "✦", "🚪", "🔒", "✓", "×", "🕯", "🔥", "🧵", "🗝"]) {
    assert.ok(!source.includes(glyph), `Marginalia must not contain the banned glyph ${glyph}`);
  }
});
