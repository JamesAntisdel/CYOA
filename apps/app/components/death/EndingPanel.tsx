import { View } from "react-native";

import { Button, Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";
import type { ReaderProjection } from "../../hooks/useTurn";

type EndingPanelProps = {
  ending: NonNullable<ReaderProjection["ending"]>;
  onClose?: () => void;
};

export function EndingPanel({ ending, onClose }: EndingPanelProps) {
  const { tokens } = useAppTheme();
  const isDeath = ending.kind === "death";

  return (
    <Surface
      accessibilityLabel={`${isDeath ? "Death" : "Ending"}: ${ending.title}`}
      padded
      style={{ gap: tokens.spacing.md }}
      variant="muted"
    >
      <View style={{ gap: tokens.spacing.xs }}>
        <Text muted variant="caption">
          {isDeath ? "Death" : "Ending"}
        </Text>
        <Text variant="title">{ending.title}</Text>
      </View>
      <Text>{ending.body}</Text>
      {onClose ? (
        <Button onPress={onClose} variant="primary">
          Return to endings
        </Button>
      ) : null}
    </Surface>
  );
}
