import { useRef, useState } from "react";
import { Animated, Easing, Pressable, View } from "react-native";

import { Icon, Text } from "../../../primitives";
import { useAppTheme } from "../../../../theme";
import type { ChoiceProjection } from "../../../../hooks/useTurn";
import { CheckChip } from "../../../choices/CheckChip";
import { DecisionPointHeader, isDecisionPoint } from "../../../choices/DecisionPoint";
import { FreeformChoice } from "../../../choices/FreeformChoice";
import { LockedChoiceCopy } from "../../../choices/LockedChoiceCopy";
import { canTurnPage, pageTurnLabel, resolvePageTurnChoice } from "../pageTurn";

/**
 * FootnoteChoices — the open-book spread's choice treatment (R5 / OB6).
 *
 * A NEW thin presentational component over the SAME `ChoiceProjection[]` +
 * the UNCHANGED `onChoose` — `ChoiceList` is left byte-identical (OB6). The
 * recto's choices render as a NUMBERED footnote list ("1.", "2.", …) at the
 * foot of the page instead of a button stack. Each footnote is a full
 * pressable that submits through the identical `onChoose` path — no pipeline
 * fork (R5.1). The locked rows, the free-form "write your own" affordance, and
 * the skill-check chips are preserved as thin footnote pieces (reusing the
 * existing `LockedChoiceCopy` / `FreeformChoice` / `CheckChip`).
 *
 * In Novel mode (`readingMode === "novel"`) the footnotes collapse to the
 * single "Turn the page" affordance (R5.2 / OB8), reusing `layouts/pageTurn.ts`
 * so the server-stamped `turn-page` id round-trips to `submitChoice` unchanged.
 */

/** A single footnote row, numbered only when it is a submittable choice. */
export type FootnoteEntry =
  | { readonly kind: "choice"; readonly choice: ChoiceProjection; readonly number: number }
  | { readonly kind: "locked"; readonly choice: ChoiceProjection }
  | { readonly kind: "freeform" };

/** PURE — `"novel"` collapses the footnotes to the page-turn (OB8). */
export function isNovelReading(readingMode: string | null | undefined): boolean {
  return readingMode === "novel";
}

/**
 * PURE — number the footnotes. Submittable choices take the running numbers
 * (1., 2., …); locked rows keep a lock glyph (no number, so the sequence the
 * reader can act on stays 1..N); the free-form row, when enabled, trails with a
 * dash. No React — the component and its `.test.mjs` share this logic.
 */
export function buildFootnotes(
  choices: readonly ChoiceProjection[] | null | undefined,
  options?: { showFreeform?: boolean },
): FootnoteEntry[] {
  const entries: FootnoteEntry[] = [];
  let n = 0;
  for (const choice of choices ?? []) {
    if (choice.locked) {
      entries.push({ kind: "locked", choice });
    } else {
      n += 1;
      entries.push({ kind: "choice", choice, number: n });
    }
  }
  if (options?.showFreeform) entries.push({ kind: "freeform" });
  return entries;
}

type FootnoteChoicesProps = {
  choices: ChoiceProjection[];
  onChoose: (choice: ChoiceProjection) => void;
  /** `"novel"` collapses to the single page-turn affordance (OB8). */
  readingMode?: string | null;
  pendingChoiceId?: string | null;
  isStreaming?: boolean;
  reducedMotion?: boolean;
  disabled?: boolean;
  /** Free-form ("write your own") — a footnote row when a host wires it. */
  onFreeformSubmit?: (text: string) => void;
  freeformPending?: boolean;
  freeformError?: string | null;
};

export function FootnoteChoices({
  choices,
  onChoose,
  readingMode = null,
  pendingChoiceId = null,
  isStreaming = false,
  reducedMotion = false,
  disabled = false,
  onFreeformSubmit,
  freeformPending = false,
  freeformError = null,
}: FootnoteChoicesProps) {
  const { tokens } = useAppTheme();

  // Novel mode: the footnotes collapse to the single page-turn (OB8/R5.2). The
  // server-stamped `turn-page` choice submits UNCHANGED through onChoose.
  if (isNovelReading(readingMode)) {
    return (
      <PageTurnFootnote
        choice={resolvePageTurnChoice<ChoiceProjection>(choices)}
        isStreaming={isStreaming}
        pendingChoiceId={pendingChoiceId}
        onTurn={onChoose}
      />
    );
  }

  const showFreeform = typeof onFreeformSubmit === "function";
  const entries = buildFootnotes(choices, { showFreeform });
  const locked = disabled || Boolean(pendingChoiceId);

  return (
    <View
      accessibilityLabel="Available choices"
      style={{ gap: tokens.spacing.sm, marginTop: "auto" }}
    >
      {/* A real fork gets the printed "The path forks" header above the rule
          (A3) — tasteful in the footnote idiom. Suppressed when the projection
          is not a branching fork (0-choice terminal payloads). */}
      {isDecisionPoint(choices) ? <DecisionPointHeader /> : null}
      {/* The footnote rule — the printed line dividing prose from the notes. */}
      <View
        style={{
          borderTopColor: tokens.colors.borderMuted,
          borderTopWidth: tokens.borderWidths.regular,
        }}
      />
      {entries.map((entry) => {
        if (entry.kind === "freeform") {
          return (
            <View
              key="freeform"
              style={{ flexDirection: "row", gap: tokens.spacing.sm }}
            >
              <Text
                style={{
                  color: tokens.colors.textMuted,
                  fontFamily: tokens.typography.families.serif,
                  minWidth: 18,
                }}
              >
                —
              </Text>
              <View style={{ flex: 1 }}>
                <FreeformChoice
                  disabled={disabled || Boolean(pendingChoiceId && !freeformPending)}
                  error={freeformError}
                  onSubmit={onFreeformSubmit!}
                  pending={freeformPending}
                />
              </View>
            </View>
          );
        }
        if (entry.kind === "locked") {
          return (
            <LockedFootnote
              key={entry.choice.id}
              choice={entry.choice}
              reducedMotion={reducedMotion}
            />
          );
        }
        const choice = entry.choice;
        const isPending = pendingChoiceId === choice.id;
        return (
          <View key={choice.id} style={{ gap: tokens.spacing.xs }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${entry.number}. ${choice.label}`}
              accessibilityState={{ disabled: locked }}
              disabled={locked}
              onPress={() => onChoose(choice)}
              style={({ pressed }) => ({
                alignItems: "baseline",
                flexDirection: "row",
                gap: tokens.spacing.sm,
                minHeight: 44,
                opacity: pressed && !locked ? 0.7 : 1,
                paddingVertical: tokens.spacing.xs,
              })}
            >
              <Text
                style={{
                  color: tokens.colors.accent,
                  fontFamily: tokens.typography.families.serif,
                  minWidth: 18,
                }}
              >
                {entry.number}.
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: tokens.typography.families.serif }}>
                  {choice.label}
                </Text>
                {isPending ? (
                  <Text muted variant="caption">
                    Turning the page…
                  </Text>
                ) : choice.hint ? (
                  <Text muted variant="caption">
                    {choice.hint}
                  </Text>
                ) : null}
              </View>
            </Pressable>
            {choice.check ? <CheckChip check={choice.check} /> : null}
          </View>
        );
      })}
      {entries.length === 0 && !showFreeform ? (
        <Text muted variant="bodySmall">
          This scene has no available choices.
        </Text>
      ) : null}
    </View>
  );
}

const SHAKE_OFFSET = 6;

/**
 * A locked/conditional choice as a footnote (R5.1). Mirrors the ChoiceList
 * locked row thin: pressing does NOT submit — it shakes and reveals the
 * in-world `lockedHint` via the SAME `LockedChoiceCopy`. Reduced-motion readers
 * get the reveal with no shake.
 */
function LockedFootnote({
  choice,
  reducedMotion,
}: {
  choice: ChoiceProjection;
  reducedMotion: boolean;
}) {
  const { tokens } = useAppTheme();
  const [revealed, setRevealed] = useState(false);
  const translateX = useRef(new Animated.Value(0)).current;

  const shake = () => {
    setRevealed(true);
    if (reducedMotion) return;
    translateX.setValue(0);
    Animated.sequence([
      Animated.timing(translateX, { toValue: -SHAKE_OFFSET, duration: 50, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(translateX, { toValue: SHAKE_OFFSET, duration: 50, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(translateX, { toValue: -SHAKE_OFFSET / 2, duration: 50, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(translateX, { toValue: 0, duration: 50, easing: Easing.linear, useNativeDriver: true }),
    ]).start();
  };

  const a11yHint = choice.hint?.replace(/^\s*(?:needs|requires)\s+/iu, "");
  const a11yLabel = a11yHint
    ? `Locked — ${choice.label}. Requires ${a11yHint}.`
    : `Locked — ${choice.label}.`;

  return (
    <View style={{ gap: tokens.spacing.xs }}>
      <Animated.View style={{ transform: [{ translateX }] }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          accessibilityHint="Closed for now. Activating reveals why — it will not submit a choice."
          accessibilityState={{ expanded: revealed }}
          onPress={shake}
          style={({ pressed }) => ({
            alignItems: "baseline",
            flexDirection: "row",
            gap: tokens.spacing.sm,
            minHeight: 44,
            opacity: pressed ? 0.82 : 1,
            paddingVertical: tokens.spacing.xs,
          })}
        >
          <Icon
            aria-hidden
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            color={tokens.colors.textMuted}
            name="key"
          />
          <View style={{ flex: 1 }}>
            <Text muted style={{ fontFamily: tokens.typography.families.serif }}>
              {choice.label}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
      {revealed ? <LockedChoiceCopy hint={choice.hint} nearness={choice.nearness} /> : null}
    </View>
  );
}

type PageTurnFootnoteProps = {
  choice: ChoiceProjection | null;
  isStreaming: boolean;
  pendingChoiceId: string | null;
  onTurn: (choice: ChoiceProjection) => void;
};

/**
 * Novel-mode collapse (OB8): the single "Turn the page" footnote. It resolves
 * the server-stamped choice off the projection and hands it to the UNCHANGED
 * `onChoose`, self-guarding on the same facts the row it replaces honors
 * (`canTurnPage`). The whole-page curl belongs to the Spread (Wave 2), which
 * drives `pageTurnAnim` over the recto/verso; here the affordance just submits.
 */
function PageTurnFootnote({
  choice,
  isStreaming,
  pendingChoiceId,
  onTurn,
}: PageTurnFootnoteProps) {
  const { tokens } = useAppTheme();
  const active = canTurnPage({ choice, isStreaming, pendingChoiceId });
  const isPending = Boolean(choice) && pendingChoiceId === choice?.id;
  const label = pageTurnLabel(choice);

  const fireTurn = () => {
    if (!active || !choice) return;
    onTurn(choice);
  };

  // 0-choice terminal payload → the EndingPanel owns that case; render nothing.
  if (!choice) return null;

  return (
    <View style={{ alignItems: "flex-end", marginTop: "auto" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Turn the page"
        accessibilityState={{ disabled: !active }}
        disabled={!active}
        onPress={fireTurn}
        style={({ pressed }) => ({
          alignItems: "center",
          borderColor: tokens.colors.accent,
          borderRadius: tokens.radii.pill,
          borderWidth: tokens.borderWidths.regular,
          flexDirection: "row",
          gap: tokens.spacing.sm,
          minHeight: 44,
          opacity: pressed && active ? 0.85 : 1,
          paddingHorizontal: tokens.spacing.lg,
          paddingVertical: tokens.spacing.sm,
        })}
      >
        <Text style={{ color: tokens.colors.accent, fontFamily: tokens.typography.families.serif }}>
          {isPending ? "Turning…" : label}
        </Text>
        <Text style={{ color: tokens.colors.accent }}>→</Text>
      </Pressable>
    </View>
  );
}
