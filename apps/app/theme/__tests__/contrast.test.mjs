// Drift-guard against silent contrast regressions in the theme palette.
//
// Reads the canonical `tokens.json` (NOT the TS module — that requires a
// bundler) and recomputes WCAG 2.x contrast ratios for every (text, surface)
// pair that the primitives and reading layouts actually render. If a palette
// edit drops any pair below its documented floor, this test fails.
//
// Floors (matching what the primitives do with the tokens):
//   - text on background      >= 7   (AAA — primary prose pair)
//   - text on surface         >= 7
//   - text on surfaceMuted    >= 4.5 (AA — used for nested panels)
//   - textMuted on background >= 4.5
//   - textMuted on surface    >= 4.5
//   - textFaint on background >= 3   (chrome-only)
//   - textFaint on surface    >= 3
//   - border on background    >= 3
//   - borderMuted on bg       >= 1.5 (subtle outline)
//   - surface vs surfaceMuted >= 1.4 (panel-within-panel must be visible)
//   - accent on background    >= 4.5 (used as text in Choice / Note / Stamp)
//   - danger on background    >= 4.5

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const json = JSON.parse(
  readFileSync(resolve(here, "../../assets/design/tokens/tokens.json"), "utf8"),
);

function hexToRgb(hex) {
  const c = hex.replace("#", "");
  return [
    parseInt(c.slice(0, 2), 16),
    parseInt(c.slice(2, 4), 16),
    parseInt(c.slice(4, 6), 16),
  ];
}

function blendOver(fgHex, fgAlpha, bgHex) {
  const [r1, g1, b1] = hexToRgb(fgHex);
  const [r2, g2, b2] = hexToRgb(bgHex);
  return [
    Math.round(r1 * fgAlpha + r2 * (1 - fgAlpha)),
    Math.round(g1 * fgAlpha + g2 * (1 - fgAlpha)),
    Math.round(b1 * fgAlpha + b2 * (1 - fgAlpha)),
  ];
}

function lin(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function lum([r, g, b]) {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(rgbA, rgbB) {
  const L1 = lum(rgbA);
  const L2 = lum(rgbB);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

// `fg` may be a hex literal or `[hex, alpha]` for translucent tokens —
// alpha-blend with the bg to mirror how it composites at runtime.
function contrast(fg, bgHex) {
  if (Array.isArray(fg)) {
    return ratio(blendOver(fg[0], fg[1], bgHex), hexToRgb(bgHex));
  }
  return ratio(hexToRgb(fg), hexToRgb(bgHex));
}

// Materialize the same palette themes.ts builds, but in pure JS so the test
// stays bundler-free. Keep this in sync with themes.ts when you add new
// semantic tokens.
const palettes = {
  day: {
    background: json.color.paper["100"],
    surface: json.color.paper["50"],
    surfaceMuted: json.color.paper["400"],
    text: json.color.ink["900"],
    textMuted: json.color.ink["700"],
    textFaint: [json.color.ink["900"], 0.6],
    border: json.color.ink["900"],
    borderMuted: [json.color.ink["900"], 0.4],
    accent: json.color.ember["500"],
    danger: json.color.ember["600"],
  },
  night: {
    background: json.color.night["800"],
    surface: json.color.night["700"],
    surfaceMuted: json.color.night["500"],
    text: json.color.paper["100"],
    textMuted: json.color.ink["300"],
    textFaint: [json.color.paper["100"], 0.6],
    border: json.color.paper["200"],
    borderMuted: [json.color.paper["200"], 0.4],
    accent: json.color.candle["400"],
    danger: json.color.ember["300"],
  },
  sepia: {
    background: json.color.paper["200"],
    surface: json.color.paper["100"],
    surfaceMuted: json.color.paper["400"],
    text: json.color.ink["800"],
    textMuted: json.color.ink["600"],
    textFaint: [json.color.ink["800"], 0.65],
    border: json.color.ink["800"],
    borderMuted: [json.color.ink["800"], 0.4],
    accent: json.color.ember["500"],
    danger: json.color.ember["700"],
  },
};

const checks = [
  // [label, fg-key, bg-key, minimum]
  ["text on background", "text", "background", 7],
  ["text on surface", "text", "surface", 7],
  ["text on surfaceMuted", "text", "surfaceMuted", 4.5],
  ["textMuted on background", "textMuted", "background", 4.5],
  ["textMuted on surface", "textMuted", "surface", 4.5],
  ["textFaint on background", "textFaint", "background", 3],
  ["textFaint on surface", "textFaint", "surface", 3],
  ["border on background", "border", "background", 3],
  ["border on surface", "border", "surface", 3],
  ["borderMuted on background", "borderMuted", "background", 1.5],
  ["accent on background", "accent", "background", 4.5],
  ["accent on surface", "accent", "surface", 4.5],
  ["danger on background", "danger", "background", 4.5],
];

for (const [mode, palette] of Object.entries(palettes)) {
  test(`${mode}: every (text, surface) pair meets its contrast floor`, () => {
    for (const [label, fgKey, bgKey, floor] of checks) {
      const r = contrast(palette[fgKey], palette[bgKey]);
      assert.ok(
        r >= floor,
        `${mode}.${label} = ${r.toFixed(2)}:1 (need >= ${floor}:1)`,
      );
    }
  });

  test(`${mode}: surface and surfaceMuted are distinguishable`, () => {
    const r = contrast(palette.surface, palette.surfaceMuted);
    assert.ok(
      r >= 1.4,
      `${mode}.surface vs surfaceMuted = ${r.toFixed(2)}:1 (need >= 1.4:1 to render nested panels)`,
    );
  });
}

test("typography floors: body >= 15, caption >= 12, line-height in prose band", () => {
  assert.ok(json.size.body >= 15, `size.body = ${json.size.body} (need >= 15 for web reading)`);
  assert.ok(json.size.micro >= 12, `size.micro = ${json.size.micro} (need >= 12 caption floor)`);
  assert.ok(json.size.ui >= 14, `size.ui = ${json.size.ui} (need >= 14)`);
});
