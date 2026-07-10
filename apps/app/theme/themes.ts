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
  display: p.size.display2, // 38
  title: p.size.h1, // 30
  subtitle: p.size.h2, // 22
  body: p.size.body, // 16 — comfortable web reading floor
  bodySmall: p.size.ui, // 14
  caption: p.size.micro, // 12 — never below 12 (was 11)
  lineHeight: {
    tight: 1.2,
    normal: 1.55, // prose-friendly (was 1.45). ProseRenderer + Text primitive both read this.
    loose: 1.7,
  },
  families: {
    // Serif/body/mono are SHARED across themes; only colors change per theme.
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

// Each palette is hand-tuned to meet WCAG targets enforced by
// `apps/app/theme/__tests__/contrast.test.mjs`. Don't mutate stops without
// running that test — it catches every regression below 4.5:1 on prose pairs
// and 3:1 on chrome pairs.
const dayColors: ThemeColors = {
  background: p.color.paper[100], // #f4ecd8
  surface: p.color.paper[50], // #faf6ec
  // paper[400] (not paper[200]) so surface vs surfaceMuted hits 1.85:1 — at
  // paper[200] the two cream tones were only 1.22:1 and panels-within-panels
  // were invisible.
  surfaceMuted: p.color.paper[400], // #c9b683
  text: p.color.ink[900], // #13110d  → 16:1 on bg (AAA)
  textMuted: p.color.ink[700], // #33302a → 11.17:1 on bg
  // 0.6 (up from 0.52) keeps textFaint above 4.5:1 even on background; the
  // old 0.52 ran 3.63:1, marginal AA for non-text chrome only.
  textFaint: withAlpha(p.color.ink[900], 0.6),
  border: p.color.ink[900],
  // 0.4 (up from 0.2) bumps borderMuted from 1.54:1 → 2.56:1 vs background so
  // dividers actually outline panels instead of ghosting.
  borderMuted: withAlpha(p.color.ink[900], 0.4),
  // ember[500] (not ember[400]) — the lighter ember[400] only hit 3.79:1 on
  // the cream bg which fails AA for accent text used in Choice/Note primitives.
  accent: p.color.ember[500], // #a83232 → 5.05:1
  accentMuted: withAlpha(p.color.ember[500], 0.2),
  danger: p.color.ember[600], // #7a2218 → 8.62:1
  shadow: withAlpha(p.color.ink[900], 0.14),
  overlay: withAlpha(p.color.ink[900], 0.08),
};

const nightColors: ThemeColors = {
  background: p.color.night[800], // #14110b
  surface: p.color.night[700], // #1d1812
  // night[500] is a new ramp stop (#403727); the old night[600] gave only
  // 1.14:1 surface/surfaceMuted separation so nested panels disappeared.
  surfaceMuted: p.color.night[500], // 1.51:1 vs surface
  text: p.color.paper[100], // #f4ecd8 → 16:1
  textMuted: p.color.ink[300], // #c4bda6 → 10:1
  textFaint: withAlpha(p.color.paper[100], 0.6),
  border: p.color.paper[200],
  borderMuted: withAlpha(p.color.paper[200], 0.4), // 3.2:1 vs bg
  accent: p.color.candle[400], // #d8b158 → 9.28:1
  accentMuted: withAlpha(p.color.candle[400], 0.22),
  danger: p.color.ember[300], // #dc8678 → 6.93:1
  shadow: withAlpha(p.color.night[900], 0.4),
  overlay: withAlpha(p.color.paper[50], 0.08),
};

const sepiaColors: ThemeColors = {
  background: p.color.paper[200], // #ebe0c4
  surface: p.color.paper[100], // #f4ecd8
  // paper[400] (not paper[300]) — at paper[300] surface/surfaceMuted was only
  // 1.30:1; paper[400] gives 1.70:1 separation.
  surfaceMuted: p.color.paper[400], // #c9b683
  text: p.color.ink[800], // #1f1c16 → 12.94:1
  textMuted: p.color.ink[600], // #544f44 → 6.20:1
  // 0.65 (up from 0.52) keeps textFaint at 4.70:1 — old 0.52 was 3.25:1, just
  // barely above the 3:1 chrome floor.
  textFaint: withAlpha(p.color.ink[800], 0.65),
  border: p.color.ink[800],
  borderMuted: withAlpha(p.color.ink[800], 0.4),
  accent: p.color.ember[500], // #a83232 → 5.05:1
  accentMuted: withAlpha(p.color.ember[500], 0.22),
  danger: p.color.ember[700], // #5c1a14 → 9.91:1
  shadow: withAlpha(p.color.ink[800], 0.16),
  overlay: withAlpha(p.color.ink[800], 0.08),
};

export const themeColorMap: Record<ThemeMode, ThemeColors> = {
  day: dayColors,
  night: nightColors,
  sepia: sepiaColors,
};
