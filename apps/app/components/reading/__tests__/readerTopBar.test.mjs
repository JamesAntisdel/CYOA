// a11y + glyph drift-guards for the reader top bar
// (components/reading/chrome/ReaderTopBar.tsx, R1 / RC6). Mounting the RN tree
// is out of scope for `node --test`, so these are source-level greps (same
// discipline as readerSaveActions.test.mjs / autoNarratorReader.test.mjs).
//
// This is the RC6 replacement drift-guard: it pins the top-bar affordances that
// take over from the removed AppNav + ReaderSaveActions surfaces — the exit
// glyph, the Tome trigger's glyph+text, the Auto pause indicator, the wick, the
// page-column constant, and the no-control-emoji rule (RC5).
//
// Run:
//   node --test apps/app/components/reading/__tests__/readerTopBar.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../chrome/ReaderTopBar.tsx"), "utf8");

test("exports PAGE_COLUMN_MAX = 760 for the shared page column (RC9/R7.1)", () => {
  // RC9 single-source (code-review fix): the canonical declaration lives in
  // ribbonSegments.ts; ReaderTopBar RE-EXPORTS it so import sites keep working
  // without a second copy that could drift.
  assert.match(
    source,
    /export \{ PAGE_COLUMN_MAX \} from "\.\/ribbonSegments";/,
    "ReaderTopBar must re-export the single PAGE_COLUMN_MAX from ribbonSegments",
  );
  assert.match(
    source,
    /maxWidth:\s*PAGE_COLUMN_MAX/,
    "the bar content must cap to PAGE_COLUMN_MAX (never viewport-stretched)",
  );
});

test("left exit uses the candle glyph with the 'Leave the tale' label (R1.1)", () => {
  assert.match(
    source,
    /accessibilityLabel="Leave the tale"/,
    "exit control must carry accessibilityLabel='Leave the tale'",
  );
  assert.match(source, /<Icon name="candle"/, "exit control must render the candle glyph");
});

test("the Tome trigger is the book glyph PLUS the 'Tome' text at every width (U2)", () => {
  assert.match(
    source,
    /accessibilityLabel="Tome"/,
    "the tome trigger must carry accessibilityLabel='Tome'",
  );
  assert.match(source, /<Icon name="book"/, "the tome trigger must render the book glyph");
  // The literal "Tome" text must be an unconditional JSX child — no breakpoint
  // may hide it (U2: the label is the coach mark).
  assert.match(
    source,
    /<Text[^>]*>\s*Tome\s*<\/Text>/,
    "the 'Tome' text label must render unconditionally beside the glyph",
  );
});

test("the Auto indicator pauses on tap and is present only when auto is ON (R1.2)", () => {
  assert.match(
    source,
    /accessibilityLabel="Pause auto-read"/,
    "the Auto indicator must carry accessibilityLabel='Pause auto-read'",
  );
  // Present only when the optional `auto` prop is passed (zero layout shift when
  // absent — the row height is fixed).
  assert.match(
    source,
    /\{auto \?/,
    "the Auto indicator must be gated on the optional `auto` prop",
  );
  assert.match(
    source,
    /onPress=\{auto\.onPause\}/,
    "tapping the Auto indicator must call auto.onPause (one-tap wheel-grab, RC4)",
  );
});

test("the wick reuses the Bar candle mode and renders only under showCandleMeter (RC2)", () => {
  assert.match(source, /\{wick \?/, "the wick must be gated on the optional `wick` prop");
  assert.match(
    source,
    /<Bar candle pct=/,
    "the wick must reuse the Bar primitive's candle mode",
  );
});

test("the bar is one text-row tall with 44px touch targets (R1.4)", () => {
  assert.match(source, /const TARGET = 44;/, "touch targets must clear the 44px floor");
  assert.match(source, /minHeight:\s*TARGET/, "the row must hold a fixed one-row minHeight");
});

test("no UI-control emoji in the top bar (RC5)", () => {
  // The flagged control-emoji set from the audit — none may appear in new chrome.
  for (const glyph of ["▶", "⏸", "⚙", "✦", "🚪", "🔒", "✓", "×", "←", "🕯", "🔥"]) {
    assert.ok(
      !source.includes(glyph),
      `ReaderTopBar must not contain the control emoji ${glyph} (RC5)`,
    );
  }
});
