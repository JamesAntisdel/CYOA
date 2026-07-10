// Drift guards for the mobile-reflow pass on the reader surface.
//
// The user-facing symptom that motivated this: opening the reader on a
// 375 px phone surfaced the Book layout (the stored default) with a
// 760-px max-width column that cramped against the gutter, and the
// FullSheet character-sheet modal was capped at maxWidth: 520 with a
// fixed inner ScrollView (`maxHeight: 360`) that didn't grow to fit
// the available phone real estate.
//
// This file pins the mobile-aware decisions:
//
//   1. ReaderScreen imports `useBreakpoint` and consults `isPhone` to
//      override the stored layout to "mobile" at render time.
//   2. Every reader layout (Book, Mobile, ModernApp, GraphicNovel,
//      Journal) caps its prose column with `maxWidth` AND sets
//      `width: "100%"` so the cap is a ceiling, not a floor — the
//      column shrinks to whatever the phone viewport allows.
//   3. FullSheet imports `useBreakpoint` and flips to full-width
//      (`maxWidth: "100%"`) on phone so the modal isn't a 520-px
//      island floating on a black overlay.
//   4. The Choice primitive's MIN_TAPPABLE_HEIGHT is ≥ 44 (WCAG 2.5.5).
//   5. The /map Storyboard card width is referenced from a constant
//      (`STORYBOARD_CARD_WIDTH_PHONE` / `_DEFAULT`) rather than the
//      bare `width: 260` literal — so a future contributor can't
//      reintroduce a hardcoded width that ignores the phone breakpoint.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../../..");

const read = (rel) => readFileSync(resolve(appRoot, rel), "utf8");

// Layouts that declare a single-column maxWidth cap. ModernApp is
// intentionally NOT in this list — it dispatches between a row (rails +
// center + rails) on tablet+ and a column on phone via its own
// useWindowDimensions / RAIL_BREAKPOINT check, so the cap lives on the
// row layout level, not a fixed maxWidth.
const readerLayouts = [
  "components/reading/layouts/Book.tsx",
  "components/reading/layouts/Mobile.tsx",
  "components/reading/layouts/GraphicNovel.tsx",
  "components/reading/layouts/Journal.tsx",
];

test("ReaderScreen consults useBreakpoint for the phone-aware layout default", () => {
  const src = read("components/reading/ReaderScreen.tsx");
  assert.match(
    src,
    /useBreakpoint/,
    "ReaderScreen must import useBreakpoint from lib/responsive so it can override the stored layout on phone viewports",
  );
  assert.match(
    src,
    /isPhone/,
    "ReaderScreen must read isPhone from the breakpoint helper",
  );
  assert.match(
    src,
    /resolveActiveLayout/,
    "ReaderScreen must dispatch through resolveActiveLayout so the phone override is testable / explicit",
  );
});

test("ReaderScreen exports markLayoutAsExplicitlyChosen for /settings", () => {
  const readerScreen = read("components/reading/ReaderScreen.tsx");
  const settings = read("app/settings/index.tsx");
  assert.match(
    readerScreen,
    /export function markLayoutAsExplicitlyChosen/,
    "ReaderScreen must export markLayoutAsExplicitlyChosen so /settings can opt the user out of the phone-aware default",
  );
  assert.match(
    settings,
    /markLayoutAsExplicitlyChosen\(\)/,
    "settings layout picker must call markLayoutAsExplicitlyChosen() so a user's explicit pick wins over the phone default",
  );
});

for (const rel of readerLayouts) {
  test(`${rel} caps prose width and uses 100% width`, () => {
    const src = read(rel);
    assert.match(
      src,
      /maxWidth:\s*\d+/,
      `${rel} must declare a maxWidth so the column doesn't sprawl across a wide tablet/desktop viewport`,
    );
    assert.match(
      src,
      /width:\s*["']100%["']/,
      `${rel} must declare width: "100%" so the column shrinks to fit a 375px phone viewport instead of bottoming out at maxWidth`,
    );
  });
}

test("ModernApp layout reflows to a single column under its rail breakpoint", () => {
  const src = read("components/reading/layouts/ModernApp.tsx");
  assert.match(
    src,
    /useWindowDimensions/,
    "ModernApp must call useWindowDimensions so the rails collapse on phone widths",
  );
  assert.match(
    src,
    /flexDirection:\s*showRails\s*\?\s*["']row["']\s*:\s*["']column["']/,
    "ModernApp must flip flexDirection between row (rails) and column (phone)",
  );
});

test("FullSheet imports useBreakpoint and flips to full-width on phone", () => {
  const src = read("components/stats/modes/FullSheet.tsx");
  assert.match(
    src,
    /useBreakpoint/,
    "FullSheet must import useBreakpoint so the modal can fill the phone viewport",
  );
  assert.match(
    src,
    /isPhone\s*\?\s*["']100%["']\s*:\s*\d+/,
    "FullSheet must flip maxWidth between 100% (phone) and a fixed cap (tablet+)",
  );
});

test("Choice primitive's minimum tappable height meets WCAG 2.5.5 (≥ 44 px)", () => {
  const src = read("components/primitives/Choice.tsx");
  const match = /MIN_TAPPABLE_HEIGHT\s*=\s*(\d+)/.exec(src);
  assert.ok(match, "Choice.tsx must declare a MIN_TAPPABLE_HEIGHT constant");
  const height = Number(match[1]);
  assert.ok(
    height >= 44,
    `MIN_TAPPABLE_HEIGHT must be ≥ 44 for WCAG 2.5.5 compliance; got ${height}`,
  );
});

test("Storyboard card width resolves through phone-aware constants", () => {
  const src = read("app/map/[saveId]/index.tsx");
  assert.match(
    src,
    /STORYBOARD_CARD_WIDTH_PHONE\s*=\s*240/,
    "/map page must declare STORYBOARD_CARD_WIDTH_PHONE = 240 so the phone variant is grep-able",
  );
  assert.match(
    src,
    /STORYBOARD_CARD_WIDTH_DEFAULT\s*=\s*260/,
    "/map page must declare STORYBOARD_CARD_WIDTH_DEFAULT = 260 for tablet+ readers",
  );
  // Storyboard component must consult useBreakpoint and read both
  // constants — a future contributor can't quietly hardcode one width.
  assert.match(
    src,
    /useBreakpoint\(\)/,
    "/map Storyboard must call useBreakpoint() to pick between phone and default widths",
  );
  assert.match(
    src,
    /STORYBOARD_CARD_WIDTH_PHONE\s*[\s\S]{0,200}STORYBOARD_CARD_WIDTH_DEFAULT/,
    "/map Storyboard must reference both constants in a single ternary so removing one trips this test",
  );
});

test("Storyboard card uses the cardWidth variable, not a bare 260 literal", () => {
  const src = read("app/map/[saveId]/index.tsx");
  // The card View should pass `width: cardWidth` rather than `width: 260`.
  // We allow `width: 260` to appear in the constant declaration only.
  // Anchor on the unique "Turn ${turn.turnNumber} card" accessibilityLabel
  // string (escaping the backticks would be confusing — use a substring).
  const anchor = "Turn ${turn.turnNumber} card";
  const anchorIdx = src.indexOf(anchor);
  assert.ok(anchorIdx > 0, "Storyboard card View accessibilityLabel anchor must be findable");
  const cardViewBlock = src.slice(anchorIdx, anchorIdx + 500);
  assert.match(
    cardViewBlock,
    /width:\s*cardWidth/,
    "Storyboard card View must read width from the `cardWidth` variable",
  );
  assert.doesNotMatch(
    cardViewBlock,
    /width:\s*260\b/,
    "Storyboard card View must not hardcode width: 260 — use the cardWidth variable",
  );
});
