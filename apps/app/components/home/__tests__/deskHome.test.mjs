// Contract / drift guard for the-desk Wave 2, task 2.2 (DK-HOME): the DeskHome
// layout + the SINGLE gated branch in app/index.tsx (R2.1, R4, R5, R7,
// DK1/DK6/DK7/DK8).
//
// DeskHome.tsx and app/index.tsx are TSX and — like the other component
// drift-guards in this repo (DeskObject.test.mjs, deskObjects.test.mjs) —
// cannot be rendered under `node --test`. So this file reads each source by
// path and pins the load-bearing wiring:
//
//   1. The gated branch renders DeskHome ONLY when deskEnabled && !isPhone &&
//      width >= 768, placed AFTER the loading + AgeGate guards (DK1/DK7).
//   2. The env flag is read as a LITERAL process.env.EXPO_PUBLIC_DESK_HOME (DK2).
//   3. The flag-off / phone / <768 else path is the byte-identical card home —
//      the existing continueLead/hero/dailyCard/starter blocks are unchanged.
//   4. DeskHome mounts ALL the mandatory funnel objects (DK6): the tome
//      (continue) + StartHere (tutorial), the Letter (Daily), the Shelf
//      (library), the rank/progress read, and the guest soft-signup path
//      (AppNav). Candle/KeyRing/Door (the remaining R2 objects) also render.
//   5. Data is props-only — DeskHome introduces no hooks/queries (DK4).
//   6. Reduced-motion: no ambient motion in DeskHome (DK8).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function loadCode(relPath) {
  const src = readFileSync(resolve(here, relPath), "utf8");
  // Strip block + line comments so prose in a doc-comment can never satisfy an
  // assertion that must be met by REAL code.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const deskHome = loadCode("../DeskHome.tsx");
const indexRoute = loadCode("../../../app/index.tsx");

// ---------------------------------------------------------------------------
// app/index.tsx — the single gated branch (DK1/DK2/DK7).
// ---------------------------------------------------------------------------

test("index: imports the gate resolver + DeskHome", () => {
  assert.match(
    indexRoute,
    /import\s*\{\s*DeskHome\s*\}\s*from\s*["']\.\.\/components\/home\/DeskHome["']/,
    "must import DeskHome",
  );
  assert.match(
    indexRoute,
    /import\s*\{\s*resolveDeskEnabled\s*\}\s*from\s*["']\.\.\/components\/home\/deskGate["']/,
    "must import the pure gate resolver",
  );
});

test("index: the env flag is a LITERAL process.env read (DK2 — Expo inlines only literals)", () => {
  assert.match(
    indexRoute,
    /envFlag:\s*process\.env\.EXPO_PUBLIC_DESK_HOME/,
    "the env flag must be a literal process.env.EXPO_PUBLIC_DESK_HOME access",
  );
  assert.match(
    indexRoute,
    /settingOn:\s*settings\.deskHome/,
    "the setting must be the persisted deskHome reader setting",
  );
});

test("index: DeskHome renders ONLY when deskEnabled && !isPhone && width>=768 (DK7)", () => {
  assert.match(
    indexRoute,
    /if\s*\(\s*deskEnabled\s*&&\s*!isPhone\s*&&\s*viewportWidth\s*>=\s*768\s*\)/,
    "the branch condition must be deskEnabled && !isPhone && viewportWidth >= 768",
  );
  // The branch returns a DeskHome element.
  assert.match(indexRoute, /return\s*\(\s*[\s\S]*?<DeskHome\b/, "the branch returns <DeskHome>");
});

test("index: the desk branch sits AFTER the loading + AgeGate guards (DK1/R4.1)", () => {
  const loadingReturn = indexRoute.indexOf("Opening the cover");
  const ageGate = indexRoute.indexOf("<AgeGate");
  const deskBranch = indexRoute.indexOf("if ( deskEnabled") >= 0
    ? indexRoute.indexOf("if ( deskEnabled")
    : indexRoute.search(/if\s*\(\s*deskEnabled/);
  assert.ok(loadingReturn >= 0 && ageGate >= 0 && deskBranch >= 0, "all three markers present");
  assert.ok(
    deskBranch > loadingReturn && deskBranch > ageGate,
    "the desk branch must come AFTER both the loading guard and the AgeGate guard",
  );
});

test("index: the else path keeps the byte-identical card blocks (R7.1/DK1)", () => {
  // The existing card-home blocks the desk branch must NOT restructure — each
  // still lives verbatim in the file so a flag-off/phone reader hits them.
  for (const marker of [
    "const continueSave = library.continueSave;",
    "const returning = Boolean(continueSave);",
    "const dailyCardBlock = (",
    "const heroBlock = (",
    "const startRow = (",
    "const continueLead = continueSave ?",
    "Starter adventures",
  ]) {
    assert.ok(
      indexRoute.includes(marker),
      `the card-home block "${marker}" must remain untouched below the branch`,
    );
  }
});

test("index: the desk branch passes the reused home data + nav callbacks (DK4)", () => {
  // No new fetch introduced for the desk — it forwards what the route already
  // computes. Spot-check the load-bearing props.
  assert.match(indexRoute, /dailyToday=\{dailyToday\}/, "forwards the existing dailyToday");
  assert.match(indexRoute, /onOpenSave=\{openSave\}/, "forwards the existing openSave");
  assert.match(indexRoute, /startRemoteDaily\(\{\s*accountId/, "reuses the existing startRemoteDaily");
  assert.match(indexRoute, /tutorialTitle=\{tutorialStory\?\.title/, "forwards the existing tutorialStory title");
  assert.match(indexRoute, /reducedMotion=\{reduceMotion/, "threads reduced-motion (DK8)");
});

// ---------------------------------------------------------------------------
// DeskHome.tsx — the layout mounts every mandatory funnel object (DK6).
// ---------------------------------------------------------------------------

test("DeskHome: mounts the mandatory funnel objects — tome, StartHere, Letter, Shelf (DK6)", () => {
  for (const obj of ["OpenTome", "StartHere", "Letter", "Shelf"]) {
    assert.match(deskHome, new RegExp(`<${obj}\\b`), `DeskHome must mount <${obj}> (funnel — DK6)`);
    assert.match(
      deskHome,
      new RegExp(`import\\s*\\{[^}]*\\b${obj}\\b`),
      `DeskHome must import ${obj}`,
    );
  }
});

test("DeskHome: mounts the remaining R2 desk objects — Candle, KeyRing, Door (R2.1)", () => {
  for (const obj of ["Candle", "KeyRing", "Door"]) {
    assert.match(deskHome, new RegExp(`<${obj}\\b`), `DeskHome must mount <${obj}> (R2.1)`);
  }
});

test("DeskHome: BOTH the tome and StartHere are always in the tree (funnel intact either way — DK6)", () => {
  // The save/no-save fork renders OpenTome + StartHere on both arms, so the
  // continue AND tutorial funnel objects are present whether or not a save
  // exists. Count the JSX occurrences: two of each (one per fork arm).
  const tomeCount = (deskHome.match(/<OpenTome\b/g) ?? []).length;
  const startCount = (deskHome.match(/<StartHere\b/g) ?? []).length;
  assert.ok(tomeCount >= 2, "OpenTome must render on both the save and no-save arms");
  assert.ok(startCount >= 2, "StartHere must render on both the save and no-save arms");
});

test("DeskHome: StartHere is the PRIMARY when there is no in-progress save (R4.2)", () => {
  // hasSave === false arm passes primary; the has-save arm demotes (primary={false}).
  assert.match(deskHome, /\bprimary\s*\n\s*tutorialTitle/, "StartHere is primary on the no-save arm");
  assert.match(deskHome, /primary=\{false\}/, "StartHere is demoted (primary={false}) on the has-save arm");
});

test("DeskHome: surfaces the rank/progress read (DK6)", () => {
  assert.match(deskHome, /librarianRankProgressLine\(/, "renders the rank progress line");
  assert.match(deskHome, /librarianRankChipLabel\(/, "names the rank in the a11y label");
});

test("DeskHome: surfaces the guest soft-signup path via AppNav (DK6)", () => {
  assert.match(deskHome, /<AppNav\b/, "AppNav (the Login/soft-signup path) is on the desk");
});

test("DeskHome: data is props-only — no hooks/queries introduced (DK4)", () => {
  assert.doesNotMatch(
    deskHome,
    /useLibrary\(|useAccountProfile\(|getRemoteDailyToday\(|getRemoteDailyTurnState\(|useGuestSession\(/,
    "DeskHome must not fetch/own home data — it takes props (DK4)",
  );
});

test("DeskHome: reduced-motion — no ambient motion in the layout (DK8)", () => {
  assert.doesNotMatch(
    deskHome,
    /\bAnimated\b|useSharedValue|withTiming|withRepeat|Easing/,
    "the desk is still — no ambient motion (a reduced-motion reader gets an identical desk)",
  );
});

test("DeskHome: art-light — no raw hex, no new image assets (R3.1/R3.3)", () => {
  assert.doesNotMatch(deskHome, /["'`]#[0-9a-fA-F]{3,8}["'`]/, "tokens only, no raw hex");
  assert.doesNotMatch(
    deskHome,
    /\brequire\(["'][^"']*\.(png|jpg|jpeg|webp|svg)["']\)/i,
    "no new bundled image assets — objects carry their own existing covers/glyphs",
  );
});

test("DeskHome: no control emoji / decorative unicode (RC5)", () => {
  const nonAscii = deskHome.match(/[^\x00-\x7F]/g);
  assert.equal(nonAscii, null, `no control emoji allowed; found ${JSON.stringify(nonAscii)}`);
});
