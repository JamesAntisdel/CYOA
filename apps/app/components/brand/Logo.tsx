import { createElement, ReactNode } from "react";
import { Platform, Text, View, ViewProps } from "react-native";

import { primitiveTokens, useAppTheme } from "../../theme";

/**
 * Production brand mark for The Unwritten.
 *
 * Variants:
 *   - `wordmark` — "The Unwritten" italic display type, alone.
 *   - `lockup` — candle glyph + wordmark + tagline (the canonical signature).
 *   - `glyph` — candle glyph alone.
 *   - `seal` — circular gradient seal with "TU" mark (covers, hero ornaments).
 *
 * Each variant sources from the canonical SVGs under
 * `apps/app/assets/design/logos/`. On web (react-native-web) we emit inline
 * SVG so the marks render losslessly. On native we render the same paths
 * once `react-native-svg` is wired in (wave 0 follow-up); until then we fall
 * back to a styled text rendering that preserves layout.
 */

export type LogoVariant = "wordmark" | "lockup" | "glyph" | "seal";
export type LogoTone = "dark" | "light";

export type LogoProps = ViewProps & {
  variant?: LogoVariant;
  tone?: LogoTone;
  /** Pixel height of the logo. Width is derived from the canonical aspect ratio. */
  size?: number;
};

const ASPECT: Record<LogoVariant, number> = {
  wordmark: 320 / 56,
  lockup: 380 / 60,
  glyph: 1,
  seal: 1,
};

const PALETTE = {
  dark: {
    stroke: primitiveTokens.color.ink[900],
    text: primitiveTokens.color.ink[900],
    tagline: primitiveTokens.color.ink[600],
    flameFill: primitiveTokens.color.ember[500],
  },
  light: {
    stroke: primitiveTokens.color.paper[100],
    text: primitiveTokens.color.paper[100],
    tagline: primitiveTokens.color.candle[400],
    flameFill: primitiveTokens.color.candle[400],
  },
} as const;

export function Logo({ variant = "lockup", tone = "dark", size = 48, style, ...props }: LogoProps) {
  const { tokens } = useAppTheme();
  const width = Math.round(size * ASPECT[variant]);
  const palette = PALETTE[tone];

  if (Platform.OS === "web") {
    return (
      <View
        accessibilityLabel="The Unwritten"
        accessibilityRole="image"
        style={[{ width, height: size }, style]}
        {...props}
      >
        {renderWebVariant(variant, palette, width, size)}
      </View>
    );
  }

  // Native fallback — text-based mark until react-native-svg lands.
  return (
    <View
      accessibilityLabel="The Unwritten"
      accessibilityRole="image"
      style={[{ width, height: size, justifyContent: "center" }, style]}
      {...props}
    >
      <Text
        style={{
          color: palette.text,
          fontFamily: tokens.typography.families.serif,
          fontSize: Math.round(size * 0.65),
          fontStyle: "italic",
        }}
      >
        The Unwritten
      </Text>
    </View>
  );
}

function renderWebVariant(
  variant: LogoVariant,
  palette: (typeof PALETTE)[LogoTone],
  width: number,
  height: number,
): ReactNode {
  switch (variant) {
    case "wordmark":
      return createElement(
        "svg" as never,
        {
          xmlns: "http://www.w3.org/2000/svg",
          viewBox: "0 0 320 56",
          width,
          height,
          role: "img",
          "aria-label": "The Unwritten",
          style: { display: "block" },
        },
        createElement(
          "text" as never,
          {
            x: 0,
            y: 36,
            "font-family": primitiveTokens.font.display,
            "font-size": 44,
            "font-weight": 500,
            "font-style": "italic",
            fill: palette.text,
            "letter-spacing": -0.5,
          },
          "The Unwritten",
        ),
      );

    case "glyph":
      return createElement(
        "svg" as never,
        {
          xmlns: "http://www.w3.org/2000/svg",
          viewBox: "0 0 56 56",
          width,
          height,
          role: "img",
          "aria-label": "The Unwritten",
          style: { display: "block" },
        },
        createElement(
          "g" as never,
          {
            fill: "none",
            stroke: palette.stroke,
            "stroke-width": 2,
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
          },
          [
            createElement("path" as never, {
              key: "a",
              d: "M28 6 c2 4 5 6 5 11 c0 4-2.5 6-5 6 c-2.5 0-5-2-5-6 c0-3 1-4 2.5-6 c0 1.5 1 2 1.5 2 c-0.5-2 0.5-4 1-7 z",
              fill: palette.flameFill,
              stroke: palette.flameFill,
            }),
            createElement("path" as never, { key: "b", d: "M28 23 v6" }),
            createElement("rect" as never, {
              key: "c",
              x: 18,
              y: 29,
              width: 20,
              height: 21,
              rx: 0.5,
            }),
            createElement("path" as never, { key: "d", d: "M18 29 h20" }),
            createElement("path" as never, { key: "e", d: "M22 35 v8", opacity: 0.4 }),
          ],
        ),
      );

    case "seal":
      return createElement(
        "svg" as never,
        {
          xmlns: "http://www.w3.org/2000/svg",
          viewBox: "0 0 56 56",
          width,
          height,
          role: "img",
          "aria-label": "The Unwritten",
          style: { display: "block" },
        },
        [
          createElement(
            "defs" as never,
            { key: "defs" },
            createElement(
              "radialGradient" as never,
              { id: "tu-seal", cx: "40%", cy: "35%", r: "60%" },
              [
                createElement("stop" as never, {
                  key: "s0",
                  offset: "0%",
                  "stop-color": primitiveTokens.color.ember[300],
                }),
                createElement("stop" as never, {
                  key: "s1",
                  offset: "60%",
                  "stop-color": primitiveTokens.color.ember[600],
                }),
                createElement("stop" as never, {
                  key: "s2",
                  offset: "100%",
                  "stop-color": primitiveTokens.color.ember[700],
                }),
              ],
            ),
          ),
          createElement("path" as never, {
            key: "shape",
            d: "M28 4 c8 0 16 4 19 12 c4 8 2 16-4 22 c-3 4-9 8-15 8 c-7 0-13-3-17-9 c-4-6-5-13-1-19 c4-7 11-14 18-14 z",
            fill: "url(#tu-seal)",
          }),
          createElement(
            "text" as never,
            {
              key: "tu",
              x: 28,
              y: 34,
              "text-anchor": "middle",
              "font-family": primitiveTokens.font.display,
              "font-size": 22,
              "font-weight": 500,
              "font-style": "italic",
              fill: primitiveTokens.color.paper[100],
            },
            "TU",
          ),
        ],
      );

    case "lockup":
    default:
      return createElement(
        "svg" as never,
        {
          xmlns: "http://www.w3.org/2000/svg",
          viewBox: "0 0 380 60",
          width,
          height,
          role: "img",
          "aria-label": "The Unwritten",
          style: { display: "block" },
        },
        [
          createElement(
            "g" as never,
            { key: "glyph", transform: "translate(0,4)" },
            createElement(
              "g" as never,
              {
                fill: "none",
                stroke: palette.stroke,
                "stroke-width": 2,
                "stroke-linecap": "round",
                "stroke-linejoin": "round",
              },
              [
                createElement("path" as never, {
                  key: "a",
                  d: "M28 6 c2 4 5 6 5 11 c0 4-2.5 6-5 6 c-2.5 0-5-2-5-6 c0-3 1-4 2.5-6 c0 1.5 1 2 1.5 2 c-0.5-2 0.5-4 1-7 z",
                  fill: palette.flameFill,
                  stroke: palette.flameFill,
                }),
                createElement("path" as never, { key: "b", d: "M28 23 v6" }),
                createElement("rect" as never, {
                  key: "c",
                  x: 18,
                  y: 29,
                  width: 20,
                  height: 21,
                  rx: 0.5,
                }),
                createElement("path" as never, { key: "d", d: "M18 29 h20" }),
                createElement("path" as never, { key: "e", d: "M22 35 v8", opacity: 0.4 }),
              ],
            ),
          ),
          createElement(
            "g" as never,
            { key: "text", transform: "translate(76,0)" },
            [
              createElement(
                "text" as never,
                {
                  key: "title",
                  x: 0,
                  y: 36,
                  "font-family": primitiveTokens.font.display,
                  "font-size": 36,
                  "font-weight": 500,
                  "font-style": "italic",
                  fill: palette.text,
                  "letter-spacing": -0.5,
                },
                "The Unwritten",
              ),
              createElement(
                "text" as never,
                {
                  key: "tagline",
                  x: 2,
                  y: 54,
                  "font-family": primitiveTokens.font.mono,
                  "font-size": 9,
                  fill: palette.tagline,
                  "letter-spacing": 3,
                  textLength: 240,
                },
                "AN ADVENTURE THAT WRITES ITSELF",
              ),
            ],
          ),
        ],
      );
  }
}
