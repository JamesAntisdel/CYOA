import { View } from "react-native";

import { Button, Surface, Text } from "../primitives";
import { useAppTheme } from "../../theme";
import type { ReaderProjection } from "../../hooks/useTurn";

type EndingPanelProps = {
  ending: NonNullable<ReaderProjection["ending"]>;
  onOpenEndings?: () => void;
  onOpenLibrary?: () => void;
  onReturnHome?: () => void;
};

export function EndingPanel({
  ending,
  onOpenEndings,
  onOpenLibrary,
  onReturnHome,
}: EndingPanelProps) {
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
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: tokens.spacing.sm,
        }}
      >
        {onReturnHome ? (
          <Button onPress={onReturnHome} variant="primary">
            Home
          </Button>
        ) : null}
        {onOpenLibrary ? (
          <Button onPress={onOpenLibrary}>
            Library
          </Button>
        ) : null}
        {onOpenEndings ? (
          <Button onPress={onOpenEndings} variant="ghost">
            Endings
          </Button>
        ) : null}
      </View>
    </Surface>
  );
}
