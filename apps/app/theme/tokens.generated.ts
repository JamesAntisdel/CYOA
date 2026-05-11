/**
 * AUTO-MIRRORED from `apps/app/assets/design/tokens/tokens.json`.
 *
 * This module is the single source of truth in TypeScript for the design
 * primitives (color/font/size/radius/spacing/shadow scales) defined by the
 * design system. The JSON is the canonical source — see the drift test at
 * `apps/app/theme/__tests__/tokens.test.ts` which fails if the values here
 * diverge from the JSON.
 *
 * Do NOT hand-edit values; edit `tokens.json` and re-sync.
 */

import rawTokens from "../assets/design/tokens/tokens.json";

export const primitiveTokens = rawTokens as Readonly<{
  color: {
    paper: { "50": string; "100": string; "200": string; "300": string; "400": string };
    ink: {
      "300": string;
      "400": string;
      "500": string;
      "600": string;
      "700": string;
      "800": string;
      "900": string;
    };
    ember: { "300": string; "400": string; "500": string; "600": string; "700": string };
    candle: { "300": string; "400": string; "500": string; "600": string; "700": string };
    night: { "600": string; "700": string; "800": string; "900": string };
  };
  font: {
    display: string;
    body: string;
    ui: string;
    mono: string;
  };
  size: {
    display1: number;
    display2: number;
    h1: number;
    h2: number;
    body: number;
    ui: number;
    micro: number;
    stamp: number;
  };
  radius: {
    none: number;
    sm: number;
    md: number;
  };
  spacing: {
    "0": number;
    "1": number;
    "2": number;
    "3": number;
    "4": number;
    "5": number;
    "6": number;
    "8": number;
    "10": number;
    "12": number;
    "16": number;
  };
  shadow: {
    card: string;
    plate: string;
  };
}>;

export type PrimitiveTokens = typeof primitiveTokens;
