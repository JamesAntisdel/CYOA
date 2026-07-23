import type { PropsWithChildren } from "react";
import { View } from "react-native";

import { Text } from "../primitives";
import { useAppTheme } from "../../theme";
import { PAGE_TURN_CHOICE_ID } from "../reading/layouts/pageTurn";

/**
 * DecisionPoint — the quiet, printed frame that makes a BRANCHING choice point
 * unmistakable (reading-modes A3). The choices themselves are unchanged: this
 * only WRAPS them with a hairline rule, a small drawn diverging-path motif, an
 * italic-serif "The path forks" header, and one muted line explaining the
 * stakes. It never touches how a choice submits — `ChoiceList` /
 * `FootnoteChoices` still own `onChoose` / freeform / locked cards byte-for-byte.
 *
 * The frame is shown ONLY at a real fork. In Novel mode the server collapses
 * the scene to a single synthetic `turn-page` choice; that is a page-turn, not
 * a fork, so `isDecisionPoint` suppresses the frame there (it reuses the
 * `PAGE_TURN_CHOICE_ID` contract from `layouts/pageTurn`, never a hardcoded id).
 */

/** The header copy — kept as consts so the drift-guard test can pin them. */
export const DECISION_POINT_LABEL = "The path forks";
export const DECISION_POINT_SUBLINE = "What you choose here changes what comes next.";

/**
 * PURE — is this projection a real branching fork (frame it) or not?
 *
 * A scene with no choices is not a fork (the terminal / freeform-only cases own
 * their own copy). The Novel-mode single synthetic `turn-page` choice is a
 * page-turn, not a fork — detected via the shared `PAGE_TURN_CHOICE_ID`
 * contract so Novel is never dressed up as a decision point.
 */
export function isDecisionPoint(
  choices: readonly { id: string }[] | null | undefined,
): boolean {
  if (!choices || choices.length === 0) return false;
  if (choices.length === 1 && choices[0]?.id === PAGE_TURN_CHOICE_ID) return false;
  return true;
}

/**
 * The drawn diverging-path motif (RC5 — NO control emoji). A short trunk that
 * splits into two branches, built from thin Views so it inherits theme color
 * and never depends on a glyph font. Decorative: hidden from screen readers
 * (the "The path forks" text already carries the meaning).
 */
export function ForkMark({ color, size = 16 }: { color: string; size?: number }) {
  const stroke = 1.5;
  const branch = size * 0.62;
  const trunk = size * 0.42;
  return (
    <View
      accessibilityElementsHidden
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: size, width: size }}
    >
      {/* trunk — rises from the bottom-center split point */}
      <View
        style={{
          backgroundColor: color,
          borderRadius: stroke,
          bottom: 0,
          height: trunk,
          left: (size - stroke) / 2,
          position: "absolute",
          width: stroke,
        }}
      />
      {/* left branch — diverges up-and-left */}
      <View
        style={{
          backgroundColor: color,
          borderRadius: stroke,
          height: branch,
          left: size * 0.2,
          position: "absolute",
          top: 0,
          transform: [{ rotate: "26deg" }],
          width: stroke,
        }}
      />
      {/* right branch — diverges up-and-right */}
      <View
        style={{
          backgroundColor: color,
          borderRadius: stroke,
          height: branch,
          position: "absolute",
          right: size * 0.2,
          top: 0,
          transform: [{ rotate: "-26deg" }],
          width: stroke,
        }}
      />
    </View>
  );
}

/**
 * The mark + "The path forks" italic-serif label, on one row. Exported so the
 * spread's `FootnoteChoices` can seat the same header above its footnote rule
 * without pulling in the full framed block (its printed-footnote idiom already
 * supplies the rule + subline cadence).
 */
export function DecisionPointHeader() {
  const { tokens } = useAppTheme();
  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: tokens.spacing.sm,
      }}
    >
      <ForkMark color={tokens.colors.textMuted} />
      {/*
       * The header trait lives on the (default-accessible) Text, not the row
       * View — a plain View is only an a11y element on iOS when accessible is
       * explicitly true, so a role on the wrapper is silently dropped and
       * VoiceOver's heading rotor skips the fork. Mirrors ReaderTopBar's title.
       */}
      <Text
        accessibilityRole="header"
        style={{
          color: tokens.colors.text,
          fontFamily: tokens.typography.families.serif,
          fontStyle: "italic",
        }}
      >
        {DECISION_POINT_LABEL}
      </Text>
    </View>
  );
}

/**
 * The full printed frame around a fork's choices. Renders a hairline top rule,
 * the header, the muted stakes line, then the wrapped choices unchanged.
 */
export function DecisionPoint({ children }: PropsWithChildren) {
  const { tokens } = useAppTheme();
  return (
    <View style={{ gap: tokens.spacing.sm }}>
      {/* hairline top rule (token) — the printed line that opens the fork */}
      <View
        accessibilityElementsHidden
        aria-hidden
        importantForAccessibility="no-hide-descendants"
        style={{
          borderTopColor: tokens.colors.borderMuted,
          borderTopWidth: tokens.borderWidths.hairline,
        }}
      />
      <DecisionPointHeader />
      <Text muted variant="bodySmall">
        {DECISION_POINT_SUBLINE}
      </Text>
      {children}
    </View>
  );
}
