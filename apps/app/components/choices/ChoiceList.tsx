import { View } from "react-native";

import { Choice, Text } from "../primitives";
import { useAppTheme } from "../../theme";
import type { ChoiceProjection } from "../../hooks/useTurn";

type ChoiceListProps = {
  choices: ChoiceProjection[];
  disabled?: boolean;
  pendingChoiceId?: string | null;
  onChoose: (choice: ChoiceProjection) => void;
};

export function ChoiceList({
  choices,
  disabled = false,
  pendingChoiceId = null,
  onChoose,
}: ChoiceListProps) {
  const { tokens } = useAppTheme();

  return (
    <View accessibilityLabel="Available choices" style={{ gap: tokens.spacing.sm }}>
      {choices.map((choice) => {
        const isPending = pendingChoiceId === choice.id;
        return (
          <Choice
            accessibilityLabel={choice.locked ? `${choice.label}. Locked.` : choice.label}
            hint={isPending ? "Working" : choice.hint}
            key={choice.id}
            locked={disabled || choice.locked || Boolean(pendingChoiceId)}
            onPress={() => onChoose(choice)}
          >
            {choice.label}
          </Choice>
        );
      })}
      {choices.length === 0 ? (
        <Text muted variant="bodySmall">
          This scene has no available choices.
        </Text>
      ) : null}
    </View>
  );
}
