// Drift guards for AppNav and the shared BackToSceneButton.
//
// The user reported: "top-nav buttons shift around between routes — positions
// and sizes change page-to-page." The fixes that need to STAY landed:
//
//   1. The nav tab list and order are stable, independent of `current` —
//      the only thing that changes per route is which tab is marked
//      `accessibilityState.selected`.
//   2. Active state changes color only, not padding or border width — so
//      no reflow happens when the active tab switches.
//   3. Every tab pill claims a minimum width so labels of different
//      lengths don't make the row crawl left and right between routes.
//   4. The shared BackToSceneButton is the SINGLE source of truth for
//      the back-pill across save-scoped + paywall surfaces — keeps them
//      from drifting.
//
// These tests read source files directly (no React renderer in node:test)
// so they pin the structural commitments without booting the bundler.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appNavPath = resolve(here, "../AppNav.tsx");
const backButtonPath = resolve(here, "../BackToSceneButton.tsx");

const appNavSource = readFileSync(appNavPath, "utf8");
const backButtonSource = readFileSync(backButtonPath, "utf8");

test("AppNav declares the canonical tab list in stable order", () => {
  // The order below is the order users read across the top of the app.
  // Reordering is a UX-visible change that should require an explicit
  // test update — otherwise route-by-route mental maps break.
  const expectedOrder = [
    "library",
    "discover",
    "creator",
    "account",
    "settings",
  ];
  const navItemsBlock = appNavSource.match(
    /NAV_ITEMS[\s\S]*?\]\s*as const;/,
  );
  assert.ok(navItemsBlock, "AppNav must declare a NAV_ITEMS array");
  const block = navItemsBlock[0];
  let cursor = 0;
  for (const key of expectedOrder) {
    const idx = block.indexOf(`key: "${key}"`, cursor);
    assert.ok(
      idx > cursor || (cursor === 0 && idx >= 0),
      `NAV_ITEMS must include "${key}" after the previous tabs (got cursor ${cursor}, idx ${idx})`,
    );
    cursor = idx + 1;
  }
});

test("AppNav active state changes only fill/border color, not padding or border width", () => {
  // The tab pill style block MUST NOT switch padding or border-width
  // on the `active` flag. If a future refactor wants to add emphasis,
  // do it with opacity or a shadow — never with paddings that reflow
  // the row. We assert on the file as a whole because the style
  // function spans multiple lines and matching it as a fenced block
  // is fragile.
  assert.doesNotMatch(
    appNavSource,
    /paddingHorizontal:\s*active\s*\?/,
    "padding must NOT switch on active state",
  );
  assert.doesNotMatch(
    appNavSource,
    /paddingVertical:\s*active\s*\?/,
    "padding must NOT switch on active state",
  );
  assert.doesNotMatch(
    appNavSource,
    /borderWidth:\s*active\s*\?/,
    "borderWidth must NOT switch on active state",
  );
  // Active state SHOULD switch backgroundColor and borderColor —
  // sanity-check the positive signal so a future "remove all active
  // styling" regression also trips this guard.
  assert.match(
    appNavSource,
    /backgroundColor:\s*active\s*\?/,
    "backgroundColor SHOULD switch on active state",
  );
  assert.match(
    appNavSource,
    /borderColor:\s*active\s*\?/,
    "borderColor SHOULD switch on active state",
  );
});

test("AppNav tab pills enforce a minimum width so labels can't shift the row", () => {
  // The bug the user reported was the row visibly shifting between
  // routes because "Settings" (8 chars) is wider than "Create" (6).
  // A stable minWidth means all pills share a visual cell.
  assert.match(
    appNavSource,
    /minWidth:\s*TAB_MIN_WIDTH/,
    "tab pill style must apply the shared TAB_MIN_WIDTH so all labels share a cell",
  );
  const minMatch = appNavSource.match(/TAB_MIN_WIDTH\s*=\s*(\d+)/);
  assert.ok(minMatch, "AppNav must define a TAB_MIN_WIDTH constant");
  const minWidth = Number(minMatch[1]);
  assert.ok(
    minWidth >= 80,
    `TAB_MIN_WIDTH (${minWidth}) must be at least 80 to fit the longest label ("Settings")`,
  );
});

test("AppNav tab row no longer relies on flexWrap to handle overflow", () => {
  // Drift guard paired with `appNavResponsive.test.mjs`: the previous
  // implementation gave the tab-row container `flexWrap: "wrap"`,
  // which on narrow viewports either (a) wrapped tabs onto a new
  // line below the brand mark (ugly) or (b) clipped them off-screen
  // when the parent constrained overflow (the user-reported bug).
  // The new implementation uses a horizontal ScrollView for the tab
  // row — flexWrap should NOT appear inside the tab-row sub-tree.
  //
  // We narrow the search to the slice of the file after the outer
  // brand-mark + tabs wrapper, since the outermost row container is
  // still allowed to wrap (so the brand can wrap above the tabs on
  // truly tiny viewports). The check is on the inner tabs wrapper,
  // which is the one that previously clipped.
  const scrollViewIdx = appNavSource.indexOf("<ScrollView");
  assert.ok(
    scrollViewIdx > 0,
    "AppNav must render a <ScrollView> for the tab row (see appNavResponsive.test.mjs)",
  );
  const closingIdx = appNavSource.indexOf("</ScrollView>");
  const tabRowSlice = appNavSource.slice(scrollViewIdx, closingIdx);
  assert.doesNotMatch(
    tabRowSlice,
    /flexWrap:\s*"wrap"/,
    "the tab row inside the horizontal ScrollView must NOT set flexWrap — overflow is handled by horizontal scroll",
  );
});

test("AppNav `current` accepts only valid tab keys (no orphan 'home')", () => {
  // Earlier versions defaulted `current` to "home", but AppNav has no
  // "home" tab — so the landing route silently rendered with NO tab
  // highlighted while every other route highlighted one, creating a
  // ghost reflow. Drop "home" from the type so callers can't pass it.
  const typeBlock = appNavSource.match(
    /export type AppNavTab[\s\S]*?;/,
  );
  assert.ok(typeBlock, "AppNav must export an AppNavTab union type");
  assert.doesNotMatch(
    typeBlock[0],
    /"home"/,
    "AppNavTab union must NOT include 'home' — no such tab exists",
  );
});

test("BackToSceneButton owns the back-pill label and accessibilityLabel", () => {
  // Single source of truth for the "← Back to current scene" wording
  // and pill treatment. Routes import this primitive — they don't
  // copy-paste the styling. The defaults below are checked so a
  // route that omits the props still gets parity.
  assert.match(
    backButtonSource,
    /label\s*=\s*"← Back to current scene"/,
    "BackToSceneButton must default to '← Back to current scene'",
  );
  assert.match(
    backButtonSource,
    /accessibilityLabel\s*=\s*"Back to current scene"/,
    "BackToSceneButton must default accessibilityLabel to 'Back to current scene'",
  );
});

test("BackToSceneButton uses canGoBack-with-fallback router pattern", () => {
  // Deep-link entry (e.g. opening /map/abc directly) means
  // router.canGoBack() is false. The primitive MUST handle that or
  // the back button is a dead end. This pattern is canonical across
  // every save-scoped surface.
  assert.match(
    backButtonSource,
    /router\.canGoBack\(\)/,
    "BackToSceneButton must guard with router.canGoBack()",
  );
  assert.match(
    backButtonSource,
    /router\.push\(fallbackHref\)/,
    "BackToSceneButton must push fallbackHref when canGoBack() is false",
  );
});
