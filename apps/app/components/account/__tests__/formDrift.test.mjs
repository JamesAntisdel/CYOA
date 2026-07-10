// Drift-guard for account-flow form surfaces.
//
// The Forms / Inputs / Account-flow agent owns the consistency of every
// text field and button hierarchy on the settings, account, login, paywall,
// and profile routes (plus the auth + account components those routes
// compose). The rules enforced here:
//
//   1. NO raw `<TextInput>` in owned files. The canonical `Field` primitive
//      at `apps/app/components/primitives/Field.tsx` owns every label /
//      input / helpText / error surface — if a new field is added, it must
//      route through that primitive so border + focus + typography stay
//      consistent across the app.
//   2. The destructive "Delete account" button MUST NOT use variant="primary".
//      Reserve primary for the recommended action on a surface.
//   3. The `Field` primitive renders a labeled column with input + helpText
//      slot (or error slot when an error prop is passed).
//
// We don't mount RN here — same approach as `historyRouteShape.test.mjs`.
// Source-level greps are fast, deterministic, and catch the patterns we
// care about.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../../..");

const OWNED_FILES = [
  "app/account/index.tsx",
  "app/login/index.tsx",
  "app/settings/index.tsx",
  "app/profile/index.tsx",
  "app/paywall/index.tsx",
  "components/account/MatureOptIn.tsx",
  "components/account/AgeGate.tsx",
  "components/account/Under13Block.tsx",
  "components/auth/SignInForm.tsx",
  "components/auth/ProfileArchetypes.tsx",
  "components/auth/MagicLinkSent.tsx",
];

function readOwned(relative) {
  return readFileSync(resolve(appRoot, relative), "utf8");
}

test("no raw <TextInput> in account-flow surfaces", () => {
  // Every owned form surface must route input through the Field primitive
  // rather than reaching for raw React Native TextInput with inline styles.
  for (const relative of OWNED_FILES) {
    const source = readOwned(relative);
    assert.ok(
      !/<TextInput\b/.test(source),
      `${relative}: raw <TextInput> found — migrate to Field primitive`,
    );
    // Also forbid the `TextInput` named import; importing without using is
    // dead code, and importing in order to use is exactly what rule 1 bans.
    assert.ok(
      !/\bTextInput\b/.test(
        source
          .split("\n")
          .filter((line) => line.startsWith("import"))
          .join("\n"),
      ),
      `${relative}: TextInput import found — Field primitive replaces it`,
    );
  }
});

test("Delete account button is NOT variant=\"primary\"", () => {
  // Destructive actions never claim the primary slot. The danger variant
  // (or default) is the correct treatment; primary is reserved for the
  // recommended path on a surface.
  const source = readOwned("app/account/index.tsx");
  // Find the Delete account button block and assert its variant.
  const match = source.match(/<Button[^>]*?>\s*Delete account\s*<\/Button>/s);
  assert.ok(match, "Delete account button not found in account/index.tsx");
  assert.ok(
    !/variant="primary"/.test(match[0]),
    "Delete account must NOT use variant=\"primary\"",
  );
  assert.ok(
    /variant="danger"/.test(match[0]),
    "Delete account should use variant=\"danger\"",
  );
});

test("Field primitive exposes label + helpText + error slots", () => {
  // Drift-guard the Field primitive's public shape so consumers can rely
  // on it. The agent that owns Field is the primitives agent; this test
  // catches accidental removal of the slots account / login / settings depend on.
  const source = readFileSync(
    resolve(appRoot, "components/primitives/Field.tsx"),
    "utf8",
  );
  for (const slot of ["label", "helpText", "error"]) {
    assert.ok(
      new RegExp(`\\b${slot}\\b`).test(source),
      `Field primitive missing ${slot} slot`,
    );
  }
  // The Field must derive every visual from theme tokens — no inline hex.
  assert.ok(
    !/#[0-9a-fA-F]{3,8}/.test(source),
    "Field primitive must not embed inline hex colors",
  );
});

test("account-flow surfaces import Field from primitives barrel", () => {
  // Every owned surface that has an input MUST import Field from the
  // primitives barrel — never reach into the file path directly. This
  // keeps the surface area for the primitive stable.
  for (const relative of [
    "app/account/index.tsx",
    "components/auth/SignInForm.tsx",
    "components/auth/ProfileArchetypes.tsx",
  ]) {
    const source = readOwned(relative);
    assert.ok(
      /from\s+["'][^"']*\/primitives["']/.test(source),
      `${relative}: must import from the primitives barrel`,
    );
    assert.ok(
      /\bField\b/.test(source),
      `${relative}: must use the Field primitive`,
    );
  }
});

// ---------------------------------------------------------------------------
// Mobile reflow drift-guards.
//
// The forms/paywall mobile pass made every owned account-flow surface route
// its phone/tablet/desktop layout decision through the shared `useBreakpoint`
// helper at `apps/app/lib/responsive.ts`. These guards make sure a future
// refactor doesn't accidentally re-introduce a fixed two-column row that
// breaks at 375px viewport.
// ---------------------------------------------------------------------------

test("account + settings routes route layout through useBreakpoint", () => {
  // The two-column row + edit-panel pattern on /account and /settings only
  // works at desktop widths. Both surfaces must consult useBreakpoint so
  // they can collapse to a single column on phone. We grep for the import
  // and the isPhone destructure — if either disappears, the surface has
  // probably regressed to an unconditional row layout.
  for (const relative of [
    "app/account/index.tsx",
    "app/settings/index.tsx",
    "app/paywall/index.tsx",
  ]) {
    const source = readOwned(relative);
    assert.ok(
      /from\s+["'][^"']*\/responsive["']/.test(source),
      `${relative}: must import the breakpoint helper from lib/responsive`,
    );
    assert.ok(
      /\bisPhone\b/.test(source),
      `${relative}: must consume isPhone from useBreakpoint to drive phone layout`,
    );
  }
});

test("account two-column wrapper collapses on phone", () => {
  // Account-page profile + edit panel: each column has `minWidth: 320` so on
  // a 375px viewport the second column would try to fit beside the first
  // (327px content area) and fail catastrophically. The mobile pass swaps
  // each column to flexBasis: "100%" on phone. Guard against a regression
  // that drops the phone branch and leaves the unconditional 320-min layout.
  const source = readOwned("app/account/index.tsx");
  // Both columns must include a phone branch that pins width to 100%.
  const matches = source.match(/flexBasis:\s*["']100%["']/g) ?? [];
  assert.ok(
    matches.length >= 2,
    `account/index.tsx: expected ≥2 flexBasis: "100%" entries (profile column + edit column) — found ${matches.length}`,
  );
});

test("settings page does not pin row layout below 480px", () => {
  // The settings page renders a flex row with a main settings Surface +
  // muted info Surface beside it. On phone both must stack. We assert the
  // page reaches for the phone-aware width override; without it the row
  // would overflow below 480px.
  const source = readOwned("app/settings/index.tsx");
  assert.ok(
    /flexBasis:\s*["']100%["']/.test(source),
    "settings/index.tsx: missing flexBasis: \"100%\" — main + muted Surfaces will not stack on phone",
  );
});

test("TierCompare uses responsive flex direction", () => {
  // TierCompare must collapse from 4 side-by-side cards (≥768px) to a
  // single column on phone. The implementation reads `isPhone` from
  // useBreakpoint and toggles flexDirection accordingly. If either piece
  // disappears, the four 220px cards will overflow a 375px viewport.
  const source = readFileSync(
    resolve(appRoot, "components/paywall/TierCompare.tsx"),
    "utf8",
  );
  assert.ok(
    /useBreakpoint/.test(source),
    "TierCompare must import useBreakpoint to drive its column count",
  );
  assert.ok(
    /flexDirection:\s*isPhone/.test(source),
    "TierCompare must toggle flexDirection on isPhone (phone stacks vertically)",
  );
});

test("MatureOptIn drops max-width cap on phone", () => {
  // RN Modal doesn't auto-fullscreen on web, and MatureOptIn is rendered
  // inline rather than inside a Modal — but the cosmetic effect we want
  // is the same: at 375px viewport the consent Surface must claim the
  // full content row instead of capping at 520. We grep for the explicit
  // phone-aware maxWidth override so a future refactor can't quietly
  // re-introduce the cap.
  const source = readFileSync(
    resolve(appRoot, "components/account/MatureOptIn.tsx"),
    "utf8",
  );
  assert.ok(
    /useBreakpoint/.test(source),
    "MatureOptIn must consult useBreakpoint for phone full-coverage layout",
  );
  assert.ok(
    /maxWidth:\s*isPhone\s*\?\s*["']100%["']/.test(source),
    "MatureOptIn must override maxWidth to \"100%\" on phone (full-coverage marker)",
  );
});
