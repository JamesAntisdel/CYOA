export type ThemeMode = "day" | "night" | "sepia";

export type FontScale = "compact" | "default" | "large";

export type ThemeTokens = {
  mode: ThemeMode;
  colors: {
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

const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

const radii = {
  xs: 4,
  sm: 8,
  md: 12,
  pill: 999,
} as const;

const borderWidths = {
  hairline: 1,
  regular: 1.5,
  heavy: 2,
} as const;

const typographyBase = {
  display: 34,
  title: 24,
  subtitle: 18,
  body: 16,
  bodySmall: 14,
  caption: 12,
  lineHeight: {
    tight: 1.15,
    normal: 1.45,
    loose: 1.7,
  },
  families: {
    serif: "Georgia",
    body: "System",
    mono: "Courier",
  },
} as const;

export const themeTokens: Record<ThemeMode, ThemeTokens> = {
  day: {
    mode: "day",
    colors: {
      background: "#f4ecd8",
      surface: "#fff8e8",
      surfaceMuted: "#ebe1c9",
      text: "#1a1410",
      textMuted: "#3a2e26",
      textFaint: "rgba(26, 20, 16, 0.52)",
      border: "#1a1410",
      borderMuted: "rgba(26, 20, 16, 0.2)",
      accent: "#c8541e",
      accentMuted: "rgba(200, 84, 30, 0.2)",
      danger: "#8f1d18",
      shadow: "rgba(26, 20, 16, 0.14)",
      overlay: "rgba(26, 20, 16, 0.08)",
    },
    spacing,
    radii,
    borderWidths,
    typography: typographyBase,
  },
  night: {
    mode: "night",
    colors: {
      background: "#17130f",
      surface: "#241c17",
      surfaceMuted: "#302620",
      text: "#f1e5cf",
      textMuted: "#c8b9a3",
      textFaint: "rgba(241, 229, 207, 0.55)",
      border: "#dfcfb6",
      borderMuted: "rgba(223, 207, 182, 0.22)",
      accent: "#e07a3d",
      accentMuted: "rgba(224, 122, 61, 0.22)",
      danger: "#ef786f",
      shadow: "rgba(0, 0, 0, 0.28)",
      overlay: "rgba(255, 244, 224, 0.08)",
    },
    spacing,
    radii,
    borderWidths,
    typography: typographyBase,
  },
  sepia: {
    mode: "sepia",
    colors: {
      background: "#ead9b6",
      surface: "#f6e8c9",
      surfaceMuted: "#dec79e",
      text: "#25170f",
      textMuted: "#4a3527",
      textFaint: "rgba(37, 23, 15, 0.52)",
      border: "#2b1b12",
      borderMuted: "rgba(43, 27, 18, 0.22)",
      accent: "#9f3f1c",
      accentMuted: "rgba(159, 63, 28, 0.22)",
      danger: "#7d1a16",
      shadow: "rgba(43, 27, 18, 0.16)",
      overlay: "rgba(43, 27, 18, 0.08)",
    },
    spacing,
    radii,
    borderWidths,
    typography: typographyBase,
  },
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
