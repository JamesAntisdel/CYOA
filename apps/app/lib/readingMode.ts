import { createElement as h } from "react";
import { View } from "react-native";

import { useAppTheme } from "../theme";

/**
 * Reading-modes cleanup — the shared CLIENT vocabulary for content Axis 1
 * ("how this story reads"). This is the SERVER-persisted content axis
 * (`save.readingMode`), distinct from the cosmetic layout skin (Axis 2) and
 * the session-only auto-narrator (Axis 3). Keeping the label + blurb + mark in
 * one module means every surface that names the axis (create screen, reader
 * settings drawer, home) reads from the SAME copy instead of re-inventing three
 * near-identical inline toggles.
 *
 * `readingMode` is present on the wire ONLY when a save is `"novel"`; the
 * server omits it for `"branching"` (the byte-identical default). This module
 * always names both explicitly so the chooser can render a real two-option
 * radio and switch either direction.
 *
 * ModeMark is authored with `createElement` (not JSX) so this stays a `.ts`
 * module per the pinned contract path.
 */
export type ReadingMode = "branching" | "novel";

/**
 * Reader-facing copy for each mode. `blurb` is ALWAYS shown beneath the label
 * in the chooser (the whole point of the cleanup: the two modes must be legible
 * side by side, not decoded from a bare toggle). Verbatim from the pinned spec
 * contract — do not paraphrase without updating the design mock.
 */
export const READING_MODE_META: Record<
  ReadingMode,
  { label: string; blurb: string }
> = {
  branching: {
    label: "Branching",
    blurb:
      "You choose the path at every scene. Your decisions open — and close — where the story can go.",
  },
  novel: {
    label: "Novel",
    blurb:
      "One continuous story. No choices — just turn the page and read it through, like a book.",
  },
};

/**
 * `ModeMark` — a SMALL drawn (View-only) motif for each mode. No control emoji
 * (RC5): branching renders a fork of two diverging limbs off a stem; novel
 * renders stacked lines (a page of continuous text). Purely decorative, so it
 * is hidden from the a11y tree — the chooser row carries the spoken label.
 */
export function ModeMark({
  mode,
  size = 20,
}: {
  mode: ReadingMode;
  size?: number;
}) {
  const { tokens } = useAppTheme();
  const color = tokens.colors.text;
  const bar = Math.max(2, Math.round(size / 10));

  if (mode === "novel") {
    // Stacked lines — a page of continuous prose, no forks. The last line is
    // short so the motif reads as "text", not a plain grid.
    const gap = Math.max(2, Math.round((size - bar * 3) / 2));
    return h(
      View,
      {
        accessibilityElementsHidden: true,
        importantForAccessibility: "no",
        style: { width: size, height: size, justifyContent: "center", gap },
      },
      [0, 1, 2].map((i) =>
        h(View, {
          key: i,
          style: {
            height: bar,
            width: i === 2 ? size * 0.6 : size,
            borderRadius: bar,
            backgroundColor: color,
          },
        }),
      ),
    );
  }

  // Branching — a stem that forks into two diverging limbs.
  return h(
    View,
    {
      accessibilityElementsHidden: true,
      importantForAccessibility: "no",
      style: { width: size, height: size },
    },
    // stem
    h(View, {
      key: "stem",
      style: {
        position: "absolute",
        left: size / 2 - bar / 2,
        bottom: 0,
        width: bar,
        height: size * 0.5,
        borderRadius: bar,
        backgroundColor: color,
      },
    }),
    // left limb
    h(View, {
      key: "left",
      style: {
        position: "absolute",
        left: size * 0.12,
        top: size * 0.08,
        width: bar,
        height: size * 0.55,
        borderRadius: bar,
        backgroundColor: color,
        transform: [{ rotate: "35deg" }],
      },
    }),
    // right limb
    h(View, {
      key: "right",
      style: {
        position: "absolute",
        right: size * 0.12,
        top: size * 0.08,
        width: bar,
        height: size * 0.55,
        borderRadius: bar,
        backgroundColor: color,
        transform: [{ rotate: "-35deg" }],
      },
    }),
  );
}
