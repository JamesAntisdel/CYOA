// Contract / drift guard for the-desk Wave 2 objects (task 2.1 — R2.1, R2.3,
// R3.1, R4.2/R4.3, DK3/DK6). Like DeskObject.test.mjs (and the other TSX drift
// guards in this repo) these components are TSX and cannot be rendered under
// `node --test`, so each test reads the component source by path and pins the
// load-bearing wiring: every object is built OVER DeskObject, carries its
// plain-words label + destination, uses ONLY existing assets/glyphs (no new
// image assets — R3.1), and honors its self-hide / dimmed rule (R2.3).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Read a sibling component's source with comments stripped, so prose in a
// doc-comment can never satisfy an assertion that must be met by REAL code.
function loadCode(name) {
  const src = readFileSync(resolve(here, `../${name}.tsx`), "utf8");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const sources = {
  Shelf: loadCode("Shelf"),
  OpenTome: loadCode("OpenTome"),
  Letter: loadCode("Letter"),
  Candle: loadCode("Candle"),
  KeyRing: loadCode("KeyRing"),
  Door: loadCode("Door"),
  StartHere: loadCode("StartHere"),
};

// ---------------------------------------------------------------------------
// Shared invariants — every object is built over DeskObject, uses tokens only,
// no raw hex, no control emoji, and imports no new bundled image assets. Cover
// PNGs arrive only via getStoryCoverSource (an EXISTING helper), never require().
// ---------------------------------------------------------------------------

for (const [name, code] of Object.entries(sources)) {
  test(`${name} is built over the shared DeskObject seam (DK5)`, () => {
    assert.match(code, /import\s*\{\s*DeskObject\s*\}\s*from\s*["']\.\/DeskObject["']/, `${name} must import DeskObject`);
    assert.match(code, /<DeskObject\b/, `${name} must render a DeskObject`);
  });

  test(`${name} passes a required plain-words label (R2.2)`, () => {
    assert.match(code, /\blabel=/, `${name} must pass a label to DeskObject`);
  });

  test(`${name} is art-light: no raw hex, no new image assets (R3.1/R3.3)`, () => {
    assert.doesNotMatch(code, /["'`]#[0-9a-fA-F]{3,8}["'`]/, `${name} must use tokens, not raw hex`);
    assert.doesNotMatch(
      code,
      /\brequire\(["'][^"']*\.(png|jpg|jpeg|webp|svg)["']\)/i,
      `${name} must not require a new image asset — covers come from getStoryCoverSource`,
    );
  });

  test(`${name} has no control emoji / decorative unicode (RC5)`, () => {
    const nonAscii = code.match(/[^\x00-\x7F]/g);
    assert.equal(nonAscii, null, `${name} found non-ASCII: ${JSON.stringify(nonAscii)}`);
  });
}

// ---------------------------------------------------------------------------
// Shelf — spines from the bundled covers -> /library.
// ---------------------------------------------------------------------------

test("Shelf: label Library, spines from getStoryCoverSource (R3.1)", () => {
  const code = sources.Shelf;
  assert.match(code, /label="Library"/, "Shelf label is the plain-words destination 'Library'");
  assert.match(code, /destination="Library/, "Shelf hints the Library destination");
  assert.match(code, /getStoryCoverSource\(/, "Shelf builds spines from the existing cover helper");
  assert.match(code, /storyIds:\s*string\[\]/, "Shelf takes story ids as props (DK4)");
});

// ---------------------------------------------------------------------------
// OpenTome — continue cover -> /read/[id]; closed/dimmed when no save (R2.3).
// ---------------------------------------------------------------------------

test("OpenTome: continue label + cover -> open save", () => {
  const code = sources.OpenTome;
  assert.match(code, /label=\{`Continue reading \$\{continueSave\.title\}`\}/, "labels 'Continue reading <title>'");
  assert.match(code, /getStoryCoverSource\(continueSave\.storyId\)/, "uses the continue save's cover");
  assert.match(code, /onOpenSave\(continueSave\.saveId\)/, "opens /read/[saveId] via onOpenSave");
});

test("OpenTome: dimmed closed tome when there is no in-progress save (R2.3)", () => {
  const code = sources.OpenTome;
  assert.match(code, /if\s*\(\s*!continueSave\s*\)/, "branches on the absent save");
  assert.match(code, /\bdimmed\b/, "the no-save tome is dimmed (closed/greyed)");
});

// ---------------------------------------------------------------------------
// Letter — the Daily; mirrors DailyCard destinations; self-hides (R2.3).
// ---------------------------------------------------------------------------

test("Letter: label Today's tale, mirrors DailyCard routing", () => {
  const code = sources.Letter;
  assert.match(code, /label="Today's tale"/, "Letter label is 'Today's tale'");
  assert.match(code, /DAILY_ALREADY_PLAYED/, "mirrors DailyCard's already-played race -> results");
  assert.match(code, /onOpenReader\(/, "routes into the reader on a fresh start");
  assert.match(code, /onOpenResults\(/, "routes to results (played / already-played)");
});

test("Letter: self-hides when there is no daily today (R2.3)", () => {
  const code = sources.Letter;
  assert.match(code, /if\s*\(\s*!daily\s*\)\s*return\s+null/, "renders null when no daily");
});

// ---------------------------------------------------------------------------
// Candle — turn budget from the existing glyph + Bar -> paywall (DK3/DK4).
// ---------------------------------------------------------------------------

test("Candle: label Today's turns, built from Icon candle + Bar (R3.1)", () => {
  const code = sources.Candle;
  assert.match(code, /label="Today's turns"/, "Candle label is 'Today's turns'");
  assert.match(code, /name="candle"/, "uses the existing candle glyph");
  assert.match(code, /<Bar\b[^>]*candle/, "uses the existing Bar in candle mode");
});

test("Candle: reuses the existing turn-state model, not a new query (DK4)", () => {
  const code = sources.Candle;
  assert.match(code, /candleBurnModel\(/, "derives the burn from the existing pure model");
  assert.match(code, /turnState\?:/, "turn-state is an optional prop (reused existing call, no new hook)");
  assert.doesNotMatch(code, /getRemoteDailyTurnState/, "the object does not fetch — DK-HOME passes props");
});

// ---------------------------------------------------------------------------
// KeyRing -> /endings ; Door -> /discover. Plain-words labels (R2.2).
// ---------------------------------------------------------------------------

test("KeyRing: label Trophies (-> /endings), key glyph", () => {
  const code = sources.KeyRing;
  assert.match(code, /label="Trophies"/, "KeyRing label is 'Trophies'");
  assert.match(code, /name="key"/, "uses the existing key glyph");
});

test("Door: label Discover (-> /discover)", () => {
  const code = sources.Door;
  assert.match(code, /label="Discover"/, "Door label is 'Discover'");
});

// ---------------------------------------------------------------------------
// StartHere — the MANDATORY tutorial-start funnel primary (R4.2/DK6).
// ---------------------------------------------------------------------------

test("StartHere: present + labels 'Start <tutorial>' (R4.2/DK6)", () => {
  const code = sources.StartHere;
  assert.match(code, /export function StartHere\b/, "StartHere must exist (funnel is mandatory — DK6)");
  assert.match(code, /`Start \$\{tutorialTitle\}`/, "labels 'Start <tutorial title>'");
  assert.match(code, /tutorialTitle\s*\?\s*`Start/, "falls back gracefully when there is no tutorial title");
});

test("StartHere: renders as the primary/most-prominent object (R4.2)", () => {
  const code = sources.StartHere;
  assert.match(code, /primary\s*=\s*true/, "primary defaults on — StartHere is the funnel primary");
  assert.match(code, /variant=\{primary\s*\?\s*["']base["']/, "primary => the bright base frame (prominence)");
});
