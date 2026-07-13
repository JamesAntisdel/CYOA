// Drift guard for the mobile-responsive treatment of AppNav.
//
// User reported twice in this session:
//   1. "buttons at the top are not mobile or responsive looking, I cannot
//      see half of them on a mobile viewport."
//   2. (after the horizontal-scroll first pass) "it looks like the
//      buttons still need to scroll right/left. can we convert to a
//      mobile friendly hamburger menu or something?"
//
// Pattern shipped:
//   - Phone (< 520 px, per `lib/responsive.ts:BREAKPOINTS.phone`):
//     brand glyph + hamburger icon. Tapping the hamburger opens a
//     full-screen Modal drawer that lists every tab as a row with a
//     44 px touch target.
//   - Tablet / desktop (≥ 520 px): the original fixed-cell tab row
//     wrapped in a horizontal ScrollView. The auto-scroll-to-active
//     useEffect still runs on this branch.
//
// In both modes the active state changes ONLY fill + text color —
// padding and border width are identical — so the row can never reflow
// on selection. The pill min-width stays at 96, the min-height at 44.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appNavPath = resolve(here, "../AppNav.tsx");
const appNavSource = readFileSync(appNavPath, "utf8");

test("AppNav consults useBreakpoint to branch phone vs tablet/desktop", () => {
  // The hamburger / scroll-row split is driven by the shared helper at
  // `apps/app/lib/responsive.ts`. If a future refactor inlines a
  // `Dimensions.get('window').width` check it should still land at the
  // same 520 px boundary — but the canonical hook keeps every
  // responsive surface aligned.
  assert.match(
    appNavSource,
    /import\s*\{[^}]*\buseBreakpoint\b[^}]*\}\s*from\s*"\.\.\/\.\.\/lib\/responsive"/,
    "AppNav must import useBreakpoint from lib/responsive",
  );
  assert.match(
    appNavSource,
    /const\s*\{\s*isPhone\s*[,}]/,
    "AppNav must destructure isPhone from useBreakpoint()",
  );
});

test("AppNav renders a Modal drawer for the phone branch", () => {
  // The mobile-friendly menu is a full-screen Modal so it can't be
  // confused with the page chrome underneath. The drawer must be
  // gated on the `drawerOpen` state — drift here would either pin the
  // menu open forever or kill the open path entirely.
  assert.match(
    appNavSource,
    /import\s*\{[^}]*\bModal\b[^}]*\}\s*from\s*"react-native"/,
    "AppNav must import Modal from react-native",
  );
  assert.match(
    appNavSource,
    /<Modal[\s\S]*?visible=\{drawerOpen\}/,
    "AppNav must render a Modal whose visibility is bound to drawerOpen state",
  );
  assert.match(
    appNavSource,
    /onRequestClose=\{\(\)\s*=>\s*setDrawerOpen\(false\)\}/,
    "Modal must wire onRequestClose so Android back / web ESC closes the drawer",
  );
});

test("AppNav exposes a hamburger trigger on the phone branch", () => {
  // The phone branch must include a Pressable whose accessibilityLabel
  // identifies it as the menu opener — both for screen-reader users
  // and as the load-bearing assertion that we didn't ship the
  // horizontal-scroll regression by accident.
  assert.match(
    appNavSource,
    /accessibilityLabel="Open navigation menu"/,
    "phone branch must label the hamburger trigger as 'Open navigation menu'",
  );
  // The hamburger Pressable must call setDrawerOpen(true) on press.
  // Combined with the visible-binding assertion above this proves the
  // open path is wired end-to-end.
  assert.match(
    appNavSource,
    /onPress=\{\(\)\s*=>\s*setDrawerOpen\(true\)\}/,
    "hamburger Pressable must open the drawer via setDrawerOpen(true)",
  );
});

test("AppNav keeps a horizontal ScrollView for the tablet/desktop branch", () => {
  // The tablet/desktop row is unchanged from the previous responsive
  // pass — fixed-cell pills inside a horizontal ScrollView so the row
  // never reflows between routes and the active pill auto-scrolls
  // into view on deep-link entry.
  assert.match(
    appNavSource,
    /import\s*\{[^}]*\bScrollView\b[^}]*\}\s*from\s*"react-native"/,
    "AppNav must still import ScrollView for the tablet/desktop branch",
  );
  assert.match(
    appNavSource,
    /<ScrollView[\s\S]*?\bhorizontal\b/,
    "tablet/desktop branch must wrap the tab row in <ScrollView horizontal …>",
  );
  assert.match(
    appNavSource,
    /showsHorizontalScrollIndicator=\{false\}/,
    "horizontal ScrollView must hide its scroll indicator",
  );
});

test("AppNav pins TAB_MIN_WIDTH at 96 so labels don't squish under overflow", () => {
  const match = appNavSource.match(/TAB_MIN_WIDTH\s*=\s*(\d+)/);
  assert.ok(match, "AppNav must define TAB_MIN_WIDTH");
  assert.equal(
    Number(match[1]),
    96,
    "TAB_MIN_WIDTH must stay at 96 — horizontal scroll absorbs overflow rather than shrinking labels",
  );
});

test("AppNav tab pills enforce a touch-target minHeight of at least 44 px", () => {
  // Apple HIG says interactive targets should be ≥ 44 px on each axis;
  // Material recommends 48 px. We hold a 44 px floor on every Pressable
  // — the tab pills on desktop, the hamburger trigger, the drawer
  // close button, and the drawer rows.
  const match = appNavSource.match(/TAB_MIN_HEIGHT\s*=\s*(\d+)/);
  assert.ok(match, "AppNav must define a TAB_MIN_HEIGHT constant");
  const minHeight = Number(match[1]);
  assert.ok(
    minHeight >= 44,
    `TAB_MIN_HEIGHT (${minHeight}) must be ≥ 44 to meet Apple HIG touch-target guidance`,
  );
  assert.match(
    appNavSource,
    /minHeight:\s*TAB_MIN_HEIGHT/,
    "tab pill style must apply minHeight: TAB_MIN_HEIGHT",
  );
});

test("AppNav's tablet/desktop tab row wrapper uses flex: 1 so it can shrink", () => {
  // The outer wrapper around the horizontal ScrollView has to be
  // allowed to shrink below the row's natural width — otherwise the
  // ScrollView's overflow never engages on tablet viewports near the
  // breakpoint. `flex: 1` on the wrapper plus `minWidth: 0` is the
  // canonical RN pattern.
  assert.match(
    appNavSource,
    /flex:\s*1,\s*minWidth:\s*0/,
    "tablet/desktop branch must wrap the horizontal ScrollView in a `flex: 1, minWidth: 0` view",
  );
});

test("AppNav auto-scrolls the active tab into view on tablet/desktop entry", () => {
  // Deep-linking to /settings on a tablet near the breakpoint puts
  // the Settings pill near the right edge of the visible window. The
  // ScrollView must reset its horizontal offset to land that pill on
  // screen. Phone branch skips this because the drawer renders every
  // item without overflow.
  assert.match(
    appNavSource,
    /scrollRef\.current\.scrollTo\(\s*\{\s*x:\s*offset/,
    "AppNav must call scrollTo with an x offset on the tablet/desktop branch",
  );
  assert.match(
    appNavSource,
    /useEffect\(/,
    "AppNav must use a useEffect to scroll the active tab into view after mount",
  );
  // And the effect must early-return whenever the drawer is shown (phone
  // OR mid-width tablets that fall back to the hamburger) so we don't try to
  // measure a ScrollView that didn't render.
  assert.match(
    appNavSource,
    /if\s*\(useDrawer\)\s*return\s*;/,
    "auto-scroll effect must early-return when the drawer is shown",
  );
});
