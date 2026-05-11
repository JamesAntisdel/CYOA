import { View } from "react-native";

import { Choice, Text } from "../primitives";
import { useAppTheme } from "../../theme";
import type { ChoiceProjection } from "../../hooks/useTurn";
import { LockedChoiceCopy } from "./LockedChoiceCopy";

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
      {choices.length === 0 ? (
        <Text muted variant="bodySmall">
          This scene has no available choices.
        </Text>
      ) : null}
    </View>
  );
}
