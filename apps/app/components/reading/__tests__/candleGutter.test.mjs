// Drift-guards for the Panel-2 Wave 2 candle-gutter surfaces: the in-reader
// burn meter (from 50%) and the candle-gutter interstitial that turns the daily
// cap into a narrative event with a paywall door (panel-review-2 HIGH: "Free→
// paid conversion moment dead-ends" + Principle 8). Source-level greps matching
// the rest of components/reading/__tests__; the pure burn/meter math is covered
// by the vitest suite (lib/__tests__/dailyTurnApi.test.ts).

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

test("CandleGutter exports both the meter and the interstitial", () => {
  const src = read("components/reading/CandleGutter.tsx");
  assert.match(src, /export function CandleBurnMeter\(/, "must export CandleBurnMeter");
  assert.match(src, /export function CandleGutterInterstitial\(/, "must export CandleGutterInterstitial");
});

test("interstitial: RETURN-when-relit door is primary, subscribe is secondary", () => {
  const src = read("components/reading/CandleGutter.tsx");
  // Primary door returns until the candle re-lights (free tier stays beatable).
  assert.match(src, /Return when the candle re-lights/, "primary door copy");
  assert.match(
    src,
    /onPress=\{onReturn\}\s*\n\s*variant="primary"/,
    "the RETURN door must be the primary variant",
  );
  // Secondary door leads to the paywall.
  assert.match(src, /Keep the candle burning/, "secondary door copy");
  assert.match(
    src,
    /onPress=\{onSubscribe\}\s*\n\s*variant="secondary"/,
    "the subscribe door must be the secondary variant",
  );
});

test("interstitial frames a re-light countdown, not a raw error", () => {
  const src = read("components/reading/CandleGutter.tsx");
  assert.match(src, /re-lights in \$\{resetsInLabel\}/, "must surface the live re-light countdown");
  assert.match(src, /The candle gutters/, "must use the tome-voice gutter copy");
});

test("burn meter is purely informational — no CTA, no gate", () => {
  const src = read("components/reading/CandleGutter.tsx");
  // The meter must NOT carry a Button (that belongs to the interstitial only).
  const meterFn = src.slice(
    src.indexOf("export function CandleBurnMeter"),
    src.indexOf("export function CandleGutterInterstitial"),
  );
  assert.ok(!/\<Button/.test(meterFn), "the burn meter must not render a CTA button");
});

test("ReaderScreen wires the meter from >=50% burn and the interstitial at cap", () => {
  const src = read("components/reading/ReaderScreen.tsx");
  assert.match(src, /candleBurnModel\(dailyTurnState, nowTs\)/, "must derive the candle model");
  // Meter gated on the pure model's showMeter (>=50%, not guttered, has state).
  assert.match(
    src,
    /showCandleMeter =\s*\n?\s*!isTerminalView && burn\.showMeter && Boolean\(dailyTurnState\)/,
    "meter must gate on burn.showMeter + a present turn-state",
  );
  // Interstitial gated on the pure model's guttered.
  assert.match(
    src,
    /showCandleGutter = !isTerminalView && burn\.guttered/,
    "interstitial must gate on burn.guttered",
  );
});

test("candle-gutter interstitial never gates already-generated prose (Principle 7)", () => {
  const src = read("components/reading/ReaderScreen.tsx");
  // Terminal panels (ending / chapter boundary) suppress both surfaces so the
  // reader who already reached an end is never re-gated.
  assert.match(
    src,
    /isTerminalView = Boolean\(projection\.ending\) \|\| Boolean\(chapterBoundary\)/,
    "must compute a terminal-view guard",
  );
  // The interstitial is rendered as a SIBLING above the Layout (which still
  // renders the scene prose), not in place of it.
  assert.match(src, /<CandleGutterInterstitial/, "must render the interstitial");
});

test("the subscribe door deep-links the paywall with the daily-limit reason", () => {
  const src = read("components/reading/ReaderScreen.tsx");
  assert.match(
    src,
    /router\.push\("\/paywall\?reason=daily_limit"\)/,
    "subscribe door must carry ?reason=daily_limit so the paywall opens the daily variant",
  );
  assert.match(src, /onReturn=\{\(\) => router\.push\("\/"\)\}/, "return door goes home");
});
