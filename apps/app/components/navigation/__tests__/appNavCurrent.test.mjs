// Drift guard for the `current` prop AppNav callers pass across every
// route that mounts the global top nav. This pins:
//
//   1. Every route that imports AppNav uses one of the canonical tab
//      keys (or omits `current` deliberately — like /index and the
//      reader, which have no canonical tab).
//   2. No route passes an invalid key like "home" (which used to be
//      AppNav's default and silently rendered with no active tab).
//
// If you add a new top-level route, append it to ROUTES below. If you
// add a new tab to AppNav, update VALID_TABS too.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

// Canonical tab keys. Mirrors AppNav's AppNavTab union — if the union
// changes, this list must change too. The empty-string sentinel means
// "AppNav rendered with no `current` prop", which is allowed on
// surfaces with no canonical tab (landing page, reader).
const VALID_TABS = new Set([
  "library",
  "discover",
  "creator",
  "account",
  "settings",
  "login",
  "", // omitted-prop sentinel
]);

const ROUTES = [
  { path: "app/index.tsx", expected: "" },
  { path: "app/library/index.tsx", expected: "library" },
  { path: "app/creator/index.tsx", expected: "creator" },
  { path: "app/account/index.tsx", expected: "account" },
  { path: "app/settings/index.tsx", expected: "settings" },
  { path: "app/paywall/index.tsx", expected: "account" },
  { path: "app/map/[saveId]/index.tsx", expected: "library" },
  { path: "app/read/[saveId]/history/index.tsx", expected: "library" },
];

for (const { path, expected } of ROUTES) {
  test(`${path} passes a valid AppNav current prop`, () => {
    const full = resolve(repoRoot, path);
    const source = readFileSync(full, "utf8");
    // Find the AppNav JSX element. Allow either `<AppNav />` or
    // `<AppNav current="..." />`.
    const navMatch = source.match(/<AppNav(\s+current="([^"]+)")?\s*\/>/);
    assert.ok(
      navMatch,
      `${path} must mount <AppNav /> somewhere in its tree`,
    );
    const current = navMatch[2] ?? "";
    assert.ok(
      VALID_TABS.has(current),
      `${path} passes current="${current}" which is not a valid AppNav tab — expected one of ${Array.from(VALID_TABS).join(", ")}`,
    );
    assert.equal(
      current,
      expected,
      `${path} should pass current="${expected}" (got "${current}")`,
    );
  });
}
