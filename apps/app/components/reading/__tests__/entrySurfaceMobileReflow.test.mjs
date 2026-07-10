// Drift guard: entry surfaces (landing, library, creator, discover) must
// branch off the shared mobile breakpoint helper.
//
// The mobile-reflow agent owns these files (apps/app/app/index.tsx,
// apps/app/app/library/index.tsx, apps/app/app/creator/index.tsx,
// apps/app/app/discover/index.tsx, plus a small number of supporting
// components). The user reported cramped 2-column story-card rows at
// 375px viewport — the fix routes through `useBreakpoint()` from
// `apps/app/lib/responsive.ts` so phone-width screens fold cover+body
// into a stacked column.
//
// What this file guards against:
//   1. Each owned entry-surface route imports useBreakpoint (no
//      regression to a hardcoded desktop layout).
//   2. The landing hero panel does NOT pin a fixed `height: 420`. That
//      was the original tablet/desktop-only constraint that crowded
//      portrait phones; the replacement uses `minHeight` so the panel
//      can size to content.
//   3. The shared `apps/app/lib/responsive.ts` helper exists and exports
//      `useBreakpoint`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../../..");

const ENTRY_SURFACES = [
  "app/index.tsx",
  "app/library/index.tsx",
  "app/creator/index.tsx",
  "app/discover/index.tsx",
];

function readSource(relative) {
  return readFileSync(resolve(appRoot, relative), "utf8");
}

test("shared responsive helper exists at apps/app/lib/responsive.ts", () => {
  const helperPath = resolve(appRoot, "lib/responsive.ts");
  assert.ok(existsSync(helperPath), "lib/responsive.ts must exist");
  const source = readFileSync(helperPath, "utf8");
  assert.match(source, /export function useBreakpoint/, "useBreakpoint must be exported");
  // Breakpoint thresholds we agreed on: phone <520, tablet <768, desktop ≥768.
  assert.match(source, /520/, "phone breakpoint (520) missing");
  assert.match(source, /768/, "tablet breakpoint (768) missing");
});

for (const rel of ENTRY_SURFACES) {
  test(`${rel} uses useBreakpoint() for mobile reflow`, () => {
    const source = readSource(rel);
    assert.match(
      source,
      /useBreakpoint\s*\(/,
      `${rel} must call useBreakpoint() — direct useWindowDimensions or hardcoded layout is a regression`,
    );
    assert.match(
      source,
      /from\s+["'][^"']*\/lib\/responsive["']/,
      `${rel} must import useBreakpoint from the shared lib/responsive helper`,
    );
  });
}

test("landing hero cover does NOT hardcode height: 420", () => {
  // The original landing had `height: 420` on the cover panel which made
  // the panel taller than a portrait phone viewport could spare. The
  // mobile-friendly layout uses `minHeight` (and lets the OG image's
  // 1200x630 aspect ratio drive total height).
  const source = readSource("app/index.tsx");
  assert.ok(
    !/height:\s*420\b/.test(source),
    "Landing hero panel still pins height: 420 — replace with minHeight + aspectRatio",
  );
});

test("library story cards drop fixed height in favor of minHeight", () => {
  // Story cards used to pin `height: 170 / 220 / 178` which fought against
  // the responsive reflow. The current pattern is a horizontal row card
  // on every viewport with a COMPACT slipcase on phone (96 px) vs the
  // 128 px desktop slipcase — earlier attempts at column-stacking on
  // phone produced ~500 px-tall cards that ate the whole iPhone SE
  // screen (user reported "way too big" 2026-05-26). The narrow phone
  // slipcase keeps each card 3+ titles above the fold.
  const source = readSource("app/library/index.tsx");
  assert.ok(
    !/height:\s*(170|178|220)\b/.test(source),
    "library cards must not pin a fixed pixel height (use minHeight + content sizing instead)",
  );
  // Slipcase width must shrink on phone — drift here would re-introduce the
  // wasted side-rail space the user reported.
  assert.match(
    source,
    /width:\s*isPhone\s*\?\s*96\s*:\s*128/,
    "library slipcase must shrink to 96 px on phone (was 128 unconditionally)",
  );
});

test("SeedToneSelector tone pills wrap one-per-row on phone", () => {
  // The tone-pill grid was `flexBasis: "47%"` + `minWidth: 160` which
  // produced two cramped pills per 375px viewport row. The reflow
  // switches to `flexBasis: "100%"` on phones so each pill gets the
  // full width and the helper description has room.
  const source = readSource("components/creator/SeedToneSelector.tsx");
  assert.match(
    source,
    /flexBasis:\s*isPhone\s*\?\s*["']100%["']/,
    "SeedToneSelector must give each pill full width on phone",
  );
});
