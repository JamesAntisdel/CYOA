// Drift guards for the save-scoped chrome row in ReaderScreen and the
// header treatment of the two surfaces it links to (/map/[saveId] and
// /read/[saveId]/history).
//
// The user-facing symptom that motivated this row: "I don't see the map
// at all." The /map and /history routes existed, but there was no UI
// entry to them — the only AppNav tabs are top-level (Library, Discover,
// Create, Account, Settings, Login). These tests pin down:
//
//   1. ReaderScreen renders both buttons with the expected
//      accessibilityLabel ("Path map" and "Run history") so the reader
//      can find them.
//   2. The button routes are `/map/${saveId}` and
//      `/read/${saveId}/history` — typos here would silently break the
//      entry point.
//   3. The /map page renders its "Path map" kicker BEFORE the
//      ViewToggle, which itself renders BEFORE the EndingsMap or
//      Storyboard — so the toggle is obviously visible above any image
//      cards. The kicker also has to come before any storyboard <Image>
//      so the page header doesn't drift off the top of a small screen.
//   4. Both the /map and /history pages carry the same "Back to current
//      scene" affordance so the two surfaces feel like siblings.

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

test("ReaderScreen exposes a Path map entry button", () => {
  assert.match(
    readerScreenSource,
    /accessibilityLabel="Path map"/,
    "ReaderScreen must render a Pressable with accessibilityLabel='Path map'",
  );
  assert.match(
    readerScreenSource,
    /router\.push\(`\/map\/\$\{saveId\}`\)/,
    "Path map button must navigate to /map/[saveId]",
  );
});

test("ReaderScreen exposes a Run history entry button", () => {
  assert.match(
    readerScreenSource,
    /accessibilityLabel="Run history"/,
    "ReaderScreen must render a Pressable with accessibilityLabel='Run history'",
  );
  assert.match(
    readerScreenSource,
    /router\.push\(`\/read\/\$\{saveId\}\/history`\)/,
    "Run history button must navigate to /read/[saveId]/history",
  );
});

test("ReaderScreen save action row sits below AppNav and above the layout", () => {
  // We don't render the tree here, but we can locate the three anchors
  // in source order. AppNav, then ReaderSaveActions, then the Layout.
  const navIdx = readerScreenSource.indexOf("<AppNav />");
  const actionsIdx = readerScreenSource.indexOf("<ReaderSaveActions");
  const layoutIdx = readerScreenSource.indexOf("<Layout");
  assert.ok(navIdx > 0, "AppNav must render in ReaderScreen");
  assert.ok(
    actionsIdx > navIdx,
    "ReaderSaveActions must come AFTER AppNav",
  );
  assert.ok(
    layoutIdx > actionsIdx,
    "Layout must come AFTER ReaderSaveActions",
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
