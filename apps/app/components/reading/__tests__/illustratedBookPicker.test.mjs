// Drift guards for the Illustrated-Book Pro-gate + layout↔strategy coupling in
// BOTH settings surfaces — the /settings Cinematic-mode group
// (`app/settings/index.tsx`) and the in-reader Reading-layout group
// (`components/reading/ReaderSettingsDrawer.tsx`).
//
// UPDATED for reader-chrome-declutter Wave 2 (R4.1/RC7): the gate, the
// ILLUSTRATED_BOOK_SETTINGS coupling constant, and the coupled select/paywall
// handler now live ONCE in `lib/readerSettingsGroups.ts` and are IMPORTED by
// both surfaces (the verbatim copies are deleted). These surfaces are TSX and
// cannot be rendered under `node --test`, so — like readerSaveActions /
// returningHomeAndPaywall — the guards read the source by path and assert the
// load-bearing wiring:
//
//   1. Both surfaces IMPORT the gate + coupled handler from the shared module
//      (no local re-definition — the extraction is real, RC7).
//   2. Both Pro-GATE via `isIllustratedBookUnlocked(account.profile)` and route
//      a locked selection through `selectIllustratedBook`, which returns the
//      paywall route instead of selecting into a permanent skeleton (R3.7).
//   3. Selecting it unlocked COUPLES the two axes (RM7/R3.8): layout
//      `illustratedBook` + the `illustrated_book` strategy + images-ON, applied
//      together from the shared ILLUSTRATED_BOOK_SETTINGS via
//      `updateSettings({ ...result.settings })`.
//   4. The drawer's coupled server sync round-trips `cinematicMode` (unlike the
//      plain three-field media-gate sync) so the still-strategy reaches the
//      server; the settings surface forwards cinematicMode via pickMediaPrefs.
//   5. No lock EMOJI survives in either surface (RC5) — the locked state is the
//      shared option's `locked` flag rendered as on-system text.

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

// ── The shared module owns the gate + coupling; both surfaces import it ──────

for (const [name, src] of [
  ["settings/index.tsx", settingsSrc],
  ["ReaderSettingsDrawer.tsx", drawerSrc],
]) {
  test(`${name}: imports the gate + coupled handler from the shared module (RC7)`, () => {
    // The single source of truth is lib/readerSettingsGroups.
    assert.match(
      src,
      /from\s+["'][^"']*lib\/readerSettingsGroups["']/,
      `${name} must import from lib/readerSettingsGroups`,
    );
    assert.match(src, /isIllustratedBookUnlocked/, `${name}: must use the shared gate`);
    assert.match(src, /selectIllustratedBook/, `${name}: must use the shared coupled handler`);
  });

  test(`${name}: does NOT re-define the gate or the coupling constant (extraction is real)`, () => {
    assert.doesNotMatch(
      src,
      /function isIllustratedBookUnlocked\s*\(/,
      `${name}: the gate must be imported, not re-defined (single definition, RC7)`,
    );
    assert.doesNotMatch(
      src,
      /const ILLUSTRATED_BOOK_SETTINGS\s*=/,
      `${name}: the coupling constant must be imported, not re-defined (single definition)`,
    );
  });

  test(`${name}: computes the unlock from the account profile`, () => {
    assert.match(
      src,
      /const illustratedBookUnlocked = isIllustratedBookUnlocked\(account\.profile\)/,
      `${name}: the surface must compute the unlock from the account profile`,
    );
  });

  test(`${name}: routes selection through selectIllustratedBook`, () => {
    assert.match(
      src,
      /selectIllustratedBook\(\{\s*illustratedUnlocked: illustratedBookUnlocked\s*\}\)/,
      `${name}: selection must run through the shared select handler with the gate`,
    );
  });

  test(`${name}: paywall result routes to the shared route; apply result couples`, () => {
    // Locked → paywall route (the string literal lives in the shared module).
    assert.match(
      src,
      /result\.kind === "paywall"/,
      `${name}: the surface must branch on the paywall result`,
    );
    assert.match(
      src,
      /router\.push\(result\.route\)/,
      `${name}: locked selection must route to result.route (the shared paywall)`,
    );
    // Unlocked → apply the coupled settings together.
    assert.match(
      src,
      /updateSettings\(\{ \.\.\.result\.settings \}/,
      `${name}: unlock must apply the coupled { ...result.settings } together`,
    );
  });

  test(`${name}: no lock EMOJI survives (RC5)`, () => {
    assert.doesNotMatch(src, /🔒/, `${name}: no lock emoji — locked state is on-system text`);
  });
}

// ── Both surfaces RENDER from the shared list, filtered by surface tag ──────

test("settings builds its sections from the shared module for the 'settings' surface", () => {
  // B3: the surface now renders the shared list grouped under the three honest
  // sections via `readerSettingsSections`, passing its own surface tag.
  assert.match(
    settingsSrc,
    /readerSettingsSections\(\{[\s\S]*illustratedUnlocked: illustratedBookUnlocked[\s\S]*\}\)/,
    "settings must build its sections from the shared module",
  );
  assert.match(
    settingsSrc,
    /surface: "settings"/,
    "settings must request its own surface tag",
  );
  // Canonical drift-fixed labels no longer live inline in the surface.
  assert.doesNotMatch(settingsSrc, /label="Typography"/, "settings must not hardcode the drifted 'Typography' label");
  assert.doesNotMatch(settingsSrc, /label="Chrome"/, "settings must not hardcode the dead Chrome group");
});

test("drawer builds its sections from the shared module for the 'drawer' surface", () => {
  // B3: the mid-tale subset now renders under the honest sections too.
  assert.match(
    drawerSrc,
    /readerSettingsSections\(\{[\s\S]*illustratedUnlocked: illustratedBookUnlocked[\s\S]*\}\)/,
    "drawer must build its sections from the shared module",
  );
  assert.match(
    drawerSrc,
    /surface: "drawer"/,
    "drawer must request its own surface tag (the mid-tale subset)",
  );
  // The drifted "Comic" label is gone (canonical "Graphic novel" comes from the
  // shared module now).
  assert.doesNotMatch(drawerSrc, /"Comic"/, "drawer must not hardcode the drifted 'Comic' label");
});

// ── Settings page: the Cinematic-mode group hosts the strategy ──────────────

test("settings: Cinematic-mode group's Illustrated option carries the strategy value", () => {
  // The shared module supplies the option value; the surface branches on it.
  assert.match(
    settingsSrc,
    /ILLUSTRATED_BOOK_STRATEGY/,
    "settings must reference the shared ILLUSTRATED_BOOK_STRATEGY constant",
  );
  assert.match(
    settingsSrc,
    /value === ILLUSTRATED_BOOK_STRATEGY/,
    "settings handleSelect must branch on the illustrated_book strategy value",
  );
});

test("settings: leaving Illustrated Book drops the image-first skin so no plate strands", () => {
  // Picking any other strategy while on the illustratedBook skin resets layout
  // to book — otherwise the reader keeps a full-bleed plate a non-guaranteeing
  // strategy may never fill.
  assert.match(
    settingsSrc,
    /settings\.layout === ILLUSTRATED_BOOK_LAYOUT/,
    "settings must detect the image-first skin when a different strategy is picked",
  );
  assert.match(
    settingsSrc,
    /layout: "book"/,
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

test("drawer: Reading-layout group offers the illustratedBook skin (appended pill)", () => {
  assert.match(
    drawerSrc,
    /ILLUSTRATED_BOOK_LAYOUT/,
    "drawer must offer the shared ILLUSTRATED_BOOK_LAYOUT variant",
  );
  assert.match(
    drawerSrc,
    new RegExp(`value === ILLUSTRATED_BOOK_LAYOUT`),
    "drawer handleSelect must branch on the illustratedBook layout",
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
  const lockedBranch = drawerSrc.slice(drawerSrc.indexOf('result.kind === "paywall"'));
  const onCloseIdx = lockedBranch.indexOf("onClose()");
  const pushIdx = lockedBranch.indexOf("router.push(result.route)");
  assert.ok(onCloseIdx > 0, "drawer locked branch must call onClose()");
  assert.ok(pushIdx > 0, "drawer locked branch must route to the paywall");
  assert.ok(onCloseIdx < pushIdx, "drawer must close before it navigates");
});

// ── Both surfaces stay layoutMode-free (P2/RC11) ────────────────────────────

test("neither surface references the retired layoutMode / Chrome group (P2/RC11)", () => {
  for (const [name, src] of [
    ["settings/index.tsx", settingsSrc],
    ["ReaderSettingsDrawer.tsx", drawerSrc],
  ]) {
    assert.doesNotMatch(src, /layoutMode/, `${name}: layoutMode is retired`);
    assert.doesNotMatch(
      src,
      /label="Chrome"|label={"Chrome"}/,
      `${name}: the dead Chrome group must be gone`,
    );
  }
});
