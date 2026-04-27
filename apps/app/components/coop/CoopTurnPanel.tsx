import { View } from "react-native";

import type { CoopChoice, CoopRoomUiState } from "../../hooks/useCoopRoom";
import { useAppTheme } from "../../theme";
import { Button, Chip, Surface, Text } from "../primitives";

type CoopTurnPanelProps = {
  choices: CoopChoice[];
  mode: "pass" | "vote";
  state: CoopRoomUiState;
  onPassChoice?: ((choiceId: string) => void) | undefined;
  onVote?: ((choiceId: string) => void) | undefined;
};

export function CoopTurnPanel({
  choices,
  mode,
  onPassChoice,
  onVote,
  state,
}: CoopTurnPanelProps) {
  const { tokens } = useAppTheme();
  const disabled = mode === "pass" ? !state.canSubmitPassChoice : !state.canVote;
  const action = mode === "pass" ? onPassChoice : onVote;

  return (
    <Surface padded>
      <View style={{ gap: tokens.spacing.md }}>
        <View style={{ gap: tokens.spacing.xs }}>
          <View style={{ alignItems: "center", flexDirection: "row", gap: tokens.spacing.sm }}>
            <Text variant="subtitle">{mode === "pass" ? "Pass Mode" : "Vote Mode"}</Text>
            <Chip>{mode === "pass" ? state.currentParticipantName : `${state.voteCount}/${state.playerCount}`}</Chip>
          </View>
          <Text muted>
            {mode === "pass"
              ? "The active reader or host can choose."
              : state.hasCurrentParticipantVoted
                ? "Your vote is recorded."
                : "Pick one choice for this turn."}
          </Text>
        </View>

        <View style={{ gap: tokens.spacing.sm }}>
          {choices.map((choice) => (
            <Button
              disabled={disabled || choice.disabled === true}
              key={choice.choiceId}
              onPress={() => action?.(choice.choiceId)}
              variant={disabled || choice.disabled === true ? "locked" : "primary"}
            >
              {choice.label}
            </Button>
          ))}
        </View>
      </View>
    </Surface>
  );
}
