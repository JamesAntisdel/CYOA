// Drift-guards for reader-chrome-declutter 3.4 (RB-COUNTS): lighting up the
// COLLAPSED StoryRibbon's doors + daily-pulse segments. Source-level greps in
// the house style (see doorsJournal.test.mjs / storyRibbon.test.mjs) — the
// components fetch inside React effects, so the wiring is pinned by source
// contract here, and the pure collapsed-segment matrix is exercised by
// ribbonCounts.test.ts (vitest, importing the real buildRibbonSegments).
//
// The Wave-1 gap these pin: StoryRibbon ACCEPTS doorsCount/pulseLine but they
// never lit up collapsed because DoorsJournal + DailyPulseChip self-fetch and
// ReaderScreen had no synchronous source. RB-COUNTS adds additive upward
// callbacks fired from the EXISTING fetch effects (no new query, RC2), captured
// into ReaderScreen state and threaded down to StoryRibbon.

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

const doors = read("components/reading/DoorsJournal.tsx");
const pulse = read("components/daily/DailyPulseChip.tsx");
const reader = read("components/reading/ReaderScreen.tsx");

// The control-emoji set the R5 sweep bans. Story-art (●○▮▯♥) is EXEMPT and
// lives in lib/storyEngagement.ts, never in this component.
const BANNED_EMOJI = ["▶", "⏸", "⚙", "✦", "🚪", "🔒", "✓", "×", "🕯", "🔥", "🧵", "🗝"];

test("DoorsJournal exposes an OPTIONAL upward count callback", () => {
  assert.match(doors, /onCount\?:\s*\(\(count:\s*number\)\s*=>\s*void\)\s*\|\s*undefined/);
  assert.match(doors, /DoorsJournal\(\{[^}]*onCount[^}]*\}/, "onCount must be destructured from props");
});

test("onCount fires with the FETCHED count from the existing fetch effect (no new query)", () => {
  // Only ever getRemoteDoorsJournal — no second query was introduced (RC2).
  assert.equal(
    (doors.match(/getRemoteDoorsJournal\(/g) ?? []).length,
    1,
    "DoorsJournal must not add a new query — the callback rides the existing fetch",
  );
  // The successful path surfaces the entry count.
  assert.match(doors, /onCountRef\.current\?\.\(next\.length\)/, "success fires onCount(next.length)");
  // Zero-state / no-auth / transport failure all surface 0 so the ribbon self-hides.
  assert.match(doors, /onCountRef\.current\?\.\(0\)/, "absent/failure fires onCount(0)");
});

test("onCount lives in a ref so the fetch effect deps (cadence) stay byte-identical", () => {
  assert.match(doors, /const onCountRef = useRef\(onCount\);/);
  assert.match(doors, /onCountRef\.current = onCount;/);
  // The fetch effect's dep array is UNCHANGED from before RB-COUNTS.
  assert.match(
    doors,
    /\}, \[auth\?\.accountId, auth\?\.guestTokenHash, saveId, sceneId, toast\]\);/,
    "the fetch effect deps must not gain onCount (byte-identical cadence)",
  );
});

test("the single DoorsJournal mount both reports the count AND owns the nudge (R3.3)", () => {
  // Code-review fix: the headless twin is gone — StoryRibbon's detail mount is
  // the ONE DoorsJournal per reader, so it reports upward AND fires the
  // one-shot key-arrival nudge. The old `!onCountRef.current` deferral would
  // silence the toast entirely with a single mount.
  assert.match(
    doors,
    /arrivals\.length > 0 && nudgedSceneRef\.current !== sceneId(?! && !onCountRef)/,
    "the nudge must NOT be gated on the onCount reporter",
  );
  // The one-shot nudge machinery itself is preserved.
  assert.match(doors, /keyArrivalToast\(arrivals\)/);
  assert.match(doors, /setExpanded\(true\)/);
});

test("DailyPulseChip exposes an OPTIONAL upward pulse-line callback surfacing the compact %", () => {
  // Code-review fix: the callback is (string | undefined) and fires on EVERY
  // change — undefined CLEARS the collapsed segment instead of leaving a stale
  // percentage after the pulse degrades to empty.
  assert.match(pulse, /onPulseLine\?:\s*\(\(line:\s*string\s*\|\s*undefined\)\s*=>\s*void\)\s*\|\s*undefined/);
  assert.match(pulse, /DailyPulseChip\(\{[^}]*onPulseLine[^}]*\}/);
  // The collapsed ribbon shows "62%" (§3 mock "· 62%"), not the full one-liner.
  assert.match(pulse, /`\$\{entry\.sharePct\}%`/, "the compact line is `${entry.sharePct}%`");
  assert.match(pulse, /onPulseLineRef\.current\?\.\(compactLine\)/, "it fires on every change, incl. undefined");
  assert.ok(
    !/if \(compactLine !== undefined\) onPulseLineRef/.test(pulse),
    "the fire must NOT be gated on a defined line (stale-segment bug)",
  );
  // Byte-identical fetch cadence: no new query, callback held in a ref.
  assert.equal((pulse.match(/getRemoteChoicePulse\(/g) ?? []).length, 1, "no new query (RC2)");
  assert.match(pulse, /const onPulseLineRef = useRef\(onPulseLine\);/);
});

test("ReaderScreen captures both callbacks into state and threads them to StoryRibbon", () => {
  assert.match(reader, /const \[ribbonDoorsCount, setRibbonDoorsCount\] = useState<number \| undefined>/);
  assert.match(reader, /const \[ribbonPulseLine, setRibbonPulseLine\] = useState<string \| undefined>/);
  // Code-review fix: no headless twins — StoryRibbon's OWN detail mounts
  // report upward; ReaderScreen threads the setters in as reporter props.
  assert.match(reader, /onDoorsCount=\{setRibbonDoorsCount\}/);
  assert.match(reader, /onPulseLine=\{setRibbonPulseLine\}/);
  assert.ok(
    !/<DoorsJournal\b/.test(reader),
    "ReaderScreen must not mount its own DoorsJournal twin (double-fetch)",
  );
  assert.ok(
    !/<DailyPulseChip\b/.test(reader),
    "ReaderScreen must not mount its own DailyPulseChip twin (double-fetch)",
  );
  // Conditional-spread optionals (exactOptionalPropertyTypes) into StoryRibbon.
  assert.match(
    reader,
    /\{\.\.\.\(ribbonDoorsCount !== undefined \? \{ doorsCount: ribbonDoorsCount \} : \{\}\)\}/,
    "doorsCount is threaded to StoryRibbon via a conditional spread",
  );
  assert.match(
    reader,
    /\{\.\.\.\(ribbonPulseLine !== undefined \? \{ pulseLine: ribbonPulseLine \} : \{\}\)\}/,
    "pulseLine is threaded to StoryRibbon via a conditional spread",
  );
});

test("StoryRibbon threads the reporter callbacks to its own detail mounts", () => {
  const ribbon = read("components/reading/chrome/StoryRibbon.tsx");
  assert.match(ribbon, /onCount: onDoorsCount/, "DoorsJournal gets the doors reporter");
  assert.match(ribbon, /\{ onPulseLine \}/, "DailyPulseChip gets the pulse reporter");
});

test("DoorsJournal is emoji-clean and speaks in the icon-font key glyph (R5 / RC5)", () => {
  for (const glyph of BANNED_EMOJI) {
    assert.ok(!doors.includes(glyph), `DoorsJournal must not contain the banned glyph ${glyph}`);
  }
  assert.match(doors, /import \{ Icon,/, "DoorsJournal must import the icon font");
  assert.match(doors, /<Icon name="key"/, "the doors pill must lead with the `key` glyph");
});
