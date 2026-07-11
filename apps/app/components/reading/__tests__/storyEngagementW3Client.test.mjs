// Drift-guards for the Story-Engagement Wave 3 client surfaces (design §4.3).
//
// Source-level greps (same pattern as storyEngagementClient.test.mjs) — mounting
// the RN + Convex tree is out of scope for `node --test`. The pure logic behind
// these surfaces has full behavioral coverage in the vitest suites
// `apps/app/lib/__tests__/{dailyApi,storyEngagementW3}.test.ts`; here we assert
// the wiring connecting that logic to the UI can't silently regress.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../../..");

function read(rel) {
  return readFileSync(resolve(appRoot, rel), "utf8");
}

test("DailyCard hides when there's no Daily, ticks a countdown, and routes on start", () => {
  const src = read("components/daily/DailyCard.tsx");
  assert.match(src, /if \(!daily\) return null;/, "DailyCard must hide when daily === null (design §10)");
  assert.match(src, /formatCountdown\(remainingMs\)/, "DailyCard must render a live countdown");
  assert.match(src, /setInterval\(tick, 1000\)/, "DailyCard countdown must tick each second");
  assert.match(src, /onOpenReader\(result\.saveId\)/, "a fresh start must route into the reader");
  assert.match(src, /DAILY_ALREADY_PLAYED/, "DailyCard must handle daily_already_played");
  assert.match(src, /onOpenResults\(daily\.dailyId\)/, "already-played must route to results");
  assert.match(src, /Play today's tale/, "DailyCard must show the play CTA");
});

test("DailyResults renders sorted bars, first-finder, and the rarest callout", () => {
  const src = read("components/daily/DailyResults.tsx");
  assert.match(src, /buildDistributionModel\(results\)/, "DailyResults must build the distribution model");
  assert.match(src, /First found by/, "DailyResults must surface a first-finder badge");
  assert.match(src, /Rarest path/, "DailyResults must call out the rarest path");
  assert.match(src, /bar\.isYours/, "DailyResults must highlight the reader's own ending");
});

test("WhatMightHaveBeen renders UNREACHED candidates only on terminal saves with fork/replay CTAs", () => {
  const src = read("components/reading/WhatMightHaveBeen.tsx");
  assert.match(
    src,
    /whatMightHaveBeenCards\(candidates, \{ terminal \}\)/,
    "WhatMightHaveBeen must gate on terminal + filter to unreached candidates",
  );
  assert.match(src, /if \(cards\.length === 0\) return null;/, "must render nothing without candidates (BC9/BC10)");
  assert.match(src, /Fork from a decision/, "must offer the fork CTA (R14.2)");
  assert.match(src, /Begin again/, "must offer the begin-again CTA (R14.2)");
});

test("KeepsakePicker is single-select and absent when the account owns none", () => {
  const src = read("components/creator/KeepsakePicker.tsx");
  assert.match(src, /if \(!hasKeepsakes\(owned\)\) return null;/, "picker must hide with no keepsakes (R12.2)");
  assert.match(src, /toggleKeepsakeSelection\(selectedId, keepsake\.id\)/, "picker must be single-select");
  // The exported badge for the inventory list.
  assert.match(src, /export function KeepsakeBadge/, "KeepsakePicker must export the inventory KeepsakeBadge");
});

test("inventory list badges a carried keepsake", () => {
  const src = read("components/stats/modes/PeekDrawer.tsx");
  assert.match(src, /isKeepsakeItem\(item\)/, "inventory list must detect a keepsake item");
  assert.match(src, /KeepsakeBadge/, "inventory list must render the keepsake badge");
});

test("HardcoreSelect gates a Hardcore run on consent and offers a caveated downgrade", () => {
  const src = read("components/creator/HardcoreSelect.tsx");
  assert.match(src, /canStartMode/, "HardcoreSelect must expose the consent gate");
  assert.match(src, /HARDCORE_CONSENT_TITLE/, "consent screen must show the 'does not forgive' title");
  assert.match(src, /accessibilityRole="checkbox"/, "consent must be an explicit acknowledgment toggle");
  assert.match(src, /buildDowngradeModel\(mode\)/, "downgrade surface must use the downgrade model");
  assert.match(src, /Downgrade to Story/, "downgrade surface must offer the Story downgrade");
  assert.match(src, /HardcoreDeathNotice/, "must export the hardcore death purge notice");
});

test("SeedStoryFlow wires KeepsakePicker + HardcoreSelect and threads mode/keepsakeId", () => {
  const src = read("components/creator/SeedStoryFlow.tsx");
  assert.match(src, /<KeepsakePicker/, "seed flow must render the KeepsakePicker");
  assert.match(src, /<HardcoreSelect/, "seed flow must render the HardcoreSelect");
  assert.match(src, /canStartMode\(mode, consented\)/, "launch must be gated on the consent");
  assert.match(src, /mode,\n\s*\.\.\.\(keepsakeId \? \{ keepsakeId \} : \{\}\)/, "onLaunchSeed must thread mode + keepsakeId");
});

test("EndingsMap renders fogged candidate ghosts", () => {
  const src = read("components/endings/EndingsMap.tsx");
  assert.match(src, /ghostCandidates\?:/, "EndingsMap must accept ghost candidates");
  assert.match(src, /ghost: true/, "EndingsMap must mark ghost nodes");
  assert.match(src, /node\.ghost/, "EndingsMap must render ghosts distinctly from hidden endings");
});

test("profile screen shows the librarian rank chip + keepsakes shelf", () => {
  const src = read("app/profile/index.tsx");
  assert.match(src, /librarianRankChipLabel\(librarianRank\)/, "profile must show the rank chip");
  assert.match(src, /librarianRankProgressLine\(librarianRank\)/, "profile must show the rank progress line");
  assert.match(src, /keepsakes\.length > 0/, "profile must render a keepsakes shelf when non-empty");
});

test("home screen renders DailyCard from a fetched today row", () => {
  const src = read("app/index.tsx");
  assert.match(src, /import \{ DailyCard \}/, "home must import DailyCard");
  assert.match(src, /getRemoteDailyToday\(/, "home must fetch today's Daily");
  assert.match(src, /<DailyCard/, "home must render DailyCard");
  assert.match(src, /startRemoteDaily\(/, "home must wire startDaily into the card");
});
