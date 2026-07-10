import { useRef, useState } from "react";
import { Animated, Easing, Pressable, View } from "react-native";

import { Choice, Text } from "../primitives";
import { useAppTheme } from "../../theme";
import type { ChoiceProjection } from "../../hooks/useTurn";
import { FreeformChoice } from "./FreeformChoice";
import { LockedChoiceCopy } from "./LockedChoiceCopy";

type ChoiceListProps = {
  choices: ChoiceProjection[];
  disabled?: boolean;
  pendingChoiceId?: string | null;
  onChoose: (choice: ChoiceProjection) => void;
  reducedMotion?: boolean;
  /**
   * Optional "Option D" free-form input. When provided, a FreeformChoice row
   * renders after the regular choices so the reader can type their own action.
   * Omitting this prop preserves the previous LLM-only-choices behavior — used
   * for scripted/local-engine saves where free-form has no engine path.
   */
  onFreeformSubmit?: (text: string) => void;
  /** True while the free-form turn is in flight (host-owned). */
  freeformPending?: boolean;
  /** Surfaced beneath the free-form input when a submission was rejected. */
  freeformError?: string | null;
};

export function ChoiceList({
  choices,
  disabled = false,
  pendingChoiceId = null,
  onChoose,
  reducedMotion = false,
  onFreeformSubmit,
  freeformPending = false,
  freeformError = null,
}: ChoiceListProps) {
  const { tokens } = useAppTheme();
  const showFreeform = typeof onFreeformSubmit === "function";

  return (
    <View accessibilityLabel="Available choices" style={{ gap: tokens.spacing.sm }}>
      {choices.map((choice) => {
        // Locked choices (R4.3) are NOT submittable. Rather than a dead
        // disabled row, we render a dedicated locked card that shakes + reveals
        // its in-world hint on press so the reader sees a door they can't open
        // yet — and wants to.
        if (choice.locked) {
          return (
            <LockedChoiceRow
              choice={choice}
              key={choice.id}
              reducedMotion={reducedMotion}
            />
          );
        }
        const isPending = pendingChoiceId === choice.id;
        return (
          <Choice
            accessibilityLabel={choice.label}
            hint={isPending ? "Working" : choice.hint}
            key={choice.id}
            locked={disabled || Boolean(pendingChoiceId)}
            onPress={() => onChoose(choice)}
          >
            {choice.label}
          </Choice>
        );
      })}
      {showFreeform ? (
        <FreeformChoice
          disabled={disabled || Boolean(pendingChoiceId && !freeformPending)}
          error={freeformError}
          onSubmit={onFreeformSubmit!}
          pending={freeformPending}
        />
      ) : null}
      {choices.length === 0 && !showFreeform ? (
        <Text muted variant="bodySmall">
          This scene has no available choices.
        </Text>
      ) : null}
    </View>
  );
}

const SHAKE_OFFSET = 6;

/**
 * A locked/conditional choice (R4). Renders the 🔒 affordance + a muted,
 * dashed card. Pressing it does NOT submit — it shakes and reveals the
 * in-world `lockedHint` so the reader understands what's needed without
 * leaking hidden flags or raw stat thresholds (LockedChoiceCopy enforces the
 * copy discipline). Reduced-motion readers get the reveal with no shake.
 */
function LockedChoiceRow({
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
      Animated.timing(translateX, {
        toValue: -SHAKE_OFFSET,
        duration: 50,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(translateX, {
        toValue: SHAKE_OFFSET,
        duration: 50,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(translateX, {
        toValue: -SHAKE_OFFSET / 2,
        duration: 50,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(translateX, {
        toValue: 0,
        duration: 50,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const a11yLabel = choice.hint
    ? `Locked — ${choice.label}. Requires ${choice.hint}.`
    : `Locked — ${choice.label}.`;

  return (
    <View style={{ gap: tokens.spacing.xs }}>
      <Animated.View style={{ transform: [{ translateX }] }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          accessibilityHint="This path is closed for now. Tap to see why."
          accessibilityState={{ disabled: true }}
          onPress={shake}
          style={({ pressed }) => ({
            alignItems: "center",
            backgroundColor: tokens.colors.surfaceMuted,
            borderColor: tokens.colors.borderMuted,
            borderRadius: tokens.radii.sm,
            borderStyle: "dashed",
            borderWidth: tokens.borderWidths.regular,
            flexDirection: "row",
            gap: tokens.spacing.sm,
            minHeight: 48,
            opacity: pressed ? 0.82 : 1,
            paddingHorizontal: tokens.spacing.md,
            paddingVertical: tokens.spacing.sm,
          })}
        >
          <Text aria-hidden variant="body">
            🔒
          </Text>
          <View style={{ flex: 1 }}>
            <Text muted>{choice.label}</Text>
          </View>
        </Pressable>
      </Animated.View>
      {revealed ? <LockedChoiceCopy hint={choice.hint} /> : null}
    </View>
  );
}
