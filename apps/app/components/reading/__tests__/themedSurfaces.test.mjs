// Drift guard: every reader surface must theme through the token layer.
//
// The user-reported symptom that motivated this test: "contrast bad in
// many modes" — which traced back to the map page, the history page, and
// the endings/trophy surfaces hardcoding a sepia palette via inline hex.
// In the day and night themes those hexes looked wrong because the rest
// of the app had already moved to `useAppTheme().tokens.colors.*`.
//
// This file scans the load-bearing reader, choice, stats, death, ending,
// and save-scoped page files for two things:
//   1. No raw 3- or 6-digit hex color strings (`#abc` or `#abcdef`).
//   2. Each layout source imports a Theme primitive or `useAppTheme` so
//      the file is wired into the theme pipeline at all.
//
// When a new file lands in one of the listed directories, add it here.
// When the test fails: replace the hex with `tokens.colors.*` instead of
// adding the file to an ignore list.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../../..");

// Files that MUST be theme-token-driven. Comment lines (`// #300`) and
// string literals inside JS comments are fine — we only flag `#xxx` /
// `#xxxxxx` patterns that occur in a colon-prefixed style context
// (e.g. `color: "#abc"`, `backgroundColor: "#abcdef"`).
const themedFiles = [
  // Reader chrome + layouts
  "components/reading/ReaderScreen.tsx",
  "components/reading/ProseRenderer.tsx",
  "components/reading/DialogLine.tsx",
  "components/reading/EffectBadge.tsx",
  "components/reading/ChapterEnd.tsx",
  "components/reading/ConsequenceReel.tsx",
  "components/reading/layouts/Book.tsx",
  "components/reading/layouts/ModernApp.tsx",
  "components/reading/layouts/GraphicNovel.tsx",
  "components/reading/layouts/Journal.tsx",
  "components/reading/layouts/Mobile.tsx",
  // Choice cards + freeform input
  "components/choices/ChoiceList.tsx",
  "components/choices/FreeformChoice.tsx",
  "components/choices/LockedChoiceCopy.tsx",
  // Stats HUD + roster
  "components/stats/StatsHud.tsx",
  "components/stats/StatPip.tsx",
  "components/stats/NpcRoster.tsx",
  "components/stats/modes/Persistent.tsx",
  "components/stats/modes/PeekDrawer.tsx",
  "components/stats/modes/Contextual.tsx",
  "components/stats/modes/FullSheet.tsx",
  // Endings + trophies
  "components/endings/EndingsMap.tsx",
  "components/endings/TrophyCrypt.tsx",
  // Death panels
  "components/death/EndingPanel.tsx",
  "components/death/variants/Brutal.tsx",
  "components/death/variants/Bookish.tsx",
  "components/death/variants/Cinematic.tsx",
  // Save-scoped meta pages
  "app/map/[saveId]/index.tsx",
  "app/read/[saveId]/history/index.tsx",
  // Landing / library / endings entry pages — added after the user hit
  // "tan text on tan background" on every theme except sepia. Each of
  // these routes used to inline the full sepia palette in
  // `StyleSheet.create` so child components that consume `tokens.colors.*`
  // (e.g. ContinueReading's `<Text variant="subtitle">`) rendered Night
  // ink on a hardcoded sepia surface in Day mode. Drift-guarding them
  // here means the next contributor can't reintroduce raw hex.
  "app/index.tsx",
  "app/library/index.tsx",
  "app/endings/index.tsx",
];

// Hex color literal in a style context. We look for `: "#xxx"` /
// `: "#xxxxxx"` (and the single-quote / template-string variants) so we
// don't flag `React error #300` style comments. The colon makes this
// JSX-style-object-specific.
const HEX_IN_STYLE = /:\s*["'`]#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/;

// Reader layouts and meta pages must wire into the theme pipeline at all
// — either by importing `useAppTheme` directly or by importing from the
// primitives barrel (every primitive consumes useAppTheme internally).
const THEME_WIRE = /useAppTheme|from\s+["']\.\.\/.+\/primitives|from\s+["']\.\.\/primitives|from\s+["']\.\.\/\.\.\/primitives|from\s+["']\.\.\/\.\.\/\.\.\/components\/primitives|from\s+["']\.\.\/\.\.\/\.\.\/\.\.\/components\/primitives/;

for (const rel of themedFiles) {
  const abs = resolve(appRoot, rel);
  test(`${rel} contains no inline hex color literals`, () => {
    const source = readFileSync(abs, "utf8");
    const match = HEX_IN_STYLE.exec(source);
    assert.equal(
      match,
      null,
      match
        ? `Found inline hex in style context: ${match[0]} — replace with tokens.colors.*`
        : undefined,
    );
  });

  test(`${rel} routes through the theme pipeline`, () => {
    const source = readFileSync(abs, "utf8");
    assert.match(
      source,
      THEME_WIRE,
      `${rel} must import useAppTheme or a Theme primitive`,
    );
  });
}
