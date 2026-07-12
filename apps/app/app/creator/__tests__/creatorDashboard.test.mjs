// Drift-guards for the creator analytics dashboard route
// (app/creator/dashboard.tsx) and its entry link from the creator route.
//
// Source-level greps, same pattern as creatorShelf.test.mjs — mounting the
// RN + Convex tree is out of scope for `node --test`. The behavioral pieces
// (server aggregation, BC2 adapter, sparkline render models) have vitest
// coverage in convex/tests/creatorDashboard.test.ts and
// lib/__tests__/creatorDashboardApi.test.ts; here we pin the client wiring.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dashboardSrc = readFileSync(resolve(here, "../dashboard.tsx"), "utf8");
const creatorSrc = readFileSync(resolve(here, "../index.tsx"), "utf8");

test("the dashboard route loads owner stats through the lib adapter", () => {
  assert.match(
    dashboardSrc,
    /getRemoteCreatorSeedStats\(\{\s*accountId: guest\.session\.accountId,\s*\.\.\.guestAuthArgs\(\),\s*\}\)/,
    "stats must load via getRemoteCreatorSeedStats with the session auth args",
  );
  assert.match(
    dashboardSrc,
    /from "\.\.\/\.\.\/lib\/creatorDashboardApi"/,
    "the route must consume the creatorDashboardApi adapter, not raw convexHttp",
  );
});

test("loading, unreachable, and empty states are all rendered", () => {
  assert.match(dashboardSrc, /stats === undefined \?/, "a loading state must render before data");
  assert.match(dashboardSrc, /stats === null \?/, "an unreachable state must offer a retry");
  assert.match(dashboardSrc, /setNonce\(\(n\) => n \+ 1\)/, "retry must re-trigger the load effect");
  assert.match(dashboardSrc, /No published seeds yet/, "creators with no seeds get the empty state");
  assert.match(
    dashboardSrc,
    /Publish your first seed/,
    "the empty state routes back to the builder",
  );
});

test("per-seed cards chart the quit points with theme-consistent bars", () => {
  assert.match(dashboardSrc, /buildQuitBars\(quitPoints\)/, "bars come from the pure render model");
  assert.match(
    dashboardSrc,
    /Readers drift away around turn \$\{peak\}/,
    "the peak quit turn is the card's headline insight",
  );
  assert.match(
    dashboardSrc,
    /tokens\.colors\.accent : tokens\.colors\.accentMuted/,
    "bars must use theme tokens (accent for data, accentMuted for empty turns)",
  );
  assert.match(
    dashboardSrc,
    /accessibilityLabel=\{`Quit points: \$\{summary\}`\}/,
    "the sparkline carries a text summary for screen readers",
  );
  assert.match(dashboardSrc, /No stalled runs yet/, "cards without quits say so instead of an empty plot");
});

test("cards separate owner self-play from external reader time", () => {
  assert.match(
    dashboardSrc,
    /formatPlayTime\(seed\.externalPlaySeconds\)/,
    "the reader-time stat must exclude the owner's own runs",
  );
  assert.match(
    dashboardSrc,
    /your own test runs \(excluded from reader time\)/,
    "self-play is disclosed on the card",
  );
});

test("the creator route links to the dashboard next to the drafts shelf", () => {
  const shelfAt = creatorSrc.indexOf("Your drafts");
  assert.ok(shelfAt > -1, "the drafts shelf must exist");
  const linkAt = creatorSrc.indexOf('router.push("/creator/dashboard")');
  assert.ok(linkAt > -1, "the creator route must link to /creator/dashboard");
  assert.ok(
    Math.abs(linkAt - shelfAt) < 900,
    "the dashboard entry link must sit next to the drafts shelf",
  );
});
