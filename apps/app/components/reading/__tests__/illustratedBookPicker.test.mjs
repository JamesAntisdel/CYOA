// Drift guards for reading-modes Wave 2, task 2.3 (Agent RM-PICKER):
// Pro-gating + layout↔strategy coupling for Illustrated Book in BOTH pickers —
// the settings Cinematic-mode group (`app/settings/index.tsx`) and the
// in-reader Reading-layout group (`components/reading/ReaderSettingsDrawer.tsx`).
//
// These surfaces are TSX and cannot be rendered under `node --test`, so — like
// readerSaveActions / returningHomeAndPaywall — the guards read the source by
// path and assert the load-bearing behavior:
//
//   1. Both pickers OFFER Illustrated Book (settings: as the `illustrated_book`
//      cinematicMode strategy; drawer: as the `illustratedBook` layout skin).
//   2. Both Pro-GATE it: a non-Pro reader is routed to the paywall
//      (`/paywall?reason=pro_media`) instead of selecting into a permanent
//      skeleton (R3.7).
//   3. Selecting it COUPLES the two axes (RM7/R3.8): layout `illustratedBook` +
//      the stills-guaranteeing `illustrated_book` strategy + images-ON, written
//      together via the shared ILLUSTRATED_BOOK_SETTINGS constant.
//   4. The Pro-gate honors the dev unlock (EXPO_PUBLIC_DEV_FORCE_PRO_MEDIA,
//      mirroring the server CYOA_DEV_FORCE_PRO_MEDIA / devForceProMedia) so
//      local dev previews the full mode.
//   5. The drawer's coupled server sync round-trips `cinematicMode` (unlike the
//      plain three-field media-gate sync), so the still-strategy reaches the
//      server.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const settingsSrc = readFileSync(
  resolve(here, "../../../app/settings/index.tsx"),
  "utf8",
);
const drawerSrc = readFileSync(resolve(here, "../ReaderSettingsDrawer.tsx"), "utf8");

// Exact spellings the parallel agents agreed on (RESOLVED DECISION OQ7 =
// DISTINCT STRATEGY): camelCase layout variant, snake_case cinematicMode.
const LAYOUT_VARIANT = "illustratedBook";
const STRATEGY = "illustrated_book";

// ── Shared coupling constant ────────────────────────────────────────────────

for (const [name, src] of [
  ["settings/index.tsx", settingsSrc],
  ["ReaderSettingsDrawer.tsx", drawerSrc],
]) {
  test(`${name}: ILLUSTRATED_BOOK_SETTINGS couples layout + strategy + images-ON`, () => {
    assert.match(
      src,
      /const ILLUSTRATED_BOOK_SETTINGS =/,
      `${name} must define the shared coupling constant`,
    );
    // All three fields present in the constant so the two axes never desync.
    const block = src.slice(src.indexOf("ILLUSTRATED_BOOK_SETTINGS"));
    assert.match(block, new RegExp(`layout:\\s*"${LAYOUT_VARIANT}"`), `${name}: coupling sets layout ${LAYOUT_VARIANT}`);
    assert.match(
      block,
      new RegExp(`cinematicMode:\\s*(?:"${STRATEGY}"|ILLUSTRATED_BOOK_STRATEGY)`),
      `${name}: coupling sets the ${STRATEGY} strategy`,
    );
    assert.match(block, /imagesEnabled:\s*true/, `${name}: coupling forces images ON`);
  });

  test(`${name}: Pro-gate keys off entitlement + honors the dev unlock`, () => {
    assert.match(
      src,
      /function isIllustratedBookUnlocked\(/,
      `${name} must define the Pro-gate predicate`,
    );
    assert.match(
      src,
      /process\.env\.EXPO_PUBLIC_DEV_FORCE_PRO_MEDIA === "1"/,
      `${name}: dev unlock must mirror CYOA_DEV_FORCE_PRO_MEDIA via the EXPO_PUBLIC_ seam`,
    );
    assert.match(
      src,
      /entitlementStatus === "active"/,
      `${name}: gate requires an active entitlement`,
    );
    assert.match(
      src,
      /entitlementTier === "pro"[\s\S]{0,60}entitlementTier === "unlimited"/,
      `${name}: gate unlocks for pro or unlimited tiers`,
    );
    assert.match(
      src,
      /const illustratedBookUnlocked = isIllustratedBookUnlocked\(account\.profile\)/,
      `${name}: the picker must compute the unlock from the account profile`,
    );
  });

  test(`${name}: non-Pro selection routes to the paywall, never a skeleton`, () => {
    assert.match(
      src,
      /if \(!illustratedBookUnlocked\)/,
      `${name}: the locked branch must gate on the unlock flag`,
    );
    assert.match(
      src,
      /router\.push\("\/paywall\?reason=pro_media"\)/,
      `${name}: locked selection must route to the pro_media paywall`,
    );
  });

  test(`${name}: the option shows a lock glyph until unlocked`, () => {
    assert.match(
      src,
      /illustratedBookUnlocked \? "Illustrated[^"]*" : "Illustrated[^"]*🔒"/,
      `${name}: the Illustrated Book option must render locked (🔒) for non-Pro readers`,
    );
  });
}

// ── Settings page: the Cinematic-mode group hosts the strategy ──────────────

test("settings: Cinematic-mode group offers the illustrated_book strategy", () => {
  assert.match(
    settingsSrc,
    /const ILLUSTRATED_BOOK_STRATEGY = "illustrated_book" as const/,
    "settings must pin the illustrated_book strategy literal",
  );
  // The option value in the Cinematic-mode group is the strategy.
  assert.match(
    settingsSrc,
    /value: ILLUSTRATED_BOOK_STRATEGY/,
    "settings Cinematic-mode group must offer ILLUSTRATED_BOOK_STRATEGY",
  );
  // Selecting it takes the coupled write path.
  assert.match(
    settingsSrc,
    /if \(cinematicMode === ILLUSTRATED_BOOK_STRATEGY\)/,
    "settings onSelect must branch on the illustrated_book strategy",
  );
  assert.match(
    settingsSrc,
    /updateSettings\(\{ \.\.\.ILLUSTRATED_BOOK_SETTINGS \}/,
    "settings must apply the coupled ILLUSTRATED_BOOK_SETTINGS on unlock",
  );
});

test("settings: leaving Illustrated Book drops the image-first skin so no plate strands", () => {
  // Picking any other strategy while on the illustratedBook skin resets layout
  // to book — otherwise the reader keeps a full-bleed plate a non-guaranteeing
  // strategy may never fill.
  assert.match(
    settingsSrc,
    /settings\.layout === "illustratedBook"/,
    "settings must detect the image-first skin when a different strategy is picked",
  );
  assert.match(
    settingsSrc,
    /\{ cinematicMode, layout: "book" \}/,
    "settings must reset layout to book when leaving Illustrated Book",
  );
});

test("settings: the coupled strategy round-trips to the server via mediaPrefs", () => {
  // pickMediaPrefs already forwards cinematicMode, so the coupled write's
  // syncMediaPrefs echo carries illustrated_book to the server.
  assert.match(
    settingsSrc,
    /cinematicMode: next\.cinematicMode/,
    "settings pickMediaPrefs must forward cinematicMode to the server echo",
  );
});

// ── Reader drawer: the Reading-layout group hosts the skin ──────────────────

test("drawer: Reading-layout group offers the illustratedBook skin", () => {
  assert.match(
    drawerSrc,
    /value: "illustratedBook"/,
    "drawer Reading-layout group must offer the illustratedBook variant",
  );
  assert.match(
    drawerSrc,
    /if \(layout === "illustratedBook"\)/,
    "drawer onSelect must branch on the illustratedBook layout",
  );
  assert.match(
    drawerSrc,
    /updateSettings\(\{ \.\.\.ILLUSTRATED_BOOK_SETTINGS \}/,
    "drawer must apply the coupled ILLUSTRATED_BOOK_SETTINGS on unlock",
  );
});

test("drawer: coupled server sync round-trips cinematicMode (the still-strategy)", () => {
  assert.match(
    drawerSrc,
    /const syncMediaPrefsWithStrategy = async/,
    "drawer must define a strategy-aware server sync for the coupling",
  );
  const block = drawerSrc.slice(drawerSrc.indexOf("syncMediaPrefsWithStrategy"));
  assert.match(
    block,
    /cinematicMode: next\.cinematicMode/,
    "drawer's coupled sync must forward cinematicMode so the server strategy tracks the skin",
  );
  assert.match(
    drawerSrc,
    /void syncMediaPrefsWithStrategy\(next\)/,
    "drawer's coupled write must invoke the strategy-aware sync",
  );
});

test("drawer: locked selection closes the drawer before routing to the paywall", () => {
  // The modal must dismiss so the paywall route isn't rendered under the sheet.
  const lockedBranch = drawerSrc.slice(
    drawerSrc.indexOf("if (!illustratedBookUnlocked)"),
  );
  const onCloseIdx = lockedBranch.indexOf("onClose()");
  const pushIdx = lockedBranch.indexOf('router.push("/paywall');
  assert.ok(onCloseIdx > 0, "drawer locked branch must call onClose()");
  assert.ok(pushIdx > 0, "drawer locked branch must route to the paywall");
  assert.ok(onCloseIdx < pushIdx, "drawer must close before it navigates");
});
