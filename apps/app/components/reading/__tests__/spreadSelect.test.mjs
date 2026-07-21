// open-book Wave 1 (Agent OB-SELECT) — the wide-select matrix.
//
// The load-bearing selection logic (open-book R1.2–R1.4, OB2/OB3): at a
// genuinely wide viewport (≥ SPREAD_MIN 1024) the reader auto-selects the
// two-page `spread`, reusing the SAME explicit-override machinery that today
// auto-selects `mobile` on a phone. This file exercises the REAL pure
// selector `selectReaderLayout` (lib/responsive.ts) over the full matrix:
//
//   { phone / tablet / 768–1023 / ≥1024 / ultrawide }
//     × { explicit-override on, off }
//     × { stored book / journal / illustratedBook }
//
// plus the critical PIN: below 1024, the resolved layout is BYTE-IDENTICAL to
// the pre-open-book behavior (today's phone→mobile-else-stored logic).
//
// Like pageTurn.test.mjs, node --test cannot import .ts on Node 20, so the
// module is transpiled on the fly (types stripped) and imported via a data:
// URL. responsive.ts imports `useWindowDimensions` from react-native at module
// scope; we neutralize that single import before transpiling (the pure exports
// under test never touch it), so no react-native resolution is needed.
//
// Run:
//   node --test apps/app/components/reading/__tests__/spreadSelect.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../../..");
const read = (rel) => readFileSync(resolve(appRoot, rel), "utf8");

const require = createRequire(import.meta.url);
const ts = require("typescript");

const responsiveSrc = read("lib/responsive.ts");
// Neutralize the only react-native import so the transpiled module imports
// nothing external. `useWindowDimensions` is referenced solely by
// `useBreakpoint`, which the pure tests never call.
const neutralized = responsiveSrc.replace(
  /import\s*\{\s*useWindowDimensions\s*\}\s*from\s*["']react-native["'];?/,
  "const useWindowDimensions = () => ({ width: 0 });",
);
assert.ok(
  neutralized !== responsiveSrc,
  "expected to find the react-native useWindowDimensions import to neutralize — did responsive.ts change its import shape?",
);

const { outputText } = ts.transpileModule(neutralized, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});
const mod = await import("data:text/javascript," + encodeURIComponent(outputText));

const { SPREAD_MIN, SPREAD_MAX, selectReaderLayout, isWideWidth, breakpointFor } = mod;

// ── Constants (OB2) ─────────────────────────────────────────────────────────

test("SPREAD_MIN is 1024 (two facing pages need real width, NOT isDesktop's 768)", () => {
  assert.equal(SPREAD_MIN, 1024);
});

test("SPREAD_MAX is 1400 (the centered cap for an ultrawide, R2.2)", () => {
  assert.equal(SPREAD_MAX, 1400);
});

test("isWideWidth flips exactly at SPREAD_MIN", () => {
  assert.equal(isWideWidth(1023), false);
  assert.equal(isWideWidth(1024), true);
  assert.equal(isWideWidth(1440), true);
  assert.equal(isWideWidth(375), false);
});

// ── The pure selector: the exact call shape ReaderScreen uses ────────────────
//
// resolveActiveLayout delegates to this with mobileVariant "mobile" /
// spreadVariant "spread"; isPhone comes from useBreakpoint (width < 520).
const pick = (storedLayout, { width, hasExplicitOverride }) =>
  selectReaderLayout({
    storedLayout,
    isPhone: width < 520, // matches BREAKPOINTS.phone / useBreakpoint's isPhone
    width,
    hasExplicitOverride,
    mobileVariant: "mobile",
    spreadVariant: "spread",
  });

// Representative viewports across every band.
const VIEWPORTS = {
  phone: 375, // < 520
  tabletLow: 520, // BREAKPOINTS.phone boundary — first non-phone width
  tabletHigh: 767, // < 768
  desktopNarrow: 900, // 768 ≤ w < 1024 — desktop but NOT wide enough for a spread
  spreadEdge: 1024, // == SPREAD_MIN
  ultrawide: 1440,
};
const STORED = ["book", "journal", "illustratedBook"];

// ── Explicit override OFF: the auto-override ladder ──────────────────────────

for (const stored of STORED) {
  test(`no override, phone → mobile (stored "${stored}" ignored)`, () => {
    assert.equal(pick(stored, { width: VIEWPORTS.phone, hasExplicitOverride: false }), "mobile");
  });

  test(`no override, tablet/desktop-narrow (<1024) → stored "${stored}" (unchanged)`, () => {
    assert.equal(pick(stored, { width: VIEWPORTS.tabletLow, hasExplicitOverride: false }), stored);
    assert.equal(pick(stored, { width: VIEWPORTS.tabletHigh, hasExplicitOverride: false }), stored);
    assert.equal(pick(stored, { width: VIEWPORTS.desktopNarrow, hasExplicitOverride: false }), stored);
  });

  test(`no override, width ≥ SPREAD_MIN → spread (stored "${stored}" auto-overridden)`, () => {
    assert.equal(pick(stored, { width: VIEWPORTS.spreadEdge, hasExplicitOverride: false }), "spread");
    assert.equal(pick(stored, { width: VIEWPORTS.ultrawide, hasExplicitOverride: false }), "spread");
  });
}

// ── Explicit override ON: the reader's pick ALWAYS wins, at any width ─────────

for (const stored of STORED) {
  for (const [band, width] of Object.entries(VIEWPORTS)) {
    test(`explicit override wins: stored "${stored}" honored at ${band} (${width}px)`, () => {
      assert.equal(pick(stored, { width, hasExplicitOverride: true }), stored);
    });
  }
}

// A reader who explicitly picked `spread` keeps it below 1024 — the graceful
// fallback to a single page is the Spread layout's job (R1.4), NOT the
// selector's; the selector must still hand back "spread" so nothing else
// silently reroutes their pick.
test("explicit spread pick is preserved even below SPREAD_MIN (fallback is the layout's job)", () => {
  assert.equal(pick("spread", { width: VIEWPORTS.desktopNarrow, hasExplicitOverride: true }), "spread");
  assert.equal(pick("spread", { width: VIEWPORTS.phone, hasExplicitOverride: true }), "spread");
});

// `spread` is NEVER auto-selected below 1024 (R1.4).
test("spread is never auto-selected below SPREAD_MIN", () => {
  for (const width of [375, 520, 767, 900, 1023]) {
    assert.notEqual(
      pick("book", { width, hasExplicitOverride: false }),
      "spread",
      `width ${width} must not auto-select spread`,
    );
  }
});

// ── THE PIN: below 1024, byte-identical to the pre-open-book resolver ─────────

// The exact logic that shipped BEFORE this task (ReaderScreen resolveActiveLayout):
//   if (!isPhone) return stored;
//   if (hasExplicitOverride) return stored;
//   return "mobile";
const legacyResolve = (stored, { width, hasExplicitOverride }) => {
  const isPhone = width < 520;
  if (!isPhone) return stored;
  if (hasExplicitOverride) return stored;
  return "mobile";
};

test("below SPREAD_MIN the new selector matches the legacy resolver exactly (byte-identical)", () => {
  for (const stored of STORED) {
    for (const hasExplicitOverride of [false, true]) {
      for (const width of [0, 375, 519, 520, 700, 767, 768, 900, 1023]) {
        assert.equal(
          pick(stored, { width, hasExplicitOverride }),
          legacyResolve(stored, { width, hasExplicitOverride }),
          `divergence at stored=${stored} override=${hasExplicitOverride} width=${width}`,
        );
      }
    }
  }
});

// ── breakpointFor is untouched (desktop still tops out at 768) ────────────────

test("breakpointFor is unchanged — desktop still starts at 768, not SPREAD_MIN", () => {
  assert.equal(breakpointFor(519), "phone");
  assert.equal(breakpointFor(520), "tablet");
  assert.equal(breakpointFor(767), "tablet");
  assert.equal(breakpointFor(768), "desktop");
  assert.equal(breakpointFor(1024), "desktop"); // wide is a slice of desktop, not a new breakpoint
});

// ── Source-drift pins: the wiring in the .tsx / .ts files ─────────────────────

test("ReaderScreen threads viewport width into resolveActiveLayout and delegates to selectReaderLayout", () => {
  const src = read("components/reading/ReaderScreen.tsx");
  assert.match(
    src,
    /const\s*\{\s*isPhone\s*,\s*width\s*\}\s*=\s*useBreakpoint\(\)/,
    "ReaderScreen must destructure width from useBreakpoint (the raw viewport width the spread threshold needs)",
  );
  assert.match(
    src,
    /resolveActiveLayout\(\s*settings\.layout\s*,\s*\{\s*isPhone\s*,\s*width\s*\}\s*\)/,
    "resolveActiveLayout call site must pass { isPhone, width }",
  );
  assert.match(
    src,
    /selectReaderLayout\(\{/,
    "resolveActiveLayout must delegate to the pure selectReaderLayout so the matrix is testable",
  );
  assert.match(
    src,
    /spreadVariant:\s*["']spread["']/,
    "resolveActiveLayout must pass spreadVariant: 'spread'",
  );
  // The dispatch keeps the '?? READER_LAYOUTS.book' guard so a missing spread
  // entry can never crash the reader (OB3).
  assert.match(
    src,
    /READER_LAYOUTS\[activeLayout\]\s*\?\?\s*READER_LAYOUTS\.book/,
    "dispatch must retain the '?? READER_LAYOUTS.book' fallback guard",
  );
});

test("useReaderSettings registers the spread variant (type union + runtime array)", () => {
  const src = read("hooks/useReaderSettings.ts");
  // The runtime array feeds isLayoutVariant, so a stored "spread" round-trips.
  assert.match(
    src,
    /READER_LAYOUT_VARIANTS[\s\S]*?"spread"[\s\S]*?\]/,
    "READER_LAYOUT_VARIANTS must include 'spread' (so isLayoutVariant accepts a persisted spread pick)",
  );
  assert.match(
    src,
    /ReaderLayoutVariant\s*=[\s\S]*?\|\s*"spread"/,
    "the ReaderLayoutVariant union must include 'spread'",
  );
});

test("layouts registry has a spread entry (Wave 1 placeholder → BookLayout, no crash)", () => {
  const src = read("components/reading/layouts/index.ts");
  assert.match(
    src,
    /spread:\s*\w+Layout/,
    "READER_LAYOUTS must register a 'spread' entry so the exhaustive Record typechecks and a wide reader renders a page (Wave 2 swaps in the real SpreadLayout)",
  );
});
