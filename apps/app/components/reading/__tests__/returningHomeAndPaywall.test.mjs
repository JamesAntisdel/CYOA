// Drift-guards for the Panel-2 Wave 2 returning-reader home reorder
// (panel-review-2 LOW: "home treats every visit as a first visit") and the
// paywall truthfulness fixes (panel-review-2 MEDIUM: fake candle + demo reason
// selector shipped to users). These files live outside the node --test dirs, so
// the guards are hosted here and read the source by path (same pattern as
// questLineCandle.test.mjs).

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

test("home: returning readers lead with continue + rank; first-visit unchanged", () => {
  const src = read("app/index.tsx");
  assert.match(src, /const returning = Boolean\(continueSave\)/, "derives a returning flag off continueSave");
  // Continue LEAD renders before the daily card for returning readers.
  assert.match(src, /\{returning \? continueLead : null\}/, "continue lead leads for returning readers");
  // Hero is hero-first ONLY for first-visit, and demoted below the fold when
  // returning (rendered after the starter shelf).
  assert.match(src, /\{returning \? null : heroBlock\}/, "hero leads only on first visit");
  assert.match(
    src,
    /demoted below the fold for returning\n\s*readers[\s\S]*?\{returning \? \(\s*\n\s*<View style=\{\{ maxWidth: 900/,
    "hero is re-rendered below the starter shelf when returning",
  );
});

test("home: the returning lead surfaces the Librarian Rank", () => {
  const src = read("app/index.tsx");
  assert.match(src, /librarianRankChipLabel\(librarianRank\)/, "rank chip label");
  assert.match(src, /librarianRankProgressLine\(librarianRank\)/, "rank progress line");
  assert.match(src, /Pick up where you left off/, "continue lead copy");
});

test("home: no duplicate Continue button in the start row", () => {
  const src = read("app/index.tsx");
  // The old secondary "Continue {title}" button is gone — continue now lives in
  // the lead card only, so returning readers don't see it twice.
  assert.ok(
    !/variant="secondary"[\s\S]{0,80}Continue \{/.test(src),
    "the secondary Continue button must be removed (de-duped into the lead card)",
  );
});

test("paywall: honors the ?reason= deep link and hides the demo selector on real arrivals", () => {
  const src = read("app/paywall/index.tsx");
  assert.match(src, /const reasonParam = parseReasonParam\(params\.reason\)/, "parses the reason query");
  assert.match(src, /useState<PaywallReason>\(reasonParam \?\? "daily_limit"\)/, "initial reason from the query");
  // The design-review selector is gated behind the ABSENCE of a real reason.
  assert.match(src, /\{!reasonParam \? \(/, "selector hidden when arrived via a real reason");
});

test("paywall: candle is real turn-state, not the fabricated 7h 22m", () => {
  const src = read("app/paywall/index.tsx");
  assert.ok(!/7h 22m/.test(src), "the hardcoded fake reset label must be gone");
  assert.match(src, /getRemoteDailyTurnState\(/, "fetches real turn state");
  assert.match(src, /candleBurnModel\(turnState, Date\.now\(\)\)/, "derives the candle from real state");
  // No more setCandle mutation from the reason selector (candle is derived).
  assert.ok(!/setCandle\(/.test(src), "candle must be derived, not mutated by the demo selector");
});
