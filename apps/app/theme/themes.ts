/**
 * Canonical theme map for the app. Every value here is derived from
 * `primitiveTokens` (which mirrors `tokens.json`) so there are no inline
 * hex codes or magic numbers in this file. Consumers always go through the
 * semantic alias layer exposed by `ThemeTokens` — never the primitive
 * scales directly.
 *
 * Canonical themes: `sepia`, `night`, `day`. Aliases `parchment` and
 * `midnight` resolve to `day` and `night` respectively so older code paths
 * keep working.
 */

import { primitiveTokens as p } from "./tokens.generated";

export type ThemeMode = "day" | "night" | "sepia";
export type ThemeAlias = "parchment" | "midnight";
export type ThemeName = ThemeMode | ThemeAlias;

export const themeAliases: Record<ThemeAlias, ThemeMode> = {
  parchment: "day",
  midnight: "night",
};

export function resolveThemeAlias(name: ThemeName): ThemeMode {
  if (name === "parchment" || name === "midnight") {
    return themeAliases[name];
  }
  return name;
}

const withAlpha = (hex: string, alpha: number) => hexToRgba(hex, alpha);

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Spacing/radii/borderWidths are theme-agnostic — built once from primitives.
export const sharedSpacing = {
  xs: p.spacing[1],
  sm: p.spacing[2],
  md: p.spacing[3],
  lg: p.spacing[4],
  xl: p.spacing[6],
  xxl: p.spacing[8],
} as const;

export const sharedRadii = {
  xs: p.radius.sm,
  sm: p.radius.md,
  md: p.spacing[2], // 8 — matches existing semantic md
  pill: 999,
} as const;

export const sharedBorderWidths = {
  hairline: 1,
  regular: 1.5,
  heavy: 2,
} as const;

export const sharedTypography = {
  display: p.size.display2, // 38 — was 34
  title: p.size.h1, // 30 — was 24
  subtitle: p.size.h2, // 22 — was 18
  body: p.size.body, // 16
  bodySmall: p.size.ui, // 14
  caption: p.size.micro, // 11 — was 12
  lineHeight: {
    tight: 1.15,
    normal: 1.45,
    loose: 1.7,
  },
  families: {
    serif: p.font.display,
    body: p.font.body,
    mono: p.font.mono,
  },
} as const;

export type ThemeColors = {
  background: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  borderMuted: string;
  accent: string;
  accentMuted: string;
  danger: string;
  shadow: string;
  overlay: string;
};

const dayColors: ThemeColors = {
  background: p.color.paper[100],
  surface: p.color.paper[50],
  surfaceMuted: p.color.paper[200],
  text: p.color.ink[900],
  textMuted: p.color.ink[700],
  textFaint: withAlpha(p.color.ink[900], 0.52),
  border: p.color.ink[900],
  borderMuted: withAlpha(p.color.ink[900], 0.2),
  accent: p.color.ember[400],
  accentMuted: withAlpha(p.color.ember[400], 0.2),
  danger: p.color.ember[600],
  shadow: withAlpha(p.color.ink[900], 0.14),
  overlay: withAlpha(p.color.ink[900], 0.08),
};

const nightColors: ThemeColors = {
  background: p.color.night[800],
  surface: p.color.night[700],
  surfaceMuted: p.color.night[600],
  text: p.color.paper[100],
  textMuted: p.color.ink[300],
  textFaint: withAlpha(p.color.paper[100], 0.55),
  border: p.color.paper[200],
  borderMuted: withAlpha(p.color.paper[200], 0.22),
  accent: p.color.candle[400],
  accentMuted: withAlpha(p.color.candle[400], 0.22),
  danger: p.color.ember[300],
  shadow: withAlpha(p.color.night[900], 0.4),
  overlay: withAlpha(p.color.paper[50], 0.08),
};

const sepiaColors: ThemeColors = {
  background: p.color.paper[200],
  surface: p.color.paper[100],
  surfaceMuted: p.color.paper[300],
  text: p.color.ink[800],
  textMuted: p.color.ink[600],
  textFaint: withAlpha(p.color.ink[800], 0.52),
  border: p.color.ink[800],
  borderMuted: withAlpha(p.color.ink[800], 0.22),
  accent: p.color.ember[500],
  accentMuted: withAlpha(p.color.ember[500], 0.22),
  danger: p.color.ember[700],
  shadow: withAlpha(p.color.ink[800], 0.16),
  overlay: withAlpha(p.color.ink[800], 0.08),
};

export const themeColorMap: Record<ThemeMode, ThemeColors> = {
  day: dayColors,
  night: nightColors,
  sepia: sepiaColors,
};
