// Drift-guards for the QW-LEGIBILITY QuestLine candle alignment: the prompt's
// clock escalation starts at 50% burned (clockDirective escalate_50), so the
// inline strip indicator must appear dimly from >=50% and go hot (flame) at
// >=75% — not stay hidden until 75% as it originally did. Source-level greps,
// matching the rest of components/reading/__tests__; the segment math itself
// is covered by the vitest suite (candleSegments).

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

test("QuestLine inline candle: dim from >=50%, hot flame at >=75%", () => {
  const src = read("components/reading/QuestLine.tsx");
  // Hot band still keys off the engine flame threshold (>=75%).
  assert.match(
    src,
    /const clockHot = clockModel\?\.flame \?\? false;/,
    "QuestLine hot band must key off candleSegments.flame (>=75%)",
  );
  // Dim band opens at 50% — aligned with the prompt's escalate_50 directive.
  assert.match(
    src,
    /clockModel\.pct >= 0\.5/,
    "QuestLine dim band must open at >=50% burn (clockDirective escalate_50)",
  );
  assert.match(
    src,
    /const clockDim = clockModel !== null && !clockHot && clockModel\.pct >= 0\.5;/,
    "QuestLine dim band must be mutually exclusive with the hot flame",
  );
  // Hot renders the inline CandleClock flame; dim renders the faint candle.
  assert.match(
    src,
    /\{clock && clockHot \? \(/,
    "QuestLine must render the hot inline CandleClock at >=75%",
  );
  assert.match(
    src,
    /clock && clockDim && clockModel \? \(/,
    "QuestLine must render the dim indicator between 50% and 75%",
  );
  assert.match(src, /🕯/, "the dim indicator must show the quiet candle glyph, not the flame");
  assert.match(
    src,
    /burning/,
    "the dim indicator's a11y label must say 'burning' (not 'urgent')",
  );
});
