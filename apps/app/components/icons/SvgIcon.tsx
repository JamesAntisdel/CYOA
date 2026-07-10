import { createElement, ReactNode } from "react";
import { Platform, View, ViewProps } from "react-native";

import { useAppTheme } from "../../theme";

/**
 * Internal helper used by every named icon component in this folder.
 *
 * On web (react-native-web), inline SVG is rendered via `React.createElement`
 * because react-native-web passes unknown DOM elements through. Strokes/fills
 * use `currentColor`, and we set the SVG's `color` style to the requested
 * color so stroke/fill inherit it.
 *
 * On native (no `react-native-svg` peer dep yet — see wave 0 follow-up), we
 * render a bordered box of the correct size so layout is preserved. The SVG
 * geometry itself is delivered only on web until react-native-svg lands.
 */

export type SvgIconProps = ViewProps & {
  size?: number;
  color?: string;
  /**
   * Optional override for the accessibility label. Each named icon supplies a
   * sensible default.
   */
  accessibilityLabel?: string;
};

type InternalProps = SvgIconProps & {
  /**
   * The raw SVG children, expressed as React elements created with
   * `createElement` so they pass through react-native-web untouched. Keep these
   * elements pure SVG primitives (`path`, `g`, `rect`, `circle`, `text`).
   */
  children: ReactNode;
  /** The icon name, used for the default accessibility label. */
  name: string;
  /** viewBox in standard SVG form. Defaults to "0 0 24 24". */
  viewBox?: string;
};

export function SvgIcon({
  size = 24,
  color,
  accessibilityLabel,
  children,
  name,
  viewBox = "0 0 24 24",
  style,
  ...props
}: InternalProps) {
  const { tokens } = useAppTheme();
  const resolvedColor = color ?? tokens.colors.text;

  if (Platform.OS === "web") {
    // react-native-web renders unknown DOM elements untouched, so we can
    // emit SVG primitives directly and they inherit `currentColor`.
    const svgElement = createElement(
      "svg" as never,
      {
        xmlns: "http://www.w3.org/2000/svg",
        viewBox,
        width: size,
        height: size,
        fill: "none",
        stroke: "currentColor",
        role: "img",
        "aria-label": accessibilityLabel ?? name,
        style: { color: resolvedColor, display: "block" },
      },
      children,
    );

    return (
      <View
        accessibilityLabel={accessibilityLabel ?? name}
        accessibilityRole="image"
        style={[{ width: size, height: size }, style]}
        {...props}
      >
        {svgElement}
      </View>
    );
  }

  // Native fallback — placeholder until react-native-svg is wired in.
  return (
    <View
      accessibilityLabel={accessibilityLabel ?? name}
      accessibilityRole="image"
      style={[
        {
          width: size,
          height: size,
          borderColor: resolvedColor,
          borderWidth: 1,
          borderRadius: 2,
        },
        style,
      ]}
      {...props}
    />
  );
}

/**
 * Convenience helper for icon components — builds a React element from a tag
 * name and attributes. Centralised so every icon component looks identical.
 */
export function svgEl<T extends string>(
  tag: T,
  attrs: Record<string, string | number | undefined>,
  children?: ReactNode,
) {
  return createElement(tag as never, attrs as never, children as never);
}
