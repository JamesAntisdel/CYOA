/**
 * Theme tokens — the runtime contract consumed by `useAppTheme()` and every
 * primitive component in `apps/app/components/primitives/*`.
 *
 * Every value below is derived from `tokens.generated.ts` (which mirrors
 * `apps/app/assets/design/tokens/tokens.json`). Do NOT introduce inline
 * hex codes, font names, or magic numbers here — extend the JSON if a
 * new primitive is required, then map it through `themes.ts`.
 */

import {
  sharedBorderWidths,
  sharedRadii,
  sharedSpacing,
  sharedTypography,
  themeColorMap,
  type ThemeColors,
  type ThemeMode,
} from "./themes";

export type { ThemeMode } from "./themes";
export { resolveThemeAlias, type ThemeAlias, type ThemeName } from "./themes";

export type FontScale = "compact" | "default" | "large";

export type ThemeTokens = {
  mode: ThemeMode;
  colors: ThemeColors;
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };
  radii: {
    xs: number;
    sm: number;
    md: number;
    pill: number;
  };
  borderWidths: {
    hairline: number;
    regular: number;
    heavy: number;
  };
  typography: {
    display: number;
    title: number;
    subtitle: number;
    body: number;
    bodySmall: number;
    caption: number;
    lineHeight: {
      tight: number;
      normal: number;
      loose: number;
    };
    families: {
      serif: string;
      body: string;
      mono: string;
    };
  };
};

function buildTheme(mode: ThemeMode): ThemeTokens {
  return {
    mode,
    colors: themeColorMap[mode],
    spacing: { ...sharedSpacing },
    radii: { ...sharedRadii },
    borderWidths: { ...sharedBorderWidths },
    typography: {
      ...sharedTypography,
      lineHeight: { ...sharedTypography.lineHeight },
      families: { ...sharedTypography.families },
    },
  };
}

export const themeTokens: Record<ThemeMode, ThemeTokens> = {
  day: buildTheme("day"),
  night: buildTheme("night"),
  sepia: buildTheme("sepia"),
};

export function scaleTypography(tokens: ThemeTokens, fontScale: FontScale): ThemeTokens {
  const multiplier = fontScale === "compact" ? 0.92 : fontScale === "large" ? 1.14 : 1;

  return {
    ...tokens,
    typography: {
      ...tokens.typography,
      display: Math.round(tokens.typography.display * multiplier),
      title: Math.round(tokens.typography.title * multiplier),
      subtitle: Math.round(tokens.typography.subtitle * multiplier),
      body: Math.round(tokens.typography.body * multiplier),
      bodySmall: Math.round(tokens.typography.bodySmall * multiplier),
      caption: Math.round(tokens.typography.caption * multiplier),
    },
  };
}

export { primitiveTokens } from "./tokens.generated";
