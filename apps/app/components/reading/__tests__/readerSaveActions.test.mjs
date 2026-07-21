// Drift guards for the save-scoped navigation the reader exposes and the
// header treatment of the two surfaces it links to (/map/[saveId] and
// /read/[saveId]/history).
//
// The user-facing symptom that motivated these entries: "I don't see the map
// at all." The /map and /history routes existed, but there was no UI entry to
// them — the only AppNav tabs are top-level (Library, Discover, Create,
// Account, Settings, Login).
//
// reader-chrome-declutter Wave 1 (task 1.3) RETIRED the five-pill
// ReaderSaveActions row: the Path map / Run history / Reading settings / Auto
// entries moved into the Tome menu (built by the pure `buildTomeRows`), and the
// AI-flag report action moved with them. This guard is RETARGETED (RC6 — never
// deleted) to pin those entries down at their new home: the Tome-row callbacks
// wired in ReaderScreen must still route to the same destinations, so the map
// and history entry points can't silently vanish in a future refactor. Tests
// 3-7 (the /map + /history page headers + shared back affordance) are
// unchanged — those surfaces did not move.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const readerScreenPath = resolve(here, "../ReaderScreen.tsx");
const mapRoutePath = resolve(here, "../../../app/map/[saveId]/index.tsx");
const historyRoutePath = resolve(
  here,
  "../../../app/read/[saveId]/history/index.tsx",
);

const readerScreenSource = readFileSync(readerScreenPath, "utf8");
const mapRouteSource = readFileSync(mapRoutePath, "utf8");
const historyRouteSource = readFileSync(historyRoutePath, "utf8");

test("ReaderScreen builds the Tome menu rows via the pure buildTomeRows", () => {
  // The five-pill ReaderSaveActions row is GONE; the entries are Tome rows.
  assert.doesNotMatch(
    readerScreenSource,
    /<ReaderSaveActions/,
    "the retired ReaderSaveActions pill row must no longer render",
  );
  assert.match(
    readerScreenSource,
    /buildTomeRows\(\{/,
    "ReaderScreen must build the Tome rows via buildTomeRows",
  );
  assert.match(
    readerScreenSource,
    /<TomeSheet\b/,
    "ReaderScreen must mount the TomeSheet holding those rows",
  );
});

test("the Tome's Path map row routes to /map/[saveId]", () => {
  assert.match(
    readerScreenSource,
    /onPathMap:\s*\(\)\s*=>\s*router\.push\(`\/map\/\$\{saveId\}`\)/,
    "the Tome Path map row must navigate to /map/[saveId]",
  );
});

test("the Tome's Run history row routes to /read/[saveId]/history", () => {
  assert.match(
    readerScreenSource,
    /onRunHistory:\s*\(\)\s*=>\s*router\.push\(`\/read\/\$\{saveId\}\/history`\)/,
    "the Tome Run history row must navigate to /read/[saveId]/history",
  );
});

test("the Tome's Reading settings row opens the existing drawer", () => {
  // Platform-guarded handoff (code-review fix): web opens immediately; native
  // defers past the Tome Modal's dismiss so iOS doesn't drop the incoming
  // modal. The guard asserts the row still routes to setDrawerOpen(true).
  assert.match(
    readerScreenSource,
    /onReadingSettings:[\s\S]{0,220}?setDrawerOpen\(true\)/,
    "the Reading settings row must open the ReaderSettingsDrawer",
  );
  assert.match(
    readerScreenSource,
    /<ReaderSettingsDrawer\b/,
    "ReaderScreen must still mount the ReaderSettingsDrawer",
  );
});

test("the Tome's Flag row reuses the moderation ReportButton action (U3/R2.5)", () => {
  // The disclosure stays a visible footer caption; only the flag ACTION moved
  // into the sheet, driving the controlled (trigger-hidden) ReportButton.
  assert.match(
    readerScreenSource,
    /onFlagScene:[\s\S]{0,220}?setFlagOpen\(true\)/,
    "the Flag row must open the report picker",
  );
  assert.match(
    readerScreenSource,
    /<ReportButton[\s\S]*?hideTrigger[\s\S]*?targetType="scene"/,
    "the flag action must be the moderation ReportButton with its trigger hidden",
  );
  assert.match(
    readerScreenSource,
    /AI-generated tale/,
    "the persistent AI-disclosure footer caption must still render (R2.5)",
  );
});

test("/map page renders Path map kicker BEFORE the ViewToggle", () => {
  // Theme migration moved the literal "Path map" text from an inline
  // `>Path map<` JSX child into a multi-line themed `<Text>` block —
  // so we look for the kicker label as a multiline-friendly substring
  // rather than a strict `>...<` adjacency.
  const kickerIdx = mapRouteSource.search(/Path map\s*<\/Text>/);
  const toggleIdx = mapRouteSource.indexOf("<ViewToggle");
  assert.ok(kickerIdx > 0, "Path map kicker must render in /map page");
  assert.ok(toggleIdx > 0, "ViewToggle must render in /map page");
  assert.ok(
    kickerIdx < toggleIdx,
    "Path map kicker must come BEFORE ViewToggle",
  );
});

test("/map ViewToggle renders BEFORE EndingsMap and Storyboard", () => {
  const toggleIdx = mapRouteSource.indexOf("<ViewToggle");
  const endingsMapIdx = mapRouteSource.indexOf("<EndingsMap");
  const storyboardIdx = mapRouteSource.indexOf("<Storyboard turns");
  assert.ok(
    toggleIdx > 0 && endingsMapIdx > 0 && storyboardIdx > 0,
    "All three components must render in /map page",
  );
  assert.ok(
    toggleIdx < endingsMapIdx,
    "ViewToggle must come BEFORE EndingsMap so the toggle is obviously visible above image cards",
  );
  assert.ok(
    toggleIdx < storyboardIdx,
    "ViewToggle must come BEFORE Storyboard so the toggle is obviously visible above image cards",
  );
});

test("/map page uses the shared BackToSceneButton with the right fallback", () => {
  // The pressable + accessibilityLabel now live inside
  // `components/navigation/BackToSceneButton.tsx` so all save-scoped
  // surfaces share one definition. The drift guard for the /map page
  // is that the route imports the shared component AND passes
  // `/read/${saveId}` as the deep-link fallback href.
  assert.match(
    mapRouteSource,
    /BackToSceneButton/,
    "/map page must render the shared <BackToSceneButton> primitive",
  );
  assert.match(
    mapRouteSource,
    /fallbackHref=\{`\/read\/\$\{saveId\}`\}/,
    "/map page back affordance must fall back to /read/[saveId]",
  );
});

test("/history page uses the shared BackToSceneButton with the right fallback", () => {
  assert.match(
    historyRouteSource,
    /BackToSceneButton/,
    "/history page must render the shared <BackToSceneButton> primitive",
  );
  assert.match(
    historyRouteSource,
    /fallbackHref=\{`\/read\/\$\{saveId\}`\}/,
    "/history page back affordance must fall back to /read/[saveId]",
  );
});
