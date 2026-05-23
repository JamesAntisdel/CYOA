import { View } from "react-native";

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
  onFreeformSubmit,
  freeformPending = false,
  freeformError = null,
}: ChoiceListProps) {
  const { tokens } = useAppTheme();
  const showFreeform = typeof onFreeformSubmit === "function";

  return (
    <View accessibilityLabel="Available choices" style={{ gap: tokens.spacing.sm }}>
      {choices.map((choice) => {
        const isPending = pendingChoiceId === choice.id;
        return (
          <View key={choice.id} style={{ gap: tokens.spacing.xs }}>
            <Choice
              accessibilityLabel={choice.locked ? `${choice.label}. Locked.` : choice.label}
              hint={isPending ? "Working" : choice.locked ? undefined : choice.hint}
              locked={disabled || choice.locked || Boolean(pendingChoiceId)}
              onPress={() => onChoose(choice)}
            >
              {choice.label}
            </Choice>
            {choice.locked ? <LockedChoiceCopy hint={choice.hint} /> : null}
          </View>
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
